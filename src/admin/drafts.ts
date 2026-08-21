// Drafts: saving one, and publishing one.
//
// The rule this module exists to keep is that saving and publishing are
// different acts. Saving appends a Draft and changes nothing a Student can see;
// publishing is the deliberate second step that writes a Draft into the tables a
// Student reads. design.md § Authoring requires it — a generated Draft must
// never publish unreviewed, because a hallucinated Reference Answer would
// silently poison grading for that Exercise — and it is built now, while a human
// is still typing every character, so that Generation inherits it.

import { and, asc, count, desc, eq, inArray, notInArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, lessons, exerciseSets, exercises, lessonDrafts, students, submissions,
  type CourseRow, type LessonRow, type LessonDraftRow, type DraftOrigin,
} from '../db/schema.ts';
import {
  documentFaults, exerciseLevelFaults,
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

/**
 * How many Submissions have been made against each Exercise of a Lesson's
 * Practice, keyed by Exercise id.
 *
 * Removing an Exercise cascades to every Submission made against it, which is a
 * Student's work. The count is what lets the form say what is about to be
 * destroyed instead of destroying it quietly — an Admin who is told "three
 * answers will be deleted" is making a decision, and one who is not is having
 * one made for them.
 */
export function submissionCounts(db: Db, lessonId: number): Record<number, number> {
  const setId = practiceSetId(db, lessonId);
  if (setId === null) return {};

  const rows = db.select({ exerciseId: submissions.exerciseId, made: count() })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .where(eq(exercises.exerciseSetId, setId))
    .groupBy(submissions.exerciseId)
    .all();

  const counts: Record<number, number> = {};
  for (const row of rows) counts[row.exerciseId] = row.made;
  return counts;
}

export type OpenDraft = {
  course: CourseRow;
  lesson: LessonRow;
  /** The newest Draft's document, or the published content where there is none. */
  document: LessonDocument;
  draftId: number | null;
  /** The newest Draft has not been published — what the Admin has is ahead of what the Student reads. */
  hasUnpublishedChanges: boolean;
  /** This Lesson has never been published: no Student has ever read it. */
  neverPublished: boolean;
  /** Submissions made against each published Exercise, by Exercise id. */
  submissionCounts: Record<number, number>;
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
    neverPublished: found.lesson.publishedAt === null,
    submissionCounts: submissionCounts(db, lessonId),
  };
}

export type SaveDraftResult =
  | { ok: true; draft: LessonDraftRow }
  // Refused before it was written, rather than stored and complained about
  // later: an incoherent Exercise must never reach a Draft, because a Draft is
  // what Generation will refine and what a restore will bring back.
  | { ok: false; reason: 'invalid'; faults: DocumentFault[] };

/**
 * Appends a Draft. Never overwrites the last one — that is what makes the
 * history a matter of reading rows rather than of a schema change.
 *
 * Faults about an Exercise refuse the save. Faults about the Lesson — no title,
 * no Theory yet — do not: those are ordinary states halfway through writing a
 * Lesson, and refusing to save over them would lose the work an Admin has done
 * so far. Publishing checks everything, which is where the line actually
 * matters.
 */
export function saveDraft(
  db: Db,
  input: {
    lessonId: number;
    studentId: number;
    document: LessonDocument;
    /** What made this Draft. Manual editing until Generation and Refinement land. */
    origin?: DraftOrigin;
  },
): SaveDraftResult {
  const faults = exerciseLevelFaults(documentFaults(input.document));
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  const draft = db.insert(lessonDrafts).values({
    lessonId: input.lessonId,
    document: input.document,
    origin: input.origin ?? 'manual',
    publishedAt: null,
    createdBy: input.studentId,
    createdAt: new Date(),
  }).returning().get();

  return { ok: true, draft };
}

