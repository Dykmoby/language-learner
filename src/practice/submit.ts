// A Student's answer, from the keystroke to the row in the database.
//
// Both judgement classes end in the same place: a Submission row, with its
// attempt number and both Verdicts, whichever thing produced them. Nothing
// downstream should have to ask which did — that is what makes the progress
// derivation in progress.ts a single rule rather than two.
//
// The one thing this module is careful about: grading runs to completion and
// persists server-side whether or not the client is still listening. Persistence
// is never a side effect of somebody reading the stream, because even at the
// measured 4-7s a closed tab must not lose a Submission.

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  submissions, isDeterministic,
  type ExerciseRow, type SubmissionRow, type SubmissionStatus,
} from '../db/schema.ts';
import { acceptedAnswersFor, variantsOf } from '../content/accepted.ts';
import { writeSubmissionErrors } from '../grader/errors.ts';
import type { ExerciseContext, GraderError, Language, Verdict } from '../grader/contract.ts';
import { grade, type GradeRequest, type GradingOutcome } from '../grader/grade.ts';
import { deterministicCheck } from './deterministic-check.ts';
import { disputesOn } from './disputes.ts';
import { openExercise, type LessonRefusal, type OpenExercise } from './lessons.ts';
import { isComplete, practiceProgress, type ExerciseState } from './progress.ts';
import type { ProgressionView, ResultFrame, RevealResult } from './wire.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type SubmitRefusal =
  | LessonRefusal
  | { ok: false; reason: 'already_complete' | 'not_current' | 'empty_answer' | 'not_ready' };

/**
 * Deterministic Check Exercises are settled before this function returns.
 * Grader-judged ones come back with a stream and a promise that is already
 * running — the caller may ignore both and the Submission still lands.
 */
export type StartedSubmission =
  | ({ ok: true; streamed: false } & { frame: ResultFrame })
  | { ok: true; streamed: true; deltas: AsyncIterable<string>; frame: Promise<ResultFrame> };

// --- persistence -------------------------------------------------------------

type SubmissionFields = {
  status: SubmissionStatus;
  answer: string;
  failureReason?: string | null;
  proposedVerdict?: Verdict | null;
  guardedVerdict?: Verdict | null;
  feedbackRu?: string | null;
  corrected?: string | null;
  errors?: GraderError[];
};

/**
 * One row, with the next attempt number for this Student and this Exercise —
 * per Student and per Exercise, never global. Written in a transaction so the
 * number cannot be read by one write and used by another.
 */
function writeSubmission(
  db: Db,
  studentId: number,
  exerciseId: number,
  fields: SubmissionFields,
): SubmissionRow {
  return db.transaction((tx) => {
    // Every row gets the next number, a failed grading included: the column is
    // the order the rows were written in, and the unique constraint says so.
    // Whether an attempt counts *against* the Student is a different question,
    // answered in progress.ts from the status.
    const highest = tx.select({ value: sql<number | null>`max(${submissions.attempt})` })
      .from(submissions)
      .where(and(eq(submissions.studentId, studentId), eq(submissions.exerciseId, exerciseId)))
      .get();

    const row = tx.insert(submissions).values({
      studentId,
      exerciseId,
      attempt: (highest?.value ?? 0) + 1,
      answer: fields.answer,
      status: fields.status,
      failureReason: fields.failureReason ?? null,
      proposedVerdict: fields.proposedVerdict ?? null,
      guardedVerdict: fields.guardedVerdict ?? null,
      feedbackRu: fields.feedbackRu ?? null,
      corrected: fields.corrected ?? null,
      createdAt: new Date(),
    }).returning().get();

    writeSubmissionErrors(tx, row.id, fields.errors ?? []);

    return row;
  });
}

/** Progression after a Submission lands, re-derived rather than assumed. */
function progressionAfter(
  db: Db,
  studentId: number,
  exerciseId: number,
  exercises: readonly ExerciseRow[],
  previousExerciseId: number | null,
): ProgressionView {
  const rows = exercises.length === 0 ? [] : db.select().from(submissions)
    .where(and(
      eq(submissions.studentId, studentId),
      inArray(submissions.exerciseId, exercises.map((e) => e.id)),
    ))
    .all();

  // The objections too: a disputed Exercise stops blocking the moment the
  // objection is made, and progression re-derived without them would put the
  // Student straight back on it.
  const progress = practiceProgress(exercises, rows, disputesOn(db, rows.map((row) => row.id)));
  const own = progress.exercises.find((p) => p.exerciseId === exerciseId);

  return {
    advanced: progress.currentExerciseId !== previousExerciseId,
    nextExerciseId: progress.currentExerciseId,
    lessonComplete: progress.complete,
    failedAttempts: own?.failedAttempts ?? 0,
    revealOffered: own?.revealOffered ?? false,
  };
}

/**
 * ADR 0004 — the whole of Progressive Hints: the earlier answers, oldest first,
 * and no session state anywhere. Only judged attempts count. An answer whose
 * grading failed was never read by the Grader, and handing it back as "you
 * already tried this" would sharpen the hint against something nobody saw.
 */
