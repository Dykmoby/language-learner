// Where an attempt at a Test stands, derived from the answers it holds.
//
// Derived, never stored — the rule the Practice's progress already follows, for
// the same reason: a score written down beside the Submissions is a second
// source of truth, and the two disagree the first time anything writes one
// without the other.
//
// Derived from **the attempt's own answers**, not from the Test's current
// Exercises. One answer per Exercise is written when the attempt is submitted, so
// the two agree at that moment and can only diverge afterwards — and afterwards
// is exactly when they must not be conflated. An Exercise added to the Test next
// week was never put to this Student, and scoring it against them, or leaving the
// attempt for ever unfinished waiting for an answer nobody was asked for, would
// both be wrong.
//
// Pure over rows the caller has already read, so every rule here is testable
// without a database. The one that matters most is that an unfinished judgement
// is not a zero: a batch that has not landed, or one that failed, leaves the
// attempt with no score at all rather than with a bad one.

import type { SubmissionRow } from '../db/schema.ts';

export const ATTEMPT_STATES = ['grading', 'grading_failed', 'scored'] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];

export type AttemptOutcome = {
  state: AttemptState;
  /** Answers judged correct. Partially correct is not correct — a Test is a mirror. */
  correct: number;
  judged: number;
  total: number;
  /**
   * Percentage correct, rounded — and null until every answer has been judged.
   * The rounded number is also what decides `passed`, so the Student is never
   * shown 80% beside a failure.
   */
  scorePercent: number | null;
  passed: boolean | null;
};

/** Whether this Submission counts towards the score. */
function isCorrect(row: SubmissionRow): boolean {
  return row.status === 'graded' && row.guardedVerdict === 'correct';
}

export function attemptOutcome(
  answers: readonly SubmissionRow[],
  passThreshold: number,
): AttemptOutcome {
  const total = answers.length;
  const judged = answers.filter((row) => row.status === 'graded').length;
  const correct = answers.filter((row) => isCorrect(row)).length;

  const awaiting = answers.some((row) => row.status === 'awaiting_grading');
  const failed = answers.some((row) => row.status === 'grading_failed');

  const state: AttemptState = awaiting ? 'grading' : failed ? 'grading_failed' : 'scored';
  if (state !== 'scored' || total === 0) {
    return { state, correct, judged, total, scorePercent: null, passed: null };
  }

  const scorePercent = Math.round((correct / total) * 100);
  return { state, correct, judged, total, scorePercent, passed: scorePercent >= passThreshold };
}
