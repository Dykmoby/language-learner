// Issue #78 — typography is not language, and the Grader stops costing a Student
// a Verdict over it.
//
// Two mechanisms, tested apart because one is a request and the other is a
// guarantee. The prompt asks the model to file case, terminal punctuation and
// whitespace under `typography`; the server drops that type before the Coherence
// Guard sees it. When the model ignores the request — which is the case a live
// call cannot be made to produce on demand — the backstop fires on the one fact
// that settles it: the Student's answer and the corrected form differ by nothing
// but the normalisation the Deterministic Check already performs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coherenceGuard, buildSystemPrompt, errorTypesFor, type GraderError } from '../src/grader/contract.ts';
import { withoutTypography } from '../src/grader/typography.ts';
import { SHIPPED_GUIDANCE } from '../src/grader/guidance.ts';

function err(type: string, span = 'x'): GraderError {
  return { type, span, explanation_ru: 'причина' };
}

// --- the enum ----------------------------------------------------------------

test('typography is a core Error Type in both Languages', () => {
  assert.ok(errorTypesFor('en').includes('typography'));
  assert.ok(errorTypesFor('tj').includes('typography'));
});

test('the prompt tells the Grader what belongs under typography and what does not', () => {
  const system = buildSystemPrompt('en', SHIPPED_GUIDANCE);
  assert.ok(system.includes('typography'), 'the type is offered');
  // The distinction this ticket exists to draw. Asserted on the prompt because
  // it cannot be asserted on the model.
  assert.match(system, /comma/i, 'a missing comma is named as real punctuation');
});

// --- the drop ----------------------------------------------------------------

test('a typography Error never survives, however different the answer is', () => {
  const kept = withoutTypography(
    [err('typography', 'i'), err('article', 'have cat')],
    'i have cat',
    'I have a cat.',
  );
  assert.deepEqual(kept.map((e) => e.type), ['article']);
});

test('a lowercase sentence with a real fault keeps the real fault and is not correct', () => {
  const kept = withoutTypography([err('typography'), err('article')], 'i have cat', 'I have a cat.');
  assert.equal(coherenceGuard('partially_correct', kept).verdict, 'partially_correct');
});

// --- the backstop ------------------------------------------------------------

test('when only typography separates the two forms, the Grader\'s own nitpicks are dropped too', () => {
  // The model ignored the instruction and reported capitalization anyway. The
  // answer and the corrected form are the same sentence, so there is nothing
  // else the Error could be about.
  const kept = withoutTypography([err('capitalization', 'i')], 'i have a cat', 'I have a cat.');
  assert.deepEqual(kept, []);
  assert.equal(coherenceGuard('partially_correct', kept).verdict, 'correct');
});

test('the backstop covers the trailing full stop and stray whitespace as well as case', () => {
  for (const [answer, corrected] of [
    ['I have a cat', 'I have a cat.'],
    ['I  have   a cat.', 'I have a cat.'],
    ['  i have a  cat  ', 'I have a cat.'],
  ] as const) {
    const kept = withoutTypography([err('punctuation'), err('capitalization')], answer, corrected);
    assert.deepEqual(kept, [], `${JSON.stringify(answer)} differs from the correction only in typography`);
  }
});

test('a missing comma survives the backstop, because the two forms are not the same sentence', () => {
  // The distinction the whole ticket turns on: an internal comma is a real
  // difference between the strings, so the backstop does not fire.
  const kept = withoutTypography([err('punctuation', 'cat and')], 'I have a cat and a dog', 'I have a cat, and a dog.');
  assert.deepEqual(kept.map((e) => e.type), ['punctuation']);
  assert.notEqual(coherenceGuard('partially_correct', kept).verdict, 'correct');
});

test('a lowercased proper noun survives, because the correction changed a word', () => {
  const kept = withoutTypography([err('capitalization', 'london')], 'I live in london town', 'I live in London Town.');
  assert.deepEqual(kept.map((e) => e.type), ['capitalization']);
});

test('the backstop does not drop a fault of another type', () => {
  // Identical once normalised, so the backstop fires — but only over the three
  // types it is about. Anything else is a real report the model made about a
  // sentence that is otherwise unchanged, and dropping it would hide it.
  const kept = withoutTypography([err('capitalization'), err('register_style')], 'i have a cat', 'I have a cat.');
  assert.deepEqual(kept.map((e) => e.type), ['register_style']);
});

test('an empty Error list stays empty and stays correct', () => {
  assert.deepEqual(withoutTypography([], 'I have a cat.', 'I have a cat.'), []);
});

// --- where the case fold stops -----------------------------------------------

test('a capital in the middle of a sentence is a fact about the word, not typography', () => {
  // The narrowing that lets both acceptance criteria of #78 hold at once. A
  // blanket case fold would make this indistinguishable from a lowercase first
  // letter, and dropping it would teach `london`.
  const kept = withoutTypography([err('capitalization', 'london')], 'I live in london', 'I live in London');
  assert.deepEqual(kept.map((e) => e.type), ['capitalization']);
});

test('each sentence of a composition gets its first letter folded, not just the first', () => {
  const kept = withoutTypography(
    [err('capitalization')],
    'i am a student. i like tea',
    'I am a student. I like tea.',
  );
  assert.deepEqual(kept, [], 'both sentence openings are typography');
});

test('two sentences run together is punctuation, because the full stop is not the last character', () => {
  // Only the terminal mark is stripped. A missing stop between two sentences is
  // a real difference, and a Student who ran them together should hear about it.
  const kept = withoutTypography(
    [err('punctuation')],
    'I am a student I like tea',
    'I am a student. I like tea.',
  );
  assert.deepEqual(kept.map((e) => e.type), ['punctuation']);
});
