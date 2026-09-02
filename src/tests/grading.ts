// A submitted attempt, judged: the answers that were left unjudged, sent to
// Claude in one call, and written back where they came from.
//
// Two rules run through everything here.
//
// The first is that grading runs to completion server-side whether or not the
// Student is still looking. The rule the Practice set for one Submission holds
// harder for an attempt: it is many answers, and a closed tab must never cost
// them. So this is started and not awaited, and it resolves rather than throws.
//
// The second is that a failure is never a wrong answer. A timeout, a refusal or
// a response that breaks the contract leaves every free-form answer exactly as it
// was — stored, unjudged — and the attempt says the grading failed rather than
// scoring it as though the Student had got those answers wrong. That is also why
// the row exists before its judgement does: asking again costs nothing but the
// call, and the Student re-enters nothing.

import { and, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, tests, testAttempts, exercises, submissions, acceptedVariants,
} from '../db/schema.ts';
import type { BatchContext, JudgedExercise } from '../grader/batch-contract.ts';
import { gradeBatch } from '../grader/batch.ts';
import { currentGuidance } from '../grader/guidance.ts';
import { replaceSubmissionErrors } from '../grader/errors.ts';
import type { GraderInstructions, Language } from '../grader/contract.ts';
import type { Effort } from '../claude/effort.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Attempts whose batch is in flight in this process.
 *
 * A Student who presses «проверить ещё раз» twice, or a page that polls while a
 * retry is running, must not put two calls out for the same answers: the second
 * would spend a grading slot to write what the first is already writing. Held in
 * memory rather than in a column, because it is a fact about this process and
 * dies correctly with it — a restart mid-call leaves the answers awaiting, which
 * is exactly what they are.
 */
const inFlight = new Set<number>();

/** Everything one batch call needs, or null when there is nothing to judge. */
export function batchRequestFor(
  db: Db,
  attemptId: number,
): {
  model: string;
  context: BatchContext;
  instructions: GraderInstructions;
  effort: Effort | null;
  submissionByExercise: Map<number, number>;
} | null {
  const found = db.select({ attempt: testAttempts, test: tests, course: courses })
    .from(testAttempts)
    .innerJoin(tests, eq(tests.id, testAttempts.testId))
    .innerJoin(courses, eq(courses.id, tests.courseId))
    .where(eq(testAttempts.id, attemptId))
    .get();
  if (!found) return null;

  const awaiting = db.select({ submission: submissions, exercise: exercises })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .where(and(
      eq(submissions.testAttemptId, attemptId),
      eq(submissions.status, 'awaiting_grading'),
    ))
    .all();
  if (awaiting.length === 0) return null;

  const variants = new Map<number, string[]>();
  for (const row of db.select().from(acceptedVariants)
    .where(inArray(acceptedVariants.exerciseId, awaiting.map((entry) => entry.exercise.id))).all()) {
    const list = variants.get(row.exerciseId);
    if (list) list.push(row.value);
    else variants.set(row.exerciseId, [row.value]);
  }

  return {
    // Per Course, never per code branch — ADR 0002 puts the choice in the data.
    model: found.course.graderModel,
    // The same Course's Effort a Practice Submission in it is judged at — issue
    // #76. A Test judged with less reasoning than the Practice that prepared for
    // it would be a mirror of something else.
    effort: found.course.graderEffort,
    // The same two texts a Practice Submission in this Course is judged against:
    // the global guidance (issue #79) and the Course's own instruction (issue
    // #80). A Test judged by different instructions from the Practice that
    // prepared for it would be a mirror of something else.
    instructions: { guidance: currentGuidance(db), course: found.course.graderInstruction },
    context: {
      language: found.course.language as Language,
      level: found.course.level,
      testTitle: found.test.title,
      exercises: awaiting.map(({ submission, exercise }) => ({
        exerciseId: exercise.id,
        prompt: exercise.prompt,
        referenceAnswer: exercise.referenceAnswer,
        // Teacher-confirmed answers, carried in so the loop step 7 closes with
        // Disputes already has somewhere to arrive.
        acceptedVariants: variants.get(exercise.id) ?? [],
        answer: submission.answer,
      })),
    },
    submissionByExercise: new Map(awaiting.map(({ submission, exercise }) => [exercise.id, submission.id])),
  };
}

/**
 * Moves every answer of an attempt that failed grading back to awaiting.
 *
 * This is what «проверить ещё раз» means: the same answers, judged again. It
 * writes no new rows — a second judgement of one answer is not a second attempt
 * at it, and numbering it as one would put a Test's retries into the count that
 * decides Reveal in a Practice.
 */
