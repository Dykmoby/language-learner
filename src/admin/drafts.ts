// Drafts: saving one, and publishing one.
//
// The rule this module exists to keep is that saving and publishing are
// different acts. Saving appends a Draft and changes nothing a Student can see;
// publishing is the deliberate second step that writes a Draft into the tables a
// Student reads. design.md § Authoring requires it — a generated Draft must
// never publish unreviewed, because a hallucinated Reference Answer would
// silently poison grading for that Exercise — and it is built now, while a human
// is still typing every character, so that Generation inherits it.

import { and, asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, lessons, exerciseSets, exercises, lessonDrafts,
  type CourseRow, type LessonRow, type LessonDraftRow,
} from '../db/schema.ts';
import {
  documentFaults,
  type DocumentExercise, type DocumentFault, type LessonDocument,
} from '../content/lesson-document.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** The Practice's Exercise Set, or null where the Lesson has none yet. */
function practiceSetId(db: Db, lessonId: number): number | null {
  return db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lessonId)).get()?.id ?? null;
}

/**
 * What a Student currently reads, as a document.
 *
 * This is what seeds the first Draft of a Lesson that has never been edited:
 * opening the editor shows the published content, and the Draft comes into
 * existence when the Admin saves — not merely because they looked.
 */
export function publishedDocument(db: Db, lessonId: number): LessonDocument | null {
  const lesson = db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
  if (!lesson) return null;

  const setId = practiceSetId(db, lessonId);
  const own = setId === null ? [] : db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, setId)).orderBy(asc(exercises.position)).all();

  return {
    title: lesson.title,
    grammarFocus: lesson.grammarFocus,
    theoryMarkdown: lesson.theoryMarkdown,
    exercises: own.map((exercise) => ({
      id: exercise.id,
      kind: exercise.kind,
      prompt: exercise.prompt,
      referenceAnswer: exercise.referenceAnswer,
      acceptedAnswers: exercise.acceptedAnswers,
      caseSensitive: exercise.caseSensitive,
      choices: exercise.choices,
    })),
  };
}

/** One Draft by id, or null. */
export function findDraft(db: Db, draftId: number): LessonDraftRow | null {
  return db.select().from(lessonDrafts).where(eq(lessonDrafts.id, draftId)).get() ?? null;
}

/** The newest Draft of a Lesson, or null if it has never been saved. */
export function latestDraft(db: Db, lessonId: number): LessonDraftRow | null {
  return db.select().from(lessonDrafts)
    .where(eq(lessonDrafts.lessonId, lessonId))
    .orderBy(desc(lessonDrafts.id))
    .limit(1)
    .get() ?? null;
}

export type OpenDraft = {
  course: CourseRow;
  lesson: LessonRow;
  /** The newest Draft's document, or the published content where there is none. */
  document: LessonDocument;
  draftId: number | null;
  /** The newest Draft has not been published — what the Admin has is ahead of what the Student reads. */
  hasUnpublishedChanges: boolean;
};

export function openDraft(db: Db, lessonId: number): OpenDraft | null {
  const found = db.select({ lesson: lessons, course: courses })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!found) return null;

  const published = publishedDocument(db, lessonId);
  if (published === null) return null;

  const draft = latestDraft(db, lessonId);

  return {
    course: found.course,
    lesson: found.lesson,
    document: draft?.document ?? published,
    draftId: draft?.id ?? null,
    hasUnpublishedChanges: draft !== null && draft.publishedAt === null,
  };
}

/**
 * Appends a Draft. Never overwrites the last one — that is what makes the
 * history in the ticket this one blocks a matter of reading rows rather than of
 * a schema change.
 */
export function saveDraft(
  db: Db,
  input: { lessonId: number; studentId: number; document: LessonDocument },
): LessonDraftRow {
  return db.insert(lessonDrafts).values({
    lessonId: input.lessonId,
    document: input.document,
    publishedAt: null,
    createdBy: input.studentId,
    createdAt: new Date(),
  }).returning().get();
}