export type PublishResult =
  | { ok: true; document: LessonDocument }
  // Refused rather than written: publishing is the review step, so a document
  // that breaks a rule is exactly what it exists to stop.
  | { ok: false; reason: 'invalid'; faults: DocumentFault[] }
  // Already live. Republishing one is never what an Admin means: it would write
  // an older document over a newer one and report success, which is the worst
  // shape a mistake can take here.
  | { ok: false; reason: 'already_published' }
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
  if (draft.publishedAt !== null) return { ok: false, reason: 'already_published' };

  const faults = documentFaults(draft.document);
  if (faults.length > 0) return { ok: false, reason: 'invalid', faults };

  return db.transaction((tx) => {
    const lesson = tx.select().from(lessons).where(eq(lessons.id, draft.lessonId)).get();
    if (!lesson) return { ok: false, reason: 'not_found' } as const;

    tx.update(lessons).set({
      title: draft.document.title,
      grammarFocus: draft.document.grammarFocus,
      theoryMarkdown: draft.document.theoryMarkdown,
      // The moment this Lesson became something a Student reads, and only that
      // moment: a Lesson that is already live does not become live again, and
      // overwriting the timestamp on every publish would lose the one fact the
      // column exists to record.
      publishedAt: lesson.publishedAt ?? new Date(),
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

// --- History -----------------------------------------------------------------
//
// Every Generation turn and every manual edit produces a new Draft, and all of
// them are restorable (design.md § Authoring). Saving has appended rather than
// overwritten since the Draft existed, so they were always there; this is the
// surface that admits it.

export type DraftSummary = {
  id: number;
  createdAt: Date;
  /** What made this Draft — recorded when it was saved, never inferred later. */
  origin: DraftOrigin;
  /** When this Draft went live, or null on one that never did. */
  publishedAt: Date | null;
  /** Null where the account that wrote it is gone; a Draft outlives its author. */
  authorUsername: string | null;
  exerciseCount: number;
};

/** Every Draft of a Lesson, newest first. */
export function draftHistory(db: Db, lessonId: number): DraftSummary[] {
  return db.select({ draft: lessonDrafts, username: students.username })
    .from(lessonDrafts)
    .leftJoin(students, eq(students.id, lessonDrafts.createdBy))
    .where(eq(lessonDrafts.lessonId, lessonId))
    .orderBy(desc(lessonDrafts.id))
    .all()
    .map(({ draft, username }) => ({
      id: draft.id,
      createdAt: draft.createdAt,
      origin: draft.origin,
      publishedAt: draft.publishedAt,
      authorUsername: username,
      exerciseCount: draft.document.exercises.length,
    }));
}

export type RestoreResult =
  | { ok: true; draft: LessonDraftRow }
  | { ok: false; reason: 'not_found' };

/**
 * Brings an earlier Draft back by appending it as a new one.
 *
 * Appending rather than truncating is what makes the history trustworthy: a
 * restore that deleted the Drafts after it would let an Admin destroy work by
 * browsing, and the whole point of keeping every turn is that Generation will
 * soon be producing Drafts nobody chose. So restoring is itself an undoable act,
 * and the history only ever grows.
 *
 * It does not publish. What a Student reads changes only through the deliberate
 * Publish, whatever an Admin does in here.
 *
 * The document is copied verbatim, without re-checking it. A Draft that is in
 * the history is one that was allowed in, and refusing to restore it
 * would make the history a promise the application does not keep — publishing is
 * still where every rule is enforced.
 */
export function restoreDraft(
  db: Db,
  input: { lessonId: number; draftId: number; studentId: number },
): RestoreResult {
  const draft = findDraft(db, input.draftId);
  // A Draft belonging to another Lesson is not restorable through this one,
  // whatever id arrived.
  if (draft === null || draft.lessonId !== input.lessonId) return { ok: false, reason: 'not_found' };

  const appended = db.insert(lessonDrafts).values({
    lessonId: draft.lessonId,
    document: draft.document,
    origin: 'restore',
    publishedAt: null,
    createdBy: input.studentId,
    createdAt: new Date(),
  }).returning().get();

  return { ok: true, draft: appended };
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
