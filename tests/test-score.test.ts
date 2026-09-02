// Seam 2 — an attempt's score, derived from its answers.
//
// The states a real walk-through cannot produce on demand are the point: a batch
// that has not landed, and one that failed. Neither may be read as a zero.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptOutcome } from '../src/tests/score.ts';
import type { SubmissionRow, SubmissionStatus } from '../src/db/schema.ts';
import type { Verdict } from '../src/grader/contract.ts';

let rows = 0;
function answer(
  exerciseId: number,
  status: SubmissionStatus,
  guardedVerdict: Verdict | null = null,
): SubmissionRow {
  rows += 1;
  return {
    id: rows, studentId: 1, exerciseId, attempt: 1, answer: 'a', testAttemptId: 9,
    status, failureReason: null, proposedVerdict: guardedVerdict, guardedVerdict,
    typographyDropped: false,
    feedbackRu: null, corrected: null, createdAt: new Date(),
  };
}

test('every answer judged: the score is the percentage correct, against the threshold', () => {
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'graded', 'correct'),
    answer(30, 'graded', 'correct'),
    answer(40, 'graded', 'correct'),
    answer(50, 'graded', 'incorrect'),
  ], 80);

  assert.equal(outcome.state, 'scored');
  assert.equal(outcome.correct, 4);
  assert.equal(outcome.scorePercent, 80);
  assert.equal(outcome.passed, true, '80 clears a threshold of 80');
});

test('partially correct is not correct — a Test is a mirror, not a negotiation', () => {
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'graded', 'partially_correct'),
  ], 80);

  assert.equal(outcome.correct, 1);
  assert.equal(outcome.scorePercent, 50);
  assert.equal(outcome.passed, false);
});

test('an attempt still being graded has no score at all', () => {
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'awaiting_grading'),
  ], 80);

  assert.equal(outcome.state, 'grading');
  assert.equal(outcome.scorePercent, null, 'an unfinished judgement is not a zero');
  assert.equal(outcome.passed, null);
  assert.equal(outcome.correct, 1, 'what is known is still known');
});

test('a failed batch leaves the attempt unscored rather than failed on the merits', () => {
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'grading_failed'),
  ], 80);

  assert.equal(outcome.state, 'grading_failed');
  assert.equal(outcome.scorePercent, null);
  assert.equal(outcome.passed, null);
});

test('an answer still awaiting judgement outranks one that failed', () => {
  // Both present: the batch is still out for one Exercise, so the attempt is not
  // finished failing either.
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'grading_failed'),
    answer(30, 'awaiting_grading'),
  ], 80);

  assert.equal(outcome.state, 'grading');
});

test('an attempt is the answers it holds, whatever the Test looks like afterwards', () => {
  // An Exercise added to the Test next week was never put to this Student. It
  // must neither count against them nor leave the attempt for ever unfinished,
  // waiting on an answer nobody was ever asked for.
  const outcome = attemptOutcome([
    answer(10, 'graded', 'correct'),
    answer(20, 'graded', 'correct'),
  ], 80);

  assert.equal(outcome.state, 'scored');
  assert.equal(outcome.total, 2, 'two answers, out of two');
  assert.equal(outcome.scorePercent, 100);
});

test('the rounded score is what decides the pass, so the two never disagree', () => {
  // 4 of 7 is 57.14…, and what matters is that the number the Student is shown is
  // the number the threshold is compared against — never 57% beside a failure.
  const outcome = attemptOutcome(
    [1, 2, 3, 4, 5, 6, 7].map((n, i) => answer(n * 10, 'graded', i < 4 ? 'correct' : 'incorrect')),
    57,
  );

  assert.equal(outcome.scorePercent, 57);
  assert.equal(outcome.passed, true);
});

test('an attempt with no answers has no score to give', () => {
  const outcome = attemptOutcome([], 80);
  assert.equal(outcome.scorePercent, null);
  assert.equal(outcome.total, 0);
});
