// The Admin's half of the Dispute, and the point at which the loop closes.
//
// design.md § Disputes calls this the only closed feedback loop in the system:
// upholding an objection promotes the Student's answer to an Accepted Variant,
// every Grader call already carries Accepted Variants as teacher-confirmed
// context, and so the Grader gets better at that Exercise the moment the button
// is pressed, with nobody touching a prompt.
//
// The two decisions are not mirror images of each other. Upholding writes an
// Accepted Variant; rejecting writes only that the Verdict stood. What they share
// is what neither of them does: nothing here rewrites a Submission. ADR 0003
// keeps both the proposed and the guarded Verdict so the Grader's run-to-run
// instability stays measurable, and overwriting one after review would destroy
// the one number that says whether the Grader is improving — how often a person
// overruled it. The ruling lives on the Dispute, and progress and statistics read
// the two together.

import { asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  acceptedVariants, courses, disputes, exercises, exerciseSets, lessons, students,
  submissionErrors, submissions, tests,
  type CourseRow, type DisputeRow, type DisputeRuling, type ExerciseRow,
  type SubmissionRow,
} from '../db/schema.ts';
import { normaliseAnswer } from '../practice/deterministic-check.ts';
import { storedGaps } from '../practice/judgement.ts';
import { acceptedAnswers, candidateAnswers, variantsOf } from '../content/accepted.ts';
import { courseIdOf } from '../content/ownership.ts';

type Db = BetterSQLite3Database<typeof schema>;

// One alias per owner: the Course is reached through the Lesson or through the
// Test, and one join cannot stand for both.
const lessonCourse = alias(courses, 'lesson_course');
const testCourse = alias(courses, 'test_course');

/** One row of the queue: enough to decide which Dispute to open next. */
export type QueuedDispute = {
  dispute: DisputeRow;
  studentUsername: string;
  courseTitle: string;
  courseId: number;
  exercisePrompt: string;
};

/**
 * Everything a judgement has to be reviewed against, on one screen.
 *
 * All of it together, deliberately: a decision made from the Student's answer
 * alone, or from the Grader's Errors alone, is not a review.
 */
export type OpenedDispute = {
  dispute: DisputeRow;
  studentUsername: string;
  course: CourseRow;
  exercise: ExerciseRow;
  submission: SubmissionRow;
  /**
   * What the Exercise already accepts — the authored list and the Accepted
   * Variants earlier reviews added, in one list, so the screen showing it does
   * not have to know there were two sources.
   */
  accepted: string[];
  /**
   * What upholding would promote to Accepted Variants — one value per gap.
   *
   * Not the Submission's `answer`, which for a fill-gap is the sentence: the
   * Deterministic Check compares one gap at a time, so a sentence stored as a
   * variant is a value nothing would ever match. The screen names these, so what
   * it says was added is what was added.
   */
  answerValues: string[];
  errors: Array<{ type: string; span: string; explanationRu: string }>;
  /** Where the answer was given — a Lesson's Practice or a Test. */
  origin: { kind: 'lesson'; title: string } | { kind: 'test'; title: string } | null;
};

/**
 * Every Dispute awaiting a decision, oldest first.
 *
 * Oldest first because a queue that surfaced the newest would leave the Student
 * who has waited longest waiting longer still.
 */
export function pendingDisputes(db: Db): QueuedDispute[] {
  return listDisputes(db, 'awaiting');
}

/** Every Dispute that has been decided, most recently decided first. */
export function resolvedDisputes(db: Db): QueuedDispute[] {
  return listDisputes(db, 'resolved');
}

// Named rather than a boolean, because `listDisputes(db, true)` says nothing at
// the call site about which half of the screen it fills.
type Awaiting = 'awaiting' | 'resolved';