export function reopenFailedGrading(db: Db, attemptId: number): number {
  const failed = db.select().from(submissions)
    .where(and(eq(submissions.testAttemptId, attemptId), eq(submissions.status, 'grading_failed')))
    .all();
  if (failed.length === 0) return 0;

  db.update(submissions)
    .set({ status: 'awaiting_grading', failureReason: null })
    .where(inArray(submissions.id, failed.map((row) => row.id)))
    .run();

  return failed.length;
}

/**
 * Every answer the batch was carrying, marked as ungraded rather than as wrong.
 *
 * Exported for the same reason `recordGrading` is: what a live model returns
 * cannot be chosen, and the cases that matter — a timeout, a contract failure —
 * are exactly the ones it will not produce on demand.
 */
export function markBatchFailed(db: Db, submissionIds: readonly number[], reason: string): void {
  if (submissionIds.length === 0) return;
  db.update(submissions)
    // No Verdict, no feedback: there was no judgement, and none may be implied.
    .set({ status: 'grading_failed', failureReason: reason })
    .where(inArray(submissions.id, [...submissionIds]))
    .run();
}

/**
 * The judgements of one batch, written back onto the answers they belong to.
 *
 * Each one lands on the Submission its Exercise names, never on the row that
 * happened to be in the same position — the attribution the contract enforces on
 * the way in is the attribution used on the way out.
 *
 * Exported because this is the only part of the batch path a hermetic test can
 * reach, and the cases worth proving here are the ones a model will not produce
 * to order: an incoherent Verdict, an invented Error Type, a judgement for an
 * Exercise this attempt does not hold.
 */
export function recordBatch(
  db: Db,
  judged: readonly JudgedExercise[],
  submissionByExercise: ReadonlyMap<number, number>,
): void {
  db.transaction((tx) => {
    for (const item of judged) {
      const submissionId = submissionByExercise.get(item.exerciseId);
      // Cannot happen — the contract refuses a response naming an Exercise
      // nobody asked about — but writing to a row this attempt does not own is
      // the one mistake here that would be silent.
      if (submissionId === undefined) continue;

      if (item.unknownErrorTypes.length > 0) {
        // Kept as it came — dropping the Error would hide a real fault from the
        // Student — but recorded, because an invented Error Type is a contract
        // violation and the histogram in step 7 will trip over it.
        console.warn(`[grader] unknown Error Type(s): ${item.unknownErrorTypes.join(', ')}`);
      }
      // Not when the server itself removed the Error underneath the Verdict —
      // see the same line in practice/submit.ts.
      if (item.guarded.changed && !item.typographyDropped) {
        console.warn(`[grader] Coherence Guard fired: ${item.guarded.rule}`);
      }

      tx.update(submissions).set({
        status: 'graded',
        failureReason: null,
        // Both, deliberately: keeping only the guarded value makes the Verdict's
        // run-to-run instability impossible to measure later (ADR 0003).
        proposedVerdict: item.proposedVerdict,
        guardedVerdict: item.guarded.verdict,
        typographyDropped: item.typographyDropped,
        feedbackRu: item.response.feedback_ru,
        corrected: item.response.corrected,
      }).where(eq(submissions.id, submissionId)).run();

      // Replaced rather than added to: an answer graded again after a failure
      // must not carry the Errors of a run that never finished.
      replaceSubmissionErrors(tx, submissionId, item.response.errors);
    }
  });
}

/**
 * Judges everything an attempt is still waiting on.
 *
 * Started eagerly by its caller and deliberately not awaited: whether anybody is
 * reading the review changes nothing about whether the judgements land.
 */
export async function gradeAttempt(db: Db, attemptId: number): Promise<void> {
  if (inFlight.has(attemptId)) return;

  const request = batchRequestFor(db, attemptId);
  if (request === null) return;

  inFlight.add(attemptId);
  try {
    const submissionIds = [...request.submissionByExercise.values()];
    const outcome = await gradeBatch({
      model: request.model, context: request.context, instructions: request.instructions,
      effort: request.effort,
    });

    if (!outcome.ok) {
      markBatchFailed(db, submissionIds, `${outcome.failure.kind}: ${outcome.failure.reason}`);
      return;
    }

    recordBatch(db, outcome.judged, request.submissionByExercise);
  } catch (error: unknown) {
    // The contract promises no exception path. Even an unexpected throw leaves
    // the attempt in a state the Student can act on rather than in limbo.
    console.error('[tests] an attempt could not be judged', error);
    const stillAwaiting = batchRequestFor(db, attemptId);
    markBatchFailed(db, stillAwaiting === null ? [] : [...stillAwaiting.submissionByExercise.values()],
      `sdk: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    inFlight.delete(attemptId);
  }
}
