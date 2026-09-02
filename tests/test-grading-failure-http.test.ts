// Seam 1 — a Test whose batch cannot reach a model, provoked rather than mocked.
//
// An application booted with a broken HOME cannot read its credentials, so every
// call fails. design.md § Failure behaviour measured that at roughly 1 call in 24
// under normal conditions and calls the path load-bearing; for a Test it carries
// more weight still, because one failure is a whole attempt rather than one
// answer.
//
// What is under test: the free-form answers stay stored and unjudged, the attempt
// refuses to be scored as though they were wrong, the Student is told it was the
// checking that failed, and asking again re-judges the same answers rather than
// writing new ones.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { attemptsOf, courseIdFor, testsOf } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';
import type { AttemptView } from '../src/tests/wire.ts';

let app: BootedApp;
let testId: number;
let exerciseIds: number[] = [];

const EXERCISES = [
  {
    kind: 'fill_gap',
    prompt: 'Вставьте артикль: I have ___ cat.',
    referenceAnswer: 'a',
    acceptedAnswers: [['a']],
    choices: [],
    caseSensitive: false,
  },
  {
    kind: 'translation',
    prompt: 'Переведите: У меня есть кот.',
    referenceAnswer: 'I have a cat.',
    acceptedAnswers: [],
    choices: [],
    caseSensitive: false,
  },
];

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(who.username, who.password);
  return client;
}

before(async () => {
  app = await bootApp({
    content: [DETERMINISTIC_COURSE],
    env: { HOME: '/nonexistent-home-for-this-test' },
  });
  const courseId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);

  const admin = await signedIn(ADMIN);
  const created = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Работа со свободным ответом' }),
  });
  testId = ((await created.json()) as { testId: number }).testId;

  await admin.fetch(`/api/admin/tests/${testId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Работа со свободным ответом', passThreshold: 80, exercises: EXERCISES,
    }),
  });
  await admin.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });

  exerciseIds = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!.exercises.map((exercise) => exercise.id);
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

async function settled(client: Client, attemptId: number): Promise<AttemptView> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const response = await client.fetch(`/api/tests/${testId}/attempts/${attemptId}`);
    assert.equal(response.status, 200);
    const { view } = (await response.json()) as { view: AttemptView };
    if (view.state !== 'grading') return view;
    if (Date.now() > deadline) throw new Error('the batch never settled');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test('a failed batch leaves the answers unjudged and the attempt unscored', { timeout: 180_000 }, async () => {
  const client = await signedIn(STUDENT);

  const submitted = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: [
        { exerciseId: exerciseIds[0], answers: ['a'] },
        { exerciseId: exerciseIds[1], answers: ['I have a cat.'] },
      ],
    }),
  });
  assert.equal(submitted.status, 200, 'submitting succeeds — the grading is a separate act');
  const { attemptId, awaiting } = (await submitted.json()) as { attemptId: number; awaiting: number };
  assert.equal(awaiting, 1, 'one free-form answer went to the batch');

  const view = await settled(client, attemptId);

  assert.equal(view.state, 'grading_failed');
  assert.equal(view.scorePercent, null, 'an unfinished judgement is not a zero');
  assert.equal(view.passed, null, 'and it is neither a pass nor a failure');

  const deterministic = view.exercises.find((e) => e.exerciseId === exerciseIds[0])!;
  assert.equal(deterministic.status, 'graded', 'what is judged in code is judged whatever Claude does');
  assert.equal(deterministic.correct, true);

  const freeForm = view.exercises.find((e) => e.exerciseId === exerciseIds[1])!;
  assert.equal(freeForm.status, 'grading_failed');
  assert.equal(freeForm.verdict, null, 'no Verdict, so nothing can be read as one');
  assert.equal(freeForm.correct, false);
  assert.deepEqual(freeForm.errors, []);
  assert.equal(freeForm.answer, 'I have a cat.', 'and the Student’s words are still there');
});

test('the review says the checking failed, and never that the answer is wrong', { timeout: 180_000 }, async () => {
  const client = await signedIn(STUDENT);
  const submitted = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: [
        { exerciseId: exerciseIds[0], answers: ['a'] },
        { exerciseId: exerciseIds[1], answers: ['I have a cat.'] },
      ],
    }),
  });
  const { attemptId } = (await submitted.json()) as { attemptId: number };
  await settled(client, attemptId);

  const page = await client.fetch(`/tests/${testId}/attempts/${attemptId}`);
  assert.equal(page.status, 200);
  const html = await page.text();

  assert.ok(html.includes(ru.test.gradingFailed), 'it says the checking failed');
  assert.ok(html.includes(ru.test.regrade), 'and offers to try again');
  assert.ok(!html.includes(ru.states.incorrect), 'and calls nothing wrong');
  assert.ok(!html.includes(ru.test.passed) && !html.includes(ru.test.failed), 'and reports no result');

  // design.md § Failure behaviour asks for more than different words. Until the
  // state system existed this path was drawn in the same red as a wrong answer
  // and told apart by one sentence of Russian — which is not a distinction a
  // Student reads at a glance, and not one that survives a screen rendering
  // colour badly.
  assert.ok(html.includes('state-failed'), 'and is drawn as a failure');
  assert.ok(!html.includes('state-incorrect'), 'never as a wrong answer');
});

test('asking again judges the same answers rather than writing new ones', { timeout: 180_000 }, async () => {
  const client = await signedIn(STUDENT);
  const submitted = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: [
        { exerciseId: exerciseIds[0], answers: ['a'] },
        { exerciseId: exerciseIds[1], answers: ['I have a cat.'] },
      ],
    }),
  });
  const { attemptId } = (await submitted.json()) as { attemptId: number };
  await settled(client, attemptId);

  const before = attemptsOf(app.databasePath, STUDENT.username, testId)
    .find((entry) => entry.attempt.id === attemptId)!;

  const again = await client.fetch(`/api/tests/${testId}/attempts/${attemptId}/grade`, { method: 'POST' });
  assert.equal(again.status, 200);
  const { view } = (await again.json()) as { view: AttemptView };
  assert.equal(view.state, 'grading', 'the failure is cleared and the answers are out again');

  const settledAgain = await settled(client, attemptId);
  assert.equal(settledAgain.state, 'grading_failed', 'credentials are still broken, so it fails again');

  const after = attemptsOf(app.databasePath, STUDENT.username, testId)
    .find((entry) => entry.attempt.id === attemptId)!;
  assert.equal(
    after.submissions.length, before.submissions.length,
    'judging an answer again is not another attempt at it',
  );
  assert.deepEqual(
    after.submissions.map((row) => row.answer),
    before.submissions.map((row) => row.answer),
    'and the Student re-entered nothing',
  );

  const attempts = attemptsOf(app.databasePath, STUDENT.username, testId);
  assert.equal(
    attempts.filter((entry) => entry.attempt.id === attemptId).length, 1,
    'and no second attempt was created either',
  );
});

test('another Student cannot ask for someone else’s attempt to be judged', { timeout: 180_000 }, async () => {
  const client = await signedIn(STUDENT);
  const submitted = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [{ exerciseId: exerciseIds[1], answers: ['I have a cat.'] }] }),
  });
  const { attemptId } = (await submitted.json()) as { attemptId: number };

  const admin = await signedIn(ADMIN);
  const response = await admin.fetch(`/api/tests/${testId}/attempts/${attemptId}/grade`, { method: 'POST' });
  assert.equal(response.status, 404);
});