// A Dispute names a Submission, which names an Exercise, which belongs to an
// Exercise Set — and the Set names a Course through ../content/ownership.ts. One
// walk of that chain, so the queue and the detail screen cannot disagree about
// which Course a Dispute came from.
function listDisputes(db: Db, which: Awaiting): QueuedDispute[] {
  const rows = db.select({
    dispute: disputes,
    username: students.username,
    prompt: exercises.prompt,
    lessonCourseId: lessons.courseId,
    testCourseId: tests.courseId,
    lessonCourseTitle: lessonCourse.title,
    testCourseTitle: testCourse.title,
  })
    .from(disputes)
    .innerJoin(submissions, eq(submissions.id, disputes.submissionId))
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    .innerJoin(students, eq(students.id, disputes.studentId))
    .leftJoin(lessons, eq(lessons.id, exerciseSets.lessonId))
    .leftJoin(tests, eq(tests.id, exerciseSets.testId))
    // The Course through whichever owner the Set has, rather than by reading the
    // whole catalogue into a map for one title per row.
    .leftJoin(lessonCourse, eq(lessonCourse.id, lessons.courseId))
    .leftJoin(testCourse, eq(testCourse.id, tests.courseId))
    .where(which === 'awaiting' ? isNull(disputes.ruling) : isNotNull(disputes.ruling))
    .orderBy(asc(disputes.createdAt))
    .all();

  const queued = rows.map((row) => ({
    dispute: row.dispute,
    studentUsername: row.username,
    courseId: courseIdOf(row.lessonCourseId, row.testCourseId),
    courseTitle: row.lessonCourseTitle ?? row.testCourseTitle ?? '',
    exercisePrompt: row.prompt,
  }));

  // A resolved Dispute is the record of a decision, so the most recent decision
  // is the one worth seeing first. The queue keeps its own order — oldest first,
  // so the Student who has waited longest is not left waiting longer still.
  return which === 'awaiting'
    ? queued
    : queued.sort((a, b) =>
        (b.dispute.resolvedAt?.getTime() ?? 0) - (a.dispute.resolvedAt?.getTime() ?? 0));
}

/** One Dispute, with everything a decision has to be made against. */
export function openDispute(db: Db, disputeId: number): OpenedDispute | null {
  const found = db.select({
    dispute: disputes,
    submission: submissions,
    exercise: exercises,
    set: exerciseSets,
    username: students.username,
  })
    .from(disputes)
    .innerJoin(submissions, eq(submissions.id, disputes.submissionId))
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    .innerJoin(students, eq(students.id, disputes.studentId))
    .where(eq(disputes.id, disputeId))
    .get();

  if (!found) return null;

  const lesson = found.set.lessonId === null ? null : db.select().from(lessons)
    .where(eq(lessons.id, found.set.lessonId)).get() ?? null;
  const test = found.set.testId === null ? null : db.select().from(tests)
    .where(eq(tests.id, found.set.testId)).get() ?? null;

  const courseId = lesson?.courseId ?? test?.courseId;
  if (courseId === undefined) return null;
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  const errors = db.select().from(submissionErrors)
    .where(eq(submissionErrors.submissionId, found.submission.id))
    .orderBy(asc(submissionErrors.position)).all()
    .map((row) => ({ type: row.type, span: row.span, explanationRu: row.explanationRu }));

  return {
    dispute: found.dispute,
    studentUsername: found.username,
    course,
    exercise: found.exercise,
    submission: found.submission,
    // Flattened for the screen, which asks what this Exercise already accepts
    // rather than where: an Admin resolving a Dispute reads a list. #85 is where
    // a variant gains a position and this becomes a question about gaps.
    accepted: acceptedAnswers(found.exercise, variantsOf(db, found.exercise.id)).flat(),
    answerValues: storedGaps(found.submission).map((value) => value.trim()).filter((value) => value !== ''),
    errors,
    origin: lesson
      ? { kind: 'lesson', title: lesson.title }
      : test
        ? { kind: 'test', title: test.title }
        : null,
  };
}