export function priorAnswersFor(db: Db, studentId: number, exerciseId: number): string[] {
  return db.select().from(submissions)
    .where(and(eq(submissions.studentId, studentId), eq(submissions.exerciseId, exerciseId)))
    .orderBy(submissions.attempt)
    .all()
    .filter((row) => row.status === 'graded')
    .map((row) => row.answer);
}

/**
 * Exercises are worked in the Exercise Set's order, and that is a rule about the
 * Practice rather than about the screen: presenting one Exercise at a time is
 * worth nothing if the endpoint behind it will accept an answer to any of them.
 * A Student could otherwise complete a Practice backwards.
 */
function notAnswerable(state: ExerciseState): SubmitRefusal | null {
  // A second Submission against a finished Exercise would count as an attempt at
  // work already done.
  if (isComplete(state)) return { ok: false, reason: 'already_complete' };
  if (state !== 'current') return { ok: false, reason: 'not_current' };
  return null;
}

/**
 * Everything the Grader is given, in one place: the Course's model (ADR 0002),
 * its Language and level, the Lesson's grammar focus, the Exercise prompt, the
 * Reference Answer, any Accepted Variants, and the Student's earlier attempts.
 *
 * Exported because it is the whole of what a Verdict is based on. Getting one
 * field wrong here degrades every Verdict quietly, and nothing about it can be
 * checked by looking at what a live model happens to answer.
 */
export function graderRequestFor(
  db: Db,
  studentId: number,
  opened: OpenExercise,
  answer: string,
): GradeRequest {
  const { course, lesson, exercise } = opened;

  const variants = variantsOf(db, exercise.id);

  const context: ExerciseContext = {
    language: course.language as Language,
    level: course.level,
    lessonTitle: lesson.title,
    grammarFocus: lesson.grammarFocus,
    prompt: exercise.prompt,
    referenceAnswer: exercise.referenceAnswer,
    acceptedVariants: variants,
    priorSubmissions: priorAnswersFor(db, studentId, exercise.id),
  };

  // Per Course, never per code branch — ADR 0002 puts the choice in the data.
  return { model: course.graderModel, context, submission: answer };
}

// --- submitting --------------------------------------------------------------

export function submitAnswer(
  db: Db,
  studentId: number,
  exerciseId: number,
  answer: string,
): StartedSubmission | SubmitRefusal {
  const opened = openExercise(db, studentId, exerciseId);
  if (!opened.ok) return opened;

  const refusal = notAnswerable(opened.exerciseProgress.state);
  if (refusal) return refusal;
  if (answer.trim() === '') return { ok: false, reason: 'empty_answer' };

  const { exercise, exercises, progress } = opened;
  const previousExerciseId = progress.currentExerciseId;

  if (isDeterministic(exercise.kind)) {
    // The authored list *and* the Accepted Variants — CONTEXT.md § Deterministic
    // Check names both. Without the second, upholding a Dispute on a fill-gap
    // would write a variant nothing ever consults.
    const outcome = deterministicCheck(answer, acceptedAnswersFor(db, exercise), {
      caseSensitive: exercise.caseSensitive,
    });
    // Both Verdict columns are set from the comparison, exactly as they are set
    // from the Grader on the other path (ADR 0003 asks for both; here they agree
    // by construction, and a row that recorded only one would read differently
    // from a Grader-judged row for no reason).
    const verdict: Verdict = outcome.correct ? 'correct' : 'incorrect';

    const row = writeSubmission(db, studentId, exerciseId, {
      status: 'graded',
      answer,
      proposedVerdict: verdict,
      guardedVerdict: verdict,
      // Never the Reference Answer on a wrong answer: that is what Reveal is for,
      // and it is offered after three attempts, not after one.
      corrected: outcome.correct ? outcome.matched : null,
    });

    return {
      ok: true,
      streamed: false,
      frame: {
        t: 'result',
        status: 'graded',
        submissionId: row.id,
        verdict,
        feedbackRu: null,
        corrected: outcome.correct ? outcome.matched : null,
        errors: [],
        progression: progressionAfter(db, studentId, exerciseId, exercises, previousExerciseId),
      },
    };
  }

  const handle = grade(graderRequestFor(db, studentId, opened, answer));

  // Started here, not inside the stream: the chain below is running before this
  // function returns and completes on its own. Whether anyone reads `frame` — or
  // the deltas — changes nothing about whether the row gets written.
  //
  // It resolves and never rejects, for the same reason grade() does: a caller
  // that has already lost its client must not be handed a rejection nobody is
  // there to catch.
  const frame = handle.result
    .then((outcome) =>
      recordGrading(db, { studentId, exerciseId, answer, outcome, exercises, previousExerciseId }))
    .catch((error: unknown): ResultFrame => {
      console.error('[practice] a Submission could not be persisted', error);
      return {
        t: 'result',
        status: 'grading_failed',
        // Nothing was persisted — this is the path where persistence itself
        // threw — so there is no row to object to.
        submissionId: null,
        verdict: null,
        feedbackRu: null,
        corrected: null,
        errors: [],
        progression: {
          advanced: false, nextExerciseId: previousExerciseId, lessonComplete: false,
          failedAttempts: opened.exerciseProgress.failedAttempts,
          revealOffered: opened.exerciseProgress.revealOffered,
        },
      };
    });

  return { ok: true, streamed: true, deltas: handle.deltas, frame };
}

