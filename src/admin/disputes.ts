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
import {
  acceptedAnswers, candidateAnswers, variantOf, variantsOf, type Variant,
} from '../content/accepted.ts';
import { answersCarryGaps, type AcceptedAnswers } from '../content/exercise-validity.ts';
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
   * What the Exercise already accepts, Gap by Gap — the authored lists and the
   * Accepted Variants earlier reviews added, together, so the screen showing
   * them does not have to know there were two sources.
   *
   * Per Gap rather than flat since #85: on a sentence with three of them, «уже
   * принимаются: a, an, I» is a list an Admin cannot act on, because which Gap
   * takes which is the whole question they are about to answer.
   */
  accepted: AcceptedAnswers;
  /**
   * What upholding could promote to an Accepted Variant — the Student's own
   * words, each with the Gap it was written at.
   *
   * Not the Submission's `answer`, which for a fill-gap is the sentence: the
   * Deterministic Check compares one Gap at a time, so a sentence stored as a
   * variant is a value nothing would ever match. Gaps the Student left empty are
   * absent — an Accepted Variant of "" would accept a blank answer for ever.
   *
   * `gap` is null on every Kind with one place to answer, where there is no
   * position to name. More than one entry is the case the screen has to ask
   * about: an objection is about one word, and promoting all three would accept
   * the two the Student got wrong.
   */
  candidates: Variant[];
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
    accepted: acceptedAnswers(found.exercise, variantsOf(db, found.exercise.id)),
    candidates: variantCandidates(found.exercise, found.submission),
    errors,
    origin: lesson
      ? { kind: 'lesson', title: lesson.title }
      : test
        ? { kind: 'test', title: test.title }
        : null,
  };
}

/**
 * The Student's answer as the values a Dispute could confirm, Gap by Gap.
 *
 * One function for the screen and for the ruling, because the two must agree
 * exactly about which positions are on offer: an Admin choosing «пропуск 2» from
 * a list the server derives differently would confirm a word at a Gap they never
 * looked at.
 *
 * Only a fill-gap carries positions. Every other Kind has one place to answer,
 * so its variant has no Gap to name and joins the Exercise as a whole, exactly
 * as every Accepted Variant did before #85.
 */
export function variantCandidates(
  exercise: Pick<ExerciseRow, 'kind'>,
  submission: Pick<SubmissionRow, 'answer' | 'answerGaps'>,
): Variant[] {
  const gapped = answersCarryGaps(exercise.kind);
  return storedGaps(submission)
    .map((value, at) => ({ value: value.trim(), gap: gapped ? at : null }))
    .filter((candidate) => candidate.value !== '');
}

// --- Deciding ----------------------------------------------------------------

export type ResolutionRefusal = {
  ok: false;
  // `gap_unspecified`: an answer with several words in it and no word named.
  // `gap_not_answered`: a Gap named that this answer wrote nothing at, or a
  // position named on a Kind that has none. Both are refusals rather than
  // guesses: which Gap a teacher confirmed is not something to infer.
  reason: 'not_found' | 'already_resolved' | 'gap_unspecified' | 'gap_not_answered';
};

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
function alreadyAccepted(
  exercise: ExerciseRow,
  existing: readonly Variant[],
  candidate: Variant,
): boolean {
  const options = { caseSensitive: exercise.caseSensitive };
  const normalised = normaliseAnswer(candidate.value, options);
  // Asked of the Gap this answer was written at, since #85: a word already
  // accepted at the first Gap is not accepted at the second, and treating it as
  // a duplicate there would silently refuse to confirm what an Admin confirmed.
  return candidateAnswers(exercise, existing, candidate.gap)
    .some((value) => normaliseAnswer(value, options) === normalised);
}

/**
 * Which answer an upheld Dispute confirms, out of what the Student wrote.
 *
 * An objection is about one word. On a fill-gap with several Gaps the Admin says
 * which — a Student who objects that their word in the second Gap is also
 * correct has said nothing about the two they got wrong, and promoting all three
 * would have the Exercise accepting them for ever.
 *
 * Nothing to choose between is not a question: one word written, or a Kind with
 * one place to answer, settles it on its own. Where there is a choice and none
 * was made, this refuses rather than picking the first.
 */
function confirmedAnswer(
  candidates: readonly Variant[],
  gap: number | null,
): { ok: true; variant: Variant } | ResolutionRefusal {
  if (gap === null) {
    return candidates.length === 1
      ? { ok: true, variant: candidates[0]! }
      : { ok: false, reason: 'gap_unspecified' };
  }
  // A position named on an answer that has none, or on a Gap the Student left
  // empty. Either way there is nothing at that position to confirm.
  const found = candidates.find((candidate) => candidate.gap === gap);
  return found === undefined ? { ok: false, reason: 'gap_not_answered' } : { ok: true, variant: found };
}

/**
 * Records a decision on one Dispute.
 *
 * Upholding promotes one of the Student's answers to an Accepted Variant of that
 * Exercise — the whole point of the feature, and what makes the Grader
 * measurably better through use. Rejecting records that the Verdict stood and
 * changes no Accepted Variant.
 *
 * `gap` is which Gap the confirmed answer is for, on a fill-gap answered in
 * several places (#85). Absent everywhere else, where there is nothing to name.
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
  gap: number | null = null,
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
    // An answer with nothing in it anywhere is nothing to promote, and not a
    // reason to refuse the ruling: an Admin upholding an objection to a Verdict
    // on an empty answer has still made a decision, and it is still recorded.
    const candidates = variantCandidates(exercise, submission);

    if (ruling === 'upheld' && candidates.length > 0) {
      const confirmed = confirmedAnswer(candidates, gap);
      if (!confirmed.ok) return confirmed;

      // What the Student wrote at that Gap, not the sentence they built with it.
      // A fill-gap's `answer` is that sentence, and storing it as an Accepted
      // Variant would store a value nothing will ever compare against — the
      // Deterministic Check asks about one Gap at a time.
      const existing = tx.select().from(acceptedVariants)
        .where(eq(acceptedVariants.exerciseId, exercise.id)).all()
        .map(variantOf);

      if (!alreadyAccepted(exercise, existing, confirmed.variant)) {
        tx.insert(acceptedVariants).values({
          exerciseId: exercise.id,
          value: confirmed.variant.value,
          gap: confirmed.variant.gap,
          createdAt: new Date(),
        }).run();
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
