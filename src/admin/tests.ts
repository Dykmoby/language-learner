// The Admin's side of a Test: creating one, authoring its Exercises, publishing it.
//
// A Test is owned by a Course rather than a Lesson, and it is the second place
// Exercises come into being. Nothing about them is new — the same per-Kind forms,
// the same validity rules, the same stable codes — because the Exercise Set is
// what makes that true: it is owned by exactly one of a Lesson's Practice or a
// Test, so ordering, rendering and judgement never branch on which.
//
// What is deliberately absent is a Draft. A Test has no Theory to write and no
// conversation to hold over it, so its Exercises are edited in place and an edit
// to a published Test is live when it is saved. That is affordable here in a way
// it would not be for a Lesson: a Test gates nothing, and the worst an edit
// costs is one wasted attempt. The deliberate act a Test needs is the publish,
// and that is one flag.
//
// Nothing here checks who is asking. The Admin narrowing happens once, at the
// page or the endpoint, the same way the rest of the section does it.

import { and, asc, count, eq, notInArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, tests, exerciseSets, exercises, submissions,
  type CourseRow, type TestRow,
} from '../db/schema.ts';
import type { DocumentExercise } from '../content/lesson-document.ts';
import {
  testFaults, testPublishFaults, DEFAULT_PASS_THRESHOLD,
  type TestDocument, type TestFault,
} from '../content/test-document.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** The Exercise Set a Test owns, or null where it has none yet. */
function testSetId(db: Db, testId: number): number | null {
  return db.select().from(exerciseSets).where(eq(exerciseSets.testId, testId)).get()?.id ?? null;
}

function exercisesOf(db: Db, setId: number | null): DocumentExercise[] {
  if (setId === null) return [];
  return db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, setId)).orderBy(asc(exercises.position)).all()
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      prompt: row.prompt,
      referenceAnswer: row.referenceAnswer,
      acceptedAnswers: row.acceptedAnswers,
      caseSensitive: row.caseSensitive,
      choices: row.choices,
    }));
}

// --- Reading -----------------------------------------------------------------

export type TestSummary = {
  test: TestRow;
  exerciseCount: number;
};

/**
 * Every Test of a Course, published or not — an Admin authors both.
 *
 * Named apart from the Student's `courseTests`, which answers a different
 * question about the same Course: that one drops everything unpublished, because
 * a Test that is not published is not a Test as far as a Student is concerned.
 */
export function adminCourseTests(db: Db, courseId: number): TestSummary[] {
  const own = db.select().from(tests)
    .where(eq(tests.courseId, courseId)).orderBy(asc(tests.id)).all();
  if (own.length === 0) return [];

  const sets = db.select().from(exerciseSets).all()
    .filter((set) => set.testId !== null && own.some((t) => t.id === set.testId));

  const counts = new Map<number, number>();
  for (const set of sets) {
    const made = db.select({ n: count() }).from(exercises)
      .where(eq(exercises.exerciseSetId, set.id)).get()?.n ?? 0;
    counts.set(set.testId!, made);
  }

  return own.map((test) => ({ test, exerciseCount: counts.get(test.id) ?? 0 }));
}

export type OpenTest = {
  course: CourseRow;
  test: TestRow;
  document: TestDocument;
  /** Submissions already made against each Exercise, by Exercise id. */
  submissionCounts: Record<number, number>;
};

/**
 * One Test as its author has it.
 *
 * The Submission counts come with it for the same reason a Lesson's do: removing
 * an Exercise cascades to every answer given to it, and an Admin who is told
 * "three answers will be deleted" is making a decision rather than having one
 * made for them.
 */
export function adminTest(db: Db, testId: number): OpenTest | null {
  const found = db.select({ test: tests, course: courses })
    .from(tests)
    .innerJoin(courses, eq(courses.id, tests.courseId))
    .where(eq(tests.id, testId))
    .get();
  if (!found) return null;

  const setId = testSetId(db, testId);
  const own = exercisesOf(db, setId);

  const counts: Record<number, number> = {};
  if (setId !== null) {
    for (const row of db.select({ exerciseId: submissions.exerciseId, made: count() })
      .from(submissions)
      .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
      .where(eq(exercises.exerciseSetId, setId))
      .groupBy(submissions.exerciseId)
      .all()) {
      counts[row.exerciseId] = row.made;
    }
  }

  return {
    course: found.course,
    test: found.test,
    document: {
      title: found.test.title,
      passThreshold: found.test.passThreshold,
      exercises: own,
    },
    submissionCounts: counts,
  };
}

// --- Creating ----------------------------------------------------------------

export type CreateTestResult =
  | { ok: true; test: TestRow }
  | { ok: false; reason: 'invalid'; faults: TestFault[] }
  | { ok: false; reason: 'not_found' };

/**
 * A new Test on a Course, unpublished and empty.
 *
 * Unpublished is the point, and it is the rule a Lesson already follows: a Test
 * with no Exercises would otherwise appear in a Student's Course as something
 * they can open and cannot do.
 */