// --- Deciding ----------------------------------------------------------------

export type ResolutionRefusal = { ok: false; reason: 'not_found' | 'already_resolved' };

export type Resolution = {
  ok: true;
  ruling: DisputeRuling;
  /** True where upholding actually added a variant — false where it was already accepted. */
  variantAdded: boolean;
};

/**
 * Whether an answer is already accepted for this Exercise.
 *
 * Compared under the Deterministic Check's normalisation, because that is this
 * project's one definition of "the same answer" — «A cat.» and «a cat» are not
 * two Accepted Variants, and storing them as two would put the same answer in
 * front of the Grader twice.
 */
function alreadyAccepted(exercise: ExerciseRow, existing: readonly string[], answer: string): boolean {
  const options = { caseSensitive: exercise.caseSensitive };
  const normalised = normaliseAnswer(answer, options);
  return candidateAnswers(exercise, existing)
    .some((candidate) => normaliseAnswer(candidate, options) === normalised);
}

/**
 * Records a decision on one Dispute.
 *
 * Upholding promotes the Student's answer to an Accepted Variant of that
 * Exercise — the whole point of the feature, and what makes the Grader
 * measurably better through use. Rejecting records that the Verdict stood and
 * changes no Accepted Variant.
 *
 * Neither rewrites the Submission. A resolved Dispute leaves the queue and stays
 * readable afterwards: it is the record of a decision, not a task that evaporates
 * when it is done.
 *
 * Refused where the Dispute has already been decided. A second ruling would
 * either be a silent no-op or a quiet reversal, and neither is something a queue
 * should do by accident.
 */
export function resolveDispute(
  db: Db,
  adminId: number,
  disputeId: number,
  ruling: DisputeRuling,
): Resolution | ResolutionRefusal {
  return db.transaction((tx) => {
    const dispute = tx.select().from(disputes).where(eq(disputes.id, disputeId)).get();
    if (!dispute) return { ok: false, reason: 'not_found' } as const;
    if (dispute.ruling !== null) return { ok: false, reason: 'already_resolved' } as const;

    const submission = tx.select().from(submissions)
      .where(eq(submissions.id, dispute.submissionId)).get();
    if (!submission) return { ok: false, reason: 'not_found' } as const;

    const exercise = tx.select().from(exercises)
      .where(eq(exercises.id, submission.exerciseId)).get();
    if (!exercise) return { ok: false, reason: 'not_found' } as const;

    let variantAdded = false;
    if (ruling === 'upheld') {
      const existing = tx.select().from(acceptedVariants)
        .where(eq(acceptedVariants.exerciseId, exercise.id)).all()
        .map((row) => row.value);

      // What the Student wrote at each gap, not the sentence they built with it.
      // A fill-gap's `answer` is that sentence, and storing it as an Accepted
      // Variant would store a value nothing will ever compare against — the
      // Deterministic Check asks about one gap at a time.
      //
      // Every gap that is not already accepted, because an objection is about
      // the answer as a whole and the Admin upholding it has read it as a whole.
      // The variant carries no position, so it joins every gap — which is what
      // an Accepted Variant has always done, and what #85 is where it stops.
      for (const value of storedGaps(submission)) {
        const answer = value.trim();
        // An empty answer is never what an objection is about, and an Accepted
        // Variant of "" would accept a blank answer for ever after.
        if (answer === '' || alreadyAccepted(exercise, [...existing], answer)) continue;
        tx.insert(acceptedVariants).values({
          exerciseId: exercise.id,
          value: answer,
          createdAt: new Date(),
        }).run();
        existing.push(answer);
        variantAdded = true;
      }
    }

    tx.update(disputes)
      .set({ ruling, resolvedBy: adminId, resolvedAt: new Date() })
      .where(eq(disputes.id, disputeId))
      .run();

    return { ok: true, ruling, variantAdded } as const;
  });
}
