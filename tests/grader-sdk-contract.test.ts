// The Grader module's terminal contract, exercised against a real (failing) SDK
// call. HOME is broken on purpose so the call cannot succeed — what is under test
// is the shape of the failure, not the model.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { grade } from '../src/grader/grade.ts';
import type { ExerciseContext } from '../src/grader/contract.ts';

const CONTEXT: ExerciseContext = {
  language: 'en', level: 'A1', lessonTitle: 'Урок', grammarFocus: 'Articles',
  prompt: 'Переведите: У меня есть кошка.', referenceAnswer: 'I have a cat.',
  acceptedVariants: [], priorSubmissions: [],
};

const realHome = process.env.HOME;
before(() => { process.env.HOME = '/nonexistent-home-for-this-test'; });
after(() => { process.env.HOME = realHome; });

test('the terminal result is a failure value, never a rejected promise', { timeout: 180_000 }, async () => {
  // A caller must not be able to render a failure as a wrong answer, and an
  // exception is exactly how that happens.
  const outcome = await grade({ model: 'claude-sonnet-5', context: CONTEXT, submission: 'I have cat.' }).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.ok(['timeout', 'contract', 'sdk'].includes(outcome.failure.kind));
  assert.ok(outcome.failure.reason.length > 0);
  assert.equal(typeof outcome.wallMs, 'number');
});

test('grading runs to completion even though nobody subscribes to the stream', { timeout: 180_000 }, async () => {
  // design.md § Failure behaviour: grading runs to completion server-side whether
  // or not the client is still listening. A stream nobody pulls must not stall it.
  const handle = grade({ model: 'claude-sonnet-5', context: CONTEXT, submission: 'I have cat.' });
  const outcome = await handle.result;
  assert.equal(outcome.ok, false, 'it finished without anyone reading the deltas');
});

test('the stream is exposed alongside the terminal result and terminates', { timeout: 180_000 }, async () => {
  // Nothing subscribes in step 2. The stream exists because streaming is
  // mandatory for step 3, and retrofitting it into a promise-shaped API later is
  // a rewrite.
  const handle = grade({ model: 'claude-sonnet-5', context: CONTEXT, submission: 'I have cat.' });

  const deltas: string[] = [];
  for await (const delta of handle.deltas) deltas.push(delta);

  await handle.result;
  assert.ok(Array.isArray(deltas), 'the stream is iterable and ends rather than hanging');
});