export function createTest(
  db: Db,
  input: { courseId: number; title: string; passThreshold?: number },
): CreateTestResult {
  if (!db.select().from(courses).where(eq(courses.id, input.courseId)).get()) {
    return { ok: false, reason: 'not_found' };
  }

  const passThreshold = input.passThreshold ?? DEFAULT_PASS_THRESHOLD;
  // Judged by the same rules a save is, minus the Exercises there are none of.
  const faults = testFaults({ title: input.title, passThreshold, exercises: [] });
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  const test = db.insert(tests).values({
    courseId: input.courseId,
    title: input.title.trim(),
    passThreshold,
    publishedAt: null,
  }).returning().get();

  return { ok: true, test };
}

// --- Saving ------------------------------------------------------------------

export type SaveTestResult =
  | { ok: true; document: TestDocument }
  | { ok: false; reason: 'invalid'; faults: TestFault[] }
  | { ok: false; reason: 'not_found' };

/**
 * The whole Test, written in one transaction.
 *
 * Exercise identity is preserved wherever the form still describes an Exercise
 * that exists: a Submission references its Exercise, and an Exercise deleted and
 * re-inserted takes every answer given to it along with it. This is the same
 * rule publishing a Lesson keeps, for the same reason.
 */
export function saveTest(db: Db, testId: number, document: TestDocument): SaveTestResult {
  const test = db.select().from(tests).where(eq(tests.id, testId)).get();
  if (!test) return { ok: false, reason: 'not_found' };

  const faults = testFaults(document);
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  return db.transaction((tx) => {
    tx.update(tests).set({
      title: document.title.trim(),
      passThreshold: document.passThreshold,
    }).where(eq(tests.id, testId)).run();

    // The Exercise Set exists from the first save rather than from creation: a
    // Test nobody has written an Exercise for has nothing to own. The invariant
    // the database enforces is satisfied by construction — owned by the Test,
    // never by a Lesson.
    const setId = tx.select().from(exerciseSets).where(eq(exerciseSets.testId, testId)).get()?.id
      ?? tx.insert(exerciseSets).values({ lessonId: null, testId }).returning().get().id;

    const existing = tx.select().from(exercises).where(eq(exercises.exerciseSetId, setId)).all();
    const existingIds = new Set(existing.map((row) => row.id));
    // An id naming an Exercise in some other Exercise Set is not identity, it is
    // a stale or tampered form. Such an Exercise is inserted as new rather than
    // reaching across into a Set it does not belong to.
    const keptIds = document.exercises
      .filter((e) => e.id !== undefined && existingIds.has(e.id))
      .map((e) => e.id!);

    // The one deletion, and it is the one the author asked for by removing the
    // Exercise from the form. It cascades to Submissions, which is why the form
    // warns before it gets this far.
    if (keptIds.length === 0) {
      tx.delete(exercises).where(eq(exercises.exerciseSetId, setId)).run();
    } else {
      tx.delete(exercises).where(and(
        eq(exercises.exerciseSetId, setId),
        notInArray(exercises.id, keptIds),
      )).run();
    }

    // Positions are unique within an Exercise Set, so reordering cannot be done
    // in place: every survivor moves out of the way first, into negative
    // positions that can never collide with the 1..n about to be written.
    for (const id of keptIds) {
      tx.update(exercises).set({ position: -id }).where(eq(exercises.id, id)).run();
    }

    const written: DocumentExercise[] = document.exercises.map((exercise, index) => {
      const values = {
        position: index + 1,
        kind: exercise.kind,
        prompt: exercise.prompt,
        referenceAnswer: exercise.referenceAnswer,
        acceptedAnswers: [...(exercise.acceptedAnswers ?? [])],
        caseSensitive: exercise.caseSensitive ?? false,
        choices: [...(exercise.choices ?? [])],
      };

      if (exercise.id !== undefined && existingIds.has(exercise.id)) {
        tx.update(exercises).set(values).where(eq(exercises.id, exercise.id)).run();
        return { ...exercise, id: exercise.id };
      }

      const inserted = tx.insert(exercises)
        .values({ exerciseSetId: setId, ...values }).returning().get();
      return { ...exercise, id: inserted.id };
    });

    // Handed back carrying the ids the rows actually have. Without this a newly
    // added Exercise would have no id in the form it was saved from, and the next
    // save would delete and re-insert it — taking its Submissions with it.
    return { ok: true, document: { ...document, exercises: written } } as const;
  });
}

// --- Publishing --------------------------------------------------------------

export type PublishTestResult =
  | { ok: true; test: TestRow }
  | { ok: false; reason: 'invalid'; faults: TestFault[] }
  | { ok: false; reason: 'already_published' }
  | { ok: false; reason: 'not_found' };

/**
 * Makes a Test something a Student can open.
 *
 * The rules are checked against what is written rather than against what a form
 * happened to send: publishing is the review step, and reviewing the request
 * instead of the rows would review the wrong thing.
 */
export function publishTest(db: Db, testId: number): PublishTestResult {
  const open = adminTest(db, testId);
  if (open === null) return { ok: false, reason: 'not_found' };
  // Publishing one twice is never what an Admin means, and the second press
  // would move the moment it became live to now.
  if (open.test.publishedAt !== null) return { ok: false, reason: 'already_published' };

  const faults = testPublishFaults(open.document);
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  const test = db.update(tests).set({ publishedAt: new Date() })
    .where(eq(tests.id, testId)).returning().get();

  return { ok: true, test };
}
