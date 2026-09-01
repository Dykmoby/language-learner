// Seam 1 — authoring a Test, driven over HTTP.
//
// The claims are the ones a browser can observe: what an Admin can create, what
// the validity rules refuse, and — the one that matters most — that a Test is
// invisible to a Student until somebody publishes it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { courseIdFor, testsOf } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';

let app: BootedApp;
let courseId: number;

before(async () => {
  app = await bootApp({ content: [DETERMINISTIC_COURSE] });
  courseId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

async function admin(): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);
  return client;
}

async function student(): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(STUDENT.username, STUDENT.password);
  return client;
}

async function createTest(client: Client, title: string): Promise<number> {
  const response = await client.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  assert.equal(response.status, 200, 'the Test was created');
  const body = await response.json() as { ok: boolean; testId: number };
  assert.equal(body.ok, true);
  return body.testId;
}

function save(client: Client, testId: number, document: unknown): Promise<Response> {
  return client.fetch(`/api/admin/tests/${testId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  });
}

const FILL_GAP = {
  kind: 'fill_gap',
  prompt: 'Вставьте артикль: I have ___ cat.',
  referenceAnswer: 'a',
  acceptedAnswers: [['a']],
  choices: [],
  caseSensitive: false,
};

const TRANSLATION = {
  kind: 'translation',
  prompt: 'Переведите: У меня есть кот.',
  referenceAnswer: 'I have a cat.',
  acceptedAnswers: [],
  choices: [],
  caseSensitive: false,
};

test('an Admin creates a Test on a Course, and it starts unpublished with the default threshold', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: создание');

  const created = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId);

  assert.equal(created?.test.title, 'Работа: создание');
  assert.equal(created?.test.passThreshold, 80, 'design.md § Tests: 80% by default');
  assert.equal(created?.test.publishedAt, null, 'and nothing a Student can open');

  const page = await client.fetch(`/admin/tests/${testId}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(ru.testAdmin.unpublished));
});

test('Exercises of both judgement classes are saved, and come back carrying their ids', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: упражнения');

  const response = await save(client, testId, {
    title: 'Работа: упражнения',
    passThreshold: 60,
    exercises: [FILL_GAP, TRANSLATION],
  });
  assert.equal(response.status, 200);

  const body = await response.json() as { ok: boolean; document: { exercises: Array<{ id?: number }> } };
  const ids = body.document.exercises.map((exercise) => exercise.id);
  assert.equal(ids.every((id) => typeof id === 'number'), true, 'a saved Exercise is a row with an id');

  const written = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!;
  assert.equal(written.test.passThreshold, 60);
  assert.deepEqual(written.exercises.map((e) => e.kind), ['fill_gap', 'translation']);
  assert.deepEqual(written.exercises.map((e) => e.position), [1, 2], 'in the order they were sent');

  // Saving again with those ids must update the rows rather than replace them:
  // an Exercise deleted and re-inserted takes every answer given to it with it.
  const again = await save(client, testId, {
    title: 'Работа: упражнения',
    passThreshold: 60,
    exercises: [
      { ...TRANSLATION, id: ids[1] },
      { ...FILL_GAP, id: ids[0], prompt: 'Вставьте артикль: I have ___ dog.' },
    ],
  });
  assert.equal(again.status, 200);

  const reordered = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!;
  assert.deepEqual(reordered.exercises.map((e) => e.id), [ids[1], ids[0]], 'the same rows, reordered');
  assert.match(reordered.exercises[1]!.prompt, /dog/, 'and edited in place');
});

test('an incoherent Exercise is refused with the code that says which rule it broke', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: правила');

  const response = await save(client, testId, {
    title: 'Работа: правила',
    passThreshold: 80,
    exercises: [{
      kind: 'multiple_choice',
      prompt: 'Выберите вариант: I have ___ apple.',
      referenceAnswer: 'the',
      acceptedAnswers: [['an']],
      choices: ['a', 'an'],
      caseSensitive: false,
    }],
  });

  assert.equal(response.status, 422, 'understood, and refused');
  const body = await response.json() as { faults: Array<{ code: string; exercisePosition?: number }> };
  assert.deepEqual(body.faults.map((f) => f.code), ['reference_answer_not_a_choice']);
  assert.equal(body.faults[0]!.exercisePosition, 1);

  const written = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!;
  assert.deepEqual(written.exercises, [], 'and nothing was written');
});

test('a body that is not a Test at all is malformed rather than refused', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: мусор');

  const response = await save(client, testId, { title: 'x', passThreshold: 'восемьдесят' });
  assert.equal(response.status, 400);
});

test('an empty Test cannot be published', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: пустая');

  const response = await client.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });
  assert.equal(response.status, 422);
  const body = await response.json() as { faults: Array<{ code: string }> };
  assert.deepEqual(body.faults.map((f) => f.code), ['test_empty']);
});

test('publishing makes it live once, and saying so twice is refused', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: публикация');
  await save(client, testId, { title: 'Работа: публикация', passThreshold: 80, exercises: [FILL_GAP] });

  const first = await client.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });
  assert.equal(first.status, 200);

  const published = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!;
  assert.notEqual(published.test.publishedAt, null);

  const second = await client.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });
  assert.equal(second.status, 409, 'already live — the browser is a step behind, nothing is wrong');

  const unchanged = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!;
  assert.deepEqual(
    unchanged.test.publishedAt, published.test.publishedAt,
    'and the moment it went live is not moved by pressing the button again',
  );
});

test('a Student who is not an Admin cannot reach any of it', async () => {
  const client = await admin();
  const testId = await createTest(client, 'Работа: доступ');

  const theStudent = await student();
  const attempts: Array<[string, RequestInit]> = [
    [`/admin/tests/${testId}`, {}],
    [`/api/admin/courses/${courseId}/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Не моя работа' }),
    }],
    [`/api/admin/tests/${testId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x', passThreshold: 80, exercises: [] }),
    }],
    [`/api/admin/tests/${testId}/publish`, { method: 'POST' }],
  ];

  for (const [path, init] of attempts) {
    const response = await theStudent.fetch(path, init);
    assert.equal(response.status, 404, `${path} does not exist for a non-Admin`);
  }
});
