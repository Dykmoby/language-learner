// The failure path, provoked rather than mocked: an application booted with a
// broken HOME cannot reach its credentials, so every Grader call fails.
//
// design.md § Failure behaviour measured this at roughly 1 call in 24 and calls
// it load-bearing. What is under test is that a Student meeting it is told to try
// again, is not marked wrong, and does not lose the attempt — never the text of
// the error, which ADR 0001 records as misleading.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, type BootedApp } from './helpers/app.ts';
import type { SeedAccount } from '../src/db/seed.ts';
import { kindShowcase } from './helpers/fixtures.ts';
import { lessonsOf, submissionsOf } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';
import type { Frame, ResultFrame } from '../src/practice/wire.ts';

const STUDENTS: SeedAccount[] = Array.from({ length: 4 }, (_, i) => ({
  username: `student${i + 1}`, password: 'staple monkey trombone', isAdmin: false,
}));

// One Grader-judged Exercise, first in its Practice, so it is reachable without
// completing anything.
const TRANSLATION = kindShowcase('translation');

let app: BootedApp;

before(async () => {
  app = await bootApp({
    accounts: STUDENTS,
    content: [TRANSLATION],
    env: { HOME: '/nonexistent-home-for-this-test' },
  });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

let nextAccount = 0;
async function signedIn(): Promise<{ client: Client; username: string }> {
  const account = STUDENTS[nextAccount++]!;
  const client = new Client(app.baseUrl);
  await client.signIn(account.username, account.password);
  return { client, username: account.username };
}

function theExercise() {
  const [only] = lessonsOf(app.databasePath, TRANSLATION.title);
  return { lesson: only!.lesson, exercise: only!.exercises[0]! };
}

test('a failed grading is answered as a failure, never as a wrong answer', { timeout: 180_000 }, async () => {
  const { client, username } = await signedIn();
  const { exercise } = theExercise();

  const response = await client.fetch(`/api/exercises/${exercise.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: 'I have cat.' }),
  });

  assert.equal(response.status, 200, 'a failed grading is a result, not an error status');

  const frames = (await response.text()).split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Frame);
  const result = frames.find((f): f is ResultFrame => f.t === 'result');

  assert.ok(result, 'the terminal frame still arrives');
  assert.equal(result.status, 'grading_failed');
  assert.equal(result.verdict, null, 'no Verdict is implied');
  assert.deepEqual(result.errors, [], 'and no Errors are invented');
  assert.equal(result.feedbackRu, null);

  // The row exists so the Student's words are not lost, and carries why.
  const rows = submissionsOf(app.databasePath, username, exercise.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.status, 'grading_failed');
  assert.equal(rows[0]!.answer, 'I have cat.', 'what they wrote is kept');
  assert.ok(rows[0]!.failureReason && rows[0]!.failureReason.length > 0, 'and a reason is recorded');
  assert.equal(rows[0]!.guardedVerdict, null);
  assert.equal(rows[0]!.proposedVerdict, null);
});

test('a failed grading does not count as an attempt and leaves the Exercise open', { timeout: 300_000 }, async () => {
  const { client } = await signedIn();
  const { lesson, exercise } = theExercise();

  const submit = () => client.fetch(`/api/exercises/${exercise.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: 'I have cat.' }),
  });

  for (let i = 0; i < 3; i += 1) {
    const frames = (await (await submit()).text()).split('\n').filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Frame);
    const result = frames.find((f): f is ResultFrame => f.t === 'result')!;

    assert.equal(result.status, 'grading_failed');
    assert.equal(result.progression.failedAttempts, 0, 'a broken call is not held against the Student');
    assert.equal(result.progression.revealOffered, false);
    assert.equal(result.progression.advanced, false);
    assert.equal(result.progression.nextExerciseId, exercise.id, 'the Exercise stays open');
  }

  // Three failed gradings would be three attempts if they counted. They do not,
  // so Reveal is still not on offer — a flaky call must not walk anyone toward it.
  const reveal = await client.fetch(`/api/exercises/${exercise.id}/reveal`, { method: 'POST' });
  assert.equal(reveal.status, 409);

  const html = await (await client.fetch(`/lessons/${lesson.id}/practice`)).text();
  assert.ok(html.includes(exercise.prompt), 'and the Student is still on it');
  assert.ok(!html.includes(ru.practice.reveal), 'with no Reveal offered');
});

test('closing the tab mid-grading still results in a persisted Submission', { timeout: 180_000 }, async () => {
  // The point of the whole arrangement: grading is started before the stream is
  // built and finishes on its own. Aborting the request is exactly what a closed
  // tab does.
  const { client, username } = await signedIn();
  const { exercise } = theExercise();

  const abort = new AbortController();
  const request = client.fetch(`/api/exercises/${exercise.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: 'I have cat.' }),
    signal: abort.signal,
  }).catch(() => null);

  // Long enough for the route to have started grading, far short of the call.
  await new Promise((resolve) => setTimeout(resolve, 300));
  abort.abort();
  await request;

  const deadline = Date.now() + 150_000;
  let rows = submissionsOf(app.databasePath, username, exercise.id);
  while (rows.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    rows = submissionsOf(app.databasePath, username, exercise.id);
  }

  assert.equal(rows.length, 1, 'the Submission landed with nobody listening');
  assert.equal(rows[0]!.answer, 'I have cat.');
});
