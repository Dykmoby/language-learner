// Seam 2 — where the Student stands, derived from their Submissions.
//
// The HTTP suite proves these rules end to end; this proves them one at a time,
// including the states a real walk-through cannot easily produce, and without a
// database, because the function reads none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceProgress, REVEAL_AFTER_FAILED_ATTEMPTS } from '../src/practice/progress.ts';
import type { ExerciseRow, SubmissionRow, SubmissionStatus } from '../src/db/schema.ts';
import type { Verdict } from '../src/grader/contract.ts';

function exercise(id: number, position: number): ExerciseRow {
  return {
    id, position, exerciseSetId: 1, kind: 'fill_gap',
    prompt: `Задание ${position}`, referenceAnswer: 'a',
    acceptedAnswers: ['a'], caseSensitive: false, choices: [],
  };
}

let attempts = 0;
function submission(
  exerciseId: number,
  status: SubmissionStatus,
  guardedVerdict: Verdict | null = null,
): SubmissionRow {
  attempts += 1;
  return {
    id: attempts, studentId: 1, exerciseId, attempt: attempts, answer: 'the',
    // A Practice Submission, so it belongs to no Test attempt.
    testAttemptId: null,
    status, failureReason: null, proposedVerdict: guardedVerdict, guardedVerdict,
    feedbackRu: null, corrected: null, createdAt: new Date(),
  };
}

const THREE = [exercise(10, 1), exercise(20, 2), exercise(30, 3)];

test('with nothing submitted, the first Exercise is current and the rest are not reached', () => {
  const progress = practiceProgress(THREE, []);
  assert.deepEqual(progress.exercises.map((p) => p.state), ['current', 'not_reached', 'not_reached']);
  assert.equal(progress.currentExerciseId, 10);
  assert.equal(progress.complete, false);
});

test('a correct Submission completes an Exercise and the next becomes current', () => {
  const progress = practiceProgress(THREE, [submission(10, 'graded', 'correct')]);
  assert.deepEqual(progress.exercises.map((p) => p.state), ['completed', 'current', 'not_reached']);
  assert.equal(progress.currentExerciseId, 20);
});

test('neither partially_correct nor incorrect advances the Student', () => {
  // ADR 0003 — which is precisely why the label's instability between those two
  // does not affect progression.
  for (const verdict of ['partially_correct', 'incorrect'] as const) {
    const progress = practiceProgress(THREE, [submission(10, 'graded', verdict)]);
    assert.equal(progress.currentExerciseId, 10, `${verdict} keeps the Student on the Exercise`);
    assert.equal(progress.exercises[0]!.failedAttempts, 1);
  }
});

test('a grading_failed Submission counts for nothing at all', () => {
  const progress = practiceProgress(THREE, [
    submission(10, 'grading_failed'),
    submission(10, 'grading_failed'),
    submission(10, 'grading_failed'),
    submission(10, 'grading_failed'),
  ]);
  assert.equal(progress.exercises[0]!.failedAttempts, 0, 'a flaky call is not held against the Student');
  assert.equal(progress.exercises[0]!.revealOffered, false, 'and never walks them toward Reveal');
  assert.equal(progress.currentExerciseId, 10);
});

test('Reveal is offered on the third failed attempt and not before', () => {
  const rows: SubmissionRow[] = [];
  const offered: boolean[] = [];
  for (let i = 0; i < REVEAL_AFTER_FAILED_ATTEMPTS; i += 1) {
    rows.push(submission(10, 'graded', 'incorrect'));
    offered.push(practiceProgress(THREE, rows).exercises[0]!.revealOffered);
  }
  assert.deepEqual(offered, [false, false, true]);
});

test('a revealed Exercise is Completed With Help — complete, and counted apart', () => {
  const progress = practiceProgress(THREE, [
    submission(10, 'graded', 'incorrect'),
    submission(10, 'graded', 'incorrect'),
    submission(10, 'graded', 'incorrect'),
    submission(10, 'revealed'),
  ]);

  assert.equal(progress.exercises[0]!.state, 'completed_with_help');
  assert.equal(progress.currentExerciseId, 20, 'it moves the Student on');
  assert.deepEqual(progress.counts, { completed: 0, completedWithHelp: 1, total: 3 });
});

test('Completed With Help counts as complete for finishing the Lesson', () => {
  const progress = practiceProgress(THREE, [
    submission(10, 'graded', 'correct'),
    submission(20, 'revealed'),
    submission(30, 'graded', 'correct'),
  ]);

  assert.equal(progress.complete, true);
  assert.equal(progress.currentExerciseId, null);
  assert.deepEqual(progress.counts, { completed: 2, completedWithHelp: 1, total: 3 });
});

test('the current Exercise is the first unfinished one, whatever order the rows arrive in', () => {
  const progress = practiceProgress(THREE, [
    submission(30, 'graded', 'correct'),
    submission(10, 'graded', 'correct'),
  ]);
  assert.deepEqual(progress.exercises.map((p) => p.state), ['completed', 'current', 'completed']);
  assert.equal(progress.currentExerciseId, 20, 'not simply the last one worked on');
});

test('an empty Practice is not a finished one', () => {
  const progress = practiceProgress([], []);
  assert.equal(progress.complete, false, 'a Lesson with no Exercises must not unlock the next');
  assert.equal(progress.currentExerciseId, null);
});