export type GradingRecord = {
  studentId: number;
  exerciseId: number;
  answer: string;
  outcome: GradingOutcome;
  /** The Exercise Set, so progression can be re-derived once the row is in. */
  exercises: readonly ExerciseRow[];
  previousExerciseId: number | null;
};

/**
 * Turns one terminal GradingOutcome into the row, its Errors and the frame the
 * browser gets. Exported because it is the only part of the Grader path that a
 * hermetic test can reach: what a live model returns cannot be chosen, and the
 * cases that matter here — an incoherent Verdict, an invented Error Type, a
 * failure — are exactly the ones it will not produce on demand.
 */
export function recordGrading(db: Db, record: GradingRecord): ResultFrame {
  const { studentId, exerciseId, answer, outcome, exercises, previousExerciseId } = record;
  if (!outcome.ok) {
    // Measured at roughly 1 call in 24. The row exists so the Student's words are
    // not lost, and its status is what keeps it out of the attempt count.
    const row = writeSubmission(db, studentId, exerciseId, {
      status: 'grading_failed',
      answer,
      failureReason: `${outcome.failure.kind}: ${outcome.failure.reason}`,
    });

    return {
      t: 'result',
      status: 'grading_failed',
      // Named, but not disputable: only a judgement can be objected to, and this
      // answer was never judged. The endpoint refuses it rather than the frame
      // hiding it, so a Student who tries is told why.
      submissionId: row.id,
      // No Verdict, and no errors: a failure must never be rendered as a wrong
      // answer, so there is nothing here that could be mistaken for one.
      verdict: null,
      feedbackRu: null,
      corrected: null,
      errors: [],
      progression: progressionAfter(db, studentId, exerciseId, exercises, previousExerciseId),
    };
  }

  const { response, proposedVerdict, guarded } = outcome;

  if (outcome.unknownErrorTypes.length > 0) {
    // Stored as it came — dropping the Error would hide a real fault from the
    // Student — but recorded in the log, because an invented Error Type is a
    // contract violation and the histogram in step 7 will trip over it.
    console.warn(`[grader] unknown Error Type(s): ${outcome.unknownErrorTypes.join(', ')}`);
  }
  if (guarded.changed) {
    console.warn(`[grader] Coherence Guard fired: ${guarded.rule}`);
  }

  const row = writeSubmission(db, studentId, exerciseId, {
    status: 'graded',
    answer,
    // Both, deliberately: keeping only the guarded value makes the Verdict's
    // run-to-run instability impossible to measure later (ADR 0003).
    proposedVerdict,
    guardedVerdict: guarded.verdict,
    feedbackRu: response.feedback_ru,
    corrected: response.corrected,
    errors: response.errors,
  });

  return {
    t: 'result',
    status: 'graded',
    submissionId: row.id,
    verdict: guarded.verdict,
    feedbackRu: response.feedback_ru,
    corrected: response.corrected,
    errors: response.errors.map((error) => ({
      type: error.type,
      span: error.span,
      explanationRu: error.explanation_ru,
    })),
    progression: progressionAfter(db, studentId, exerciseId, exercises, previousExerciseId),
  };
}

// --- revealing ---------------------------------------------------------------

export function revealAnswer(
  db: Db,
  studentId: number,
  exerciseId: number,
): ({ ok: true } & RevealResult) | SubmitRefusal {
  const opened = openExercise(db, studentId, exerciseId);
  if (!opened.ok) return opened;

  const refusal = notAnswerable(opened.exerciseProgress.state);
  if (refusal) return refusal;
  // Offered after three failed attempts, and not before — asking for it earlier
  // is refused by the server, not merely by a hidden button.
  if (!opened.exerciseProgress.revealOffered) return { ok: false, reason: 'not_ready' };

  const { exercise, exercises, progress } = opened;
  const previousExerciseId = progress.currentExerciseId;

  // A Submission, so completion stays derived from Submissions and Completed With
  // Help is a fact about what happened rather than a flag someone set. The answer
  // is empty because the Student did not give one; the Reference Answer goes in
  // `corrected`, which is where the answer they should have written already lives.
  writeSubmission(db, studentId, exerciseId, {
    status: 'revealed',
    answer: '',
    corrected: exercise.referenceAnswer,
  });

  return {
    ok: true,
    referenceAnswer: exercise.referenceAnswer,
    progression: progressionAfter(db, studentId, exerciseId, exercises, previousExerciseId),
  };
}
