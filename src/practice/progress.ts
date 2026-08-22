// Where a Student stands in a Practice, derived from their Submissions.
//
// Derived, never stored: a completion flag alongside the Submissions is a second
// source of truth, and the two disagree the first time anything writes one
// without the other. The cost is a query and this function; the benefit is that
// there is exactly one answer to "has this Exercise been done".
//
// Pure over rows the caller has already read, so every progression rule is
// testable without a database.

import type { DisputeRow, DisputeRuling, ExerciseRow, SubmissionRow } from '../db/schema.ts';

// design.md § Progression. Completed With Help counts as complete and renders as
// its own segment — a Student who revealed half the Lesson should be able to see
// that they did.
//
// 'disputed' is the same idea for an objection: not passed and not failed,
// because it is neither and rendering it as either would be a claim nobody has
// made yet. It is behind the Student either way — design.md § Progression puts
// the unblocking at the moment the objection is made, and an Exercise that held
// them until somebody woke up would be an Exercise that ended the study session.
export const EXERCISE_STATES = [
  'completed', 'completed_with_help', 'disputed', 'current', 'not_reached',
] as const;
export type ExerciseState = (typeof EXERCISE_STATES)[number];

/** After three failed attempts, Reveal is offered — offered, not forced. */
export const REVEAL_AFTER_FAILED_ATTEMPTS = 3;

export type ExerciseProgress = {
  exerciseId: number;
  position: number;
  state: ExerciseState;
  /**
   * Attempts that count against the Student. A grading_failed Submission is not
   * one of them: a flaky call must not walk anyone toward Reveal.
   */
  failedAttempts: number;
  revealOffered: boolean;
  /** The most recent judged Submission, so a reload shows the last feedback. */
  latest: SubmissionRow | null;
  /**
   * The objection standing against this Exercise, if one was made — which
   * Submission it was against, and what an Admin ruled, if anything yet.
   */
  dispute: { submissionId: number; ruling: DisputeRuling | null } | null;
};

export type PracticeProgress = {
  exercises: ExerciseProgress[];
  /** The Exercise the Student is working on: the first one not yet behind them. */
  currentExerciseId: number | null;
  /**
   * Nothing is left for the Student to work on — which is what unlocks the next
   * Lesson. Not the same question as "how much of it did they get right": a
   * disputed Exercise is behind them without having been completed, and `counts`
   * is where that shows.
   */
  complete: boolean;
  /** Counted the way the progress bar shows them. */
  counts: { completed: number; completedWithHelp: number; disputed: number; total: number };
};

/**
 * Completed With Help counts as complete. One rule, exported, because every
 * caller that asks "is this Exercise behind the Student" must answer it the same
 * way — a second copy is how a revealed Exercise starts being answerable again.
 */
export function isComplete(state: ExerciseState): boolean {
  return state === 'completed' || state === 'completed_with_help';
}

/**
 * Whether the Student has moved past this Exercise, whether or not they finished
 * it. Completion is one of the ways; an open objection is the other, and it is
 * deliberately not the same question — a disputed Exercise stops blocking without
 * ever becoming a pass, and folding the two together would either strand a
 * Student behind their own objection or count it as work done.
 */
export function isBehind(state: ExerciseState): boolean {
  return isComplete(state) || state === 'disputed';
}

export function practiceProgress(
  exercises: readonly ExerciseRow[],
  submissions: readonly SubmissionRow[],
  // Rows, and required rather than optional: a caller that has not answered
  // whether this Student objected to anything would silently re-lock every
  // Exercise they disputed.
  disputes: readonly DisputeRow[],
): PracticeProgress {
  const disputeBySubmission = new Map(disputes.map((row) => [row.submissionId, row]));

  const byExercise = new Map<number, SubmissionRow[]>();
  for (const submission of submissions) {
    const list = byExercise.get(submission.exerciseId);
    if (list) list.push(submission);
    else byExercise.set(submission.exerciseId, [submission]);
  }

  const ordered = [...exercises].sort((a, b) => a.position - b.position);

  const progress: ExerciseProgress[] = ordered.map((exercise) => {
    const rows = (byExercise.get(exercise.id) ?? []).slice().sort((a, b) => a.attempt - b.attempt);

    const solved = rows.some((r) => r.status === 'graded' && r.guardedVerdict === 'correct');
    const revealed = rows.some((r) => r.status === 'revealed');

    // At most one, because one objection per Submission is a unique constraint
    // and an Exercise stops being answerable the moment it is disputed. `find`
    // rather than `filter` says so.
    const objection = rows.map((r) => disputeBySubmission.get(r.id)).find((d) => d !== undefined);
    const failedAttempts = rows.filter((r) => r.status === 'graded' && r.guardedVerdict !== 'correct').length;
    const judged = rows.filter((r) => r.status === 'graded');

    return {
      exerciseId: exercise.id,
      position: exercise.position,
      // Solved unaided wins over revealed: neither can normally happen after the
      // other, and if both are somehow present the honest reading is the harder
      // one. An upheld Dispute joins the first of those — the Student was right,
      // and an Admin has said so. A rejected one joins neither: the Verdict
      // stood, so it is not a pass, but it stays behind them, because sending
      // someone back to an Exercise they moved past a week ago would punish them
      // for having objected.
      state: solved || objection?.ruling === 'upheld' ? 'completed'
        : revealed ? 'completed_with_help'
        : objection ? 'disputed'
        : 'not_reached',
      failedAttempts,
      revealOffered: failedAttempts >= REVEAL_AFTER_FAILED_ATTEMPTS,
      latest: judged.at(-1) ?? null,
      dispute: objection === undefined
        ? null
        : { submissionId: objection.submissionId, ruling: objection.ruling },
    };
  });

  const currentIndex = progress.findIndex((p) => !isBehind(p.state));
  if (currentIndex !== -1) progress[currentIndex]!.state = 'current';

  return {
    exercises: progress,
    currentExerciseId: currentIndex === -1 ? null : progress[currentIndex]!.exerciseId,
    complete: currentIndex === -1 && progress.length > 0,
    counts: {
      completed: progress.filter((p) => p.state === 'completed').length,
      completedWithHelp: progress.filter((p) => p.state === 'completed_with_help').length,
      disputed: progress.filter((p) => p.state === 'disputed').length,
      total: progress.length,
    },
  };
}