export type PublishResult =
  | { ok: true; document: LessonDocument }
  // Refused rather than written: publishing is the review step, so a document
  // that breaks a rule is exactly what it exists to stop.
  | { ok: false; reason: 'invalid'; faults: DocumentFault[] }
  | { ok: false; reason: 'not_found' };

/**
 * Writes a Draft into the Lesson a Student reads, in one transaction.
 *
 * Exercise identity is preserved wherever the document still describes an
 * Exercise that exists: a Submission references its Exercise, and an Exercise
 * that is deleted and re-inserted takes every Submission made against it with it.
 */
export function publishDraft(db: Db, draftId: number): PublishResult {
  const draft = db.select().from(lessonDrafts).where(eq(lessonDrafts.id, draftId)).get();
  if (!draft) return { ok: false, reason: 'not_found' };

  const faults = documentFaults(draft.document);
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  return db.transaction((tx) => {
    const lesson = tx.select().from(lessons).where(eq(lessons.id, draft.lessonId)).get();
    if (!lesson) return { ok: false, reason: 'not_found' } as const;

    tx.update(lessons).set({
      title: draft.document.title,
      grammarFocus: draft.document.grammarFocus,
      theoryMarkdown: draft.document.theoryMarkdown,
    }).where(eq(lessons.id, lesson.id)).run();

    const setId = tx.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lesson.id)).get()?.id
      // A Lesson created through the authoring screens has no Practice until its
      // first publish. The invariant the database enforces is satisfied by
      // construction here: owned by the Lesson, never by a Test.
      ?? tx.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get().id;

    const existing = tx.select().from(exercises).where(eq(exercises.exerciseSetId, setId)).all();
    const existingIds = new Set(existing.map((row) => row.id));
    // An id that names an Exercise in some other Exercise Set is not identity,
    // it is a stale or tampered document. Such an Exercise is inserted as new
    // rather than reaching across into a Set it does not belong to.
    const keep = draft.document.exercises.filter((e) => e.id !== undefined && existingIds.has(e.id));
    const keptIds = keep.map((e) => e.id!);

    // The one deletion, and it is the one the author asked for by removing the
    // Exercise from the document. It cascades to Submissions, which is why the
    // form warns before it gets this far.
    if (keptIds.length === 0) {
      tx.delete(exercises).where(eq(exercises.exerciseSetId, setId)).run();
    } else {
      tx.delete(exercises).where(and(
        eq(exercises.exerciseSetId, setId),
        notInArray(exercises.id, keptIds),
      )).run();
    }

    // Positions are unique within an Exercise Set, so reordering cannot be done
    // in place: every survivor moves out of the way first. Negative positions
    // can never collide with the 1..n about to be written.
    for (const id of keptIds) {
      tx.update(exercises).set({ position: -id }).where(eq(exercises.id, id)).run();
    }

    const published: DocumentExercise[] = draft.document.exercises.map((exercise, index) => {
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

    // The document is written back carrying the ids the rows actually have.
    // Without this, a newly inserted Exercise would have no id in the Draft it
    // was published from, and the next publish would delete and re-insert it —
    // taking its Submissions with it.
    const document: LessonDocument = { ...draft.document, exercises: published };
    tx.update(lessonDrafts)
      .set({ document, publishedAt: new Date() })
      .where(eq(lessonDrafts.id, draft.id))
      .run();

    return { ok: true, document } as const;
  });
}

/** Every Lesson id in a Course whose newest Draft has not been published. */
export function lessonsWithUnpublishedChanges(db: Db, lessonIds: readonly number[]): Set<number> {
  if (lessonIds.length === 0) return new Set();
  const rows = db.select().from(lessonDrafts)
    .where(inArray(lessonDrafts.lessonId, [...lessonIds]))
    .orderBy(desc(lessonDrafts.id))
    .all();

  const newest = new Map<number, LessonDraftRow>();
  for (const row of rows) if (!newest.has(row.lessonId)) newest.set(row.lessonId, row);

  return new Set(
    [...newest.values()].filter((draft) => draft.publishedAt === null).map((draft) => draft.lessonId),
  );
}
