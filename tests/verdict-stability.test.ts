// Seam 2 — the reading half of the Verdict-instability measurement.
//
// The measurement itself spends real Grader calls and lives in
// `src/ops/verdict-stability.ts`. What is tested here is what it concludes from
// what came back, because that is the part that has to be right for the numbers
// in design.md § Measured baseline to mean what they say — and the one part that
// can be exercised without a model.
//
// The distinction it exists to draw: a model that returns two labels off one
// error list is unstable about the label, and a model that returns two labels
// off two different error lists is reading the answer differently each time.
// Those are different problems with different fixes, and a summary that ran them
// together would hide the finding the anecdote in § Open risks actually claimed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distribution, errorSignature, summarise, type Run } from '../src/ops/verdict-stability.ts';
import type { GraderError } from '../src/grader/contract.ts';

const ARTICLE: GraderError = { type: 'article', span: 'have cat', explanation_ru: 'Пропущен артикль «a».' };
const AGREEMENT: GraderError = { type: 'agreement', span: 'she like', explanation_ru: 'Нужно «likes».' };

function run(proposed: Run['proposed'], guarded: Run['guarded'], errors: string | null): Run {
  return { proposed, guarded, errors, failure: null, wallMs: 5000, costUsd: null };
}

test('the same faults in a different order are the same error list', () => {
  // Two runs that found the same two faults have not disagreed about anything,
  // and counting the order as a difference would report instability that is not
  // there — the opposite of what this measurement is for.
  assert.equal(
    errorSignature([ARTICLE, AGREEMENT]),
    errorSignature([AGREEMENT, ARTICLE]),
  );
});

test('the Russian explanation is not part of the comparison', () => {
  // It is prose. Two runs that found the same fault will word it differently,
  // and a signature that included the wording would call that a changed list.
  const reworded: GraderError = { ...ARTICLE, explanation_ru: 'Здесь нужен артикль.' };
  assert.equal(errorSignature([ARTICLE]), errorSignature([reworded]));
});

test('no Errors is its own signature rather than an empty string', () => {
  assert.equal(errorSignature([]), '(none)');
});

test('a label that moves while the error list stays put is reported as exactly that', () => {
  // The anecdote § Open risks recorded, in the shape the summary has to
  // recognise: five identical calls, three labels one way and two the other,
  // with an identical error list every time.
  const errors = errorSignature([ARTICLE, AGREEMENT]);
  const summary = summarise([
    run('partially_correct', 'partially_correct', errors),
    run('partially_correct', 'partially_correct', errors),
    run('partially_correct', 'partially_correct', errors),
    run('incorrect', 'incorrect', errors),
    run('incorrect', 'incorrect', errors),
  ]);

  assert.deepEqual(summary.proposed, [['partially_correct', 3], ['incorrect', 2]]);
  assert.equal(summary.errorLists.length, 1, 'one error list across all five runs');
  assert.equal(summary.labelMovedAlone, true);
  assert.equal(summary.guardFirings, 0, 'and the guard had nothing to do with it');
});

test('a label that moves because the faults moved is not the same finding', () => {
  const summary = summarise([
    run('partially_correct', 'partially_correct', errorSignature([ARTICLE])),
    run('incorrect', 'incorrect', errorSignature([ARTICLE, AGREEMENT])),
  ]);

  assert.equal(summary.labelMovedAlone, false, 'the model read the answer differently, which is a different problem');
});

test('a Coherence Guard firing is counted apart from the model moving', () => {
  // Both Verdicts are stored precisely so these two can be told apart (ADR 0003).
  // A run where the guard corrected an incoherent label is not evidence that the
  // model is unstable, and adding it to the distribution would say it was.
  const summary = summarise([
    run('correct', 'partially_correct', errorSignature([ARTICLE])),
    run('partially_correct', 'partially_correct', errorSignature([ARTICLE])),
  ]);

  assert.equal(summary.guardFirings, 1);
  assert.deepEqual(summary.guarded, [['partially_correct', 2]], 'what the Student would have read, twice the same');
  assert.deepEqual(summary.proposed, [['correct', 1], ['partially_correct', 1]], 'and what the model proposed, twice different');
});

test('a failed call is counted as a failure rather than as a Verdict', () => {
  const summary = summarise([
    run('correct', 'correct', '(none)'),
    { proposed: null, guarded: null, errors: null, failure: 'sdk: 429', wallMs: 700, costUsd: null },
  ]);

  assert.equal(summary.runs, 2);
  assert.equal(summary.failures, 1);
  assert.deepEqual(summary.guarded, [['correct', 1]], 'the failure is not a third label');
});

test('the distribution is ordered by how often each value came back', () => {
  assert.deepEqual(
    distribution(['b', 'a', 'b', 'c', 'b', 'a']),
    [['b', 3], ['a', 2], ['c', 1]],
  );
});
