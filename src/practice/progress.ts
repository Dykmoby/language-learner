// Where a Student stands in a Practice, derived from their Submissions.
//
// Derived, never stored: a completion flag alongside the Submissions is a second
// source of truth, and the two disagree the first time anything writes one
// without the other. The cost is a query and this function; the benefit is that
// there is exactly one answer to "has this Exercise been done".
//
// Pure over rows the caller has already read, so every progression rule is
// testable without a database.

import type { ExerciseRow, SubmissionRow } from '../db/schema.ts';

// design.md § Progression. Completed With Help counts as complete and renders as
// its own segment — a Student who revealed half the Lesson should be able to see
// that they did.
export const EXERCISE_STATES = ['completed', 'completed_with_help', 'current', 'not_reached'] as const;
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
};

export type PracticeProgress = {
  exercises: ExerciseProgress[];
  /** The Exercise the Student is working on: the first one not yet complete. */
  currentExerciseId: number | null;
  complete: boolean;
  /** Counted the way the progress bar shows them. */
  counts: { completed: number; completedWithHelp: number; total: number };
};

/**
 * Completed With Help counts as complete. One rule, exported, because every
 * caller that asks "is this Exercise behind the Student" must answer it the same
 * way — a second copy is how a revealed Exercise starts being answerable again.
 */
export function isComplete(state: ExerciseState): boolean {
  return state === 'completed' || state === 'completed_with_help';
}

export function practiceProgress(
  exercises: readonly ExerciseRow[],
  submissions: readonly SubmissionRow[],
): PracticeProgress {
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
    const failedAttempts = rows.filter((r) => r.status === 'graded' && r.guardedVerdict !== 'correct').length;
    const judged = rows.filter((r) => r.status === 'graded');

    return {
      exerciseId: exercise.id,
      position: exercise.position,
      // Solved unaided wins over revealed: neither can normally happen after the
      // other, and if both are somehow present the honest reading is the harder one.
      state: solved ? 'completed' : revealed ? 'completed_with_help' : 'not_reached',
      failedAttempts,
      revealOffered: failedAttempts >= REVEAL_AFTER_FAILED_ATTEMPTS,
      latest: judged.at(-1) ?? null,
    };
  });

  const currentIndex = progress.findIndex((p) => !isComplete(p.state));
  if (currentIndex !== -1) progress[currentIndex]!.state = 'current';

  return {
    exercises: progress,
    currentExerciseId: currentIndex === -1 ? null : progress[currentIndex]!.exerciseId,
    complete: currentIndex === -1 && progress.length > 0,
    counts: {
      completed: progress.filter((p) => p.state === 'completed').length,
      completedWithHelp: progress.filter((p) => p.state === 'completed_with_help').length,
      total: progress.length,
    },
  };
}
