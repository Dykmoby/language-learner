// Seam 1 — authoring over HTTP: creating a Course, a Lesson and an Enrollment
// against a booted application.
//
// Two claims are worth the cost of a real server here. The first is the guard:
// every endpoint that writes content is closed to a Student who is not an Admin,
// and a section is only as gated as its least gated endpoint. The second is the
// round trip the ticket is actually about — a Course created through these
// screens ends up on an enrolled Student's home page, which no unit test can
// claim on its behalf.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ru } from '../src/ru.ts';
import { DEFAULT_GRADER_MODEL } from '../src/content/course-options.ts';
import { studentIdFor } from './helpers/inspect.ts';

// Every endpoint that writes content. One added to the section without being
// added here is an endpoint whose guard nobody checked.
const WRITE_ENDPOINTS = [
  '/api/admin/courses',
  '/api/admin/courses/1/lessons',
  '/api/admin/courses/1/lessons/order',
  '/api/admin/courses/1/enrollments',
];

let app: BootedApp;

test.before(async () => {
  // No content at all: this suite is about a system where the only way a Course
  // comes into being is an Admin creating one.
  app = await bootApp();
});

test.after(async () => {
  await app.stop();
});

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(who.username, who.password)).status, 303);
  return client;
}

function postJson(client: Client, path: string, body: unknown): Promise<Response> {
  return client.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

test('every write in the section is closed to a Student who is not an Admin', async () => {
  const client = await signedIn(STUDENT);
  for (const path of WRITE_ENDPOINTS) {
    assert.equal((await postJson(client, path, {})).status, 404, path);
  }
});

test('every write in the section is closed to a visitor with no session', async () => {
  const client = new Client(app.baseUrl);
  for (const path of WRITE_ENDPOINTS) {
    assert.equal((await postJson(client, path, {})).status, 307, `${path} is turned away by the choke point`);
  }
});

test('Haiku is refused as a Grader model, with the rule in Russian', async () => {
  const admin = await signedIn(ADMIN);
  const response = await postJson(admin, '/api/admin/courses', {
    language: 'tj', level: 'A1', graderModel: 'claude-haiku-4-5', title: 'Таджикский',
  });

  assert.equal(response.status, 422);
  const body = await json(response);
  assert.deepEqual(body.faults, ['grader_model_forbidden']);

  // ADR 0002's finding reaches the person choosing, rather than a bare refusal.
  assert.match(ru.authoringFaults.grader_model_forbidden, /Haiku/);
});

test('a Course created without naming a model takes its Language\'s, per ADR 0002', async () => {
  const admin = await signedIn(ADMIN);

  const created = await postJson(admin, '/api/admin/courses', {
    language: 'tj', level: 'A1', title: 'Таджикский по умолчанию',
  });
  assert.equal(created.status, 200, 'the model is optional, not required');

  const page = await admin.fetch(`/admin/courses/${(await json(created)).courseId as number}`);
  assert.match(await page.text(), /claude-opus-5/, 'Tajik takes the better model');
});

test('an Admin creates a Course, a Lesson and an Enrollment, and the Student gets the Course', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);

  const before = await student.fetch('/');
  assert.match(await before.text(), new RegExp(ru.courses.none), 'the Student has no Courses yet');

  const created = await postJson(admin, '/api/admin/courses', {
    language: 'en', level: 'A2', graderModel: DEFAULT_GRADER_MODEL.en, title: 'Английский, второй заход',
  });
  assert.equal(created.status, 200);
  const courseId = (await json(created)).courseId as number;

  // A Course with no Lessons renders for its Admin rather than breaking.
  const empty = await admin.fetch(`/admin/courses/${courseId}`);
  assert.equal(empty.status, 200);
  assert.match(await empty.text(), new RegExp(ru.admin.noLessons));

  const lesson = await postJson(admin, `/api/admin/courses/${courseId}/lessons`, { title: 'Первый урок' });
  assert.equal(lesson.status, 200);
  const lessonId = (await json(lesson)).lessonId as number;

  // Still nothing on the Student's side: they are not enrolled, and the Lesson
  // has never been published.
  assert.match(await (await student.fetch('/')).text(), new RegExp(ru.courses.none));

  const studentId = studentIdFor(app.databasePath, STUDENT.username);
  const enrolled = await postJson(admin, `/api/admin/courses/${courseId}/enrollments`, { studentId });
  assert.deepEqual(await json(enrolled), { ok: true, created: true });

  const home = await student.fetch('/');
  const landing = home.status === 307
    ? await student.fetch(new URL(home.headers.get('location')!, app.baseUrl).pathname)
    : home;
  assert.match(await landing.text(), /Английский, второй заход/, 'the Course reached the Student');

  // The Lesson did not, because nobody published it. An empty Lesson a Student
  // can open and cannot do is the thing this is built to prevent.
  const course = await student.fetch(`/courses/${courseId}`);
  assert.equal(course.status, 200, 'a Course with no published Lessons renders');
  const html = await course.text();
  assert.doesNotMatch(html, /Первый урок/, 'the unpublished Lesson is not listed');
  assert.equal((await student.fetch(`/lessons/${lessonId}`)).status, 404, 'nor reachable by address');
});

test('enrolling the same Student twice is reported, never duplicated', async () => {
  const admin = await signedIn(ADMIN);

  const created = await postJson(admin, '/api/admin/courses', {
    language: 'en', level: 'B1', graderModel: DEFAULT_GRADER_MODEL.en, title: 'Курс для повторной записи',
  });
  const courseId = (await json(created)).courseId as number;

  const studentId = studentIdFor(app.databasePath, STUDENT.username);
  const first = await postJson(admin, `/api/admin/courses/${courseId}/enrollments`, { studentId });
  assert.deepEqual(await json(first), { ok: true, created: true });

  const again = await postJson(admin, `/api/admin/courses/${courseId}/enrollments`, { studentId });
  assert.equal(again.status, 200, 'not an error');
  assert.deepEqual(await json(again), { ok: true, created: false });
});

test('an Admin reorders the Lessons of a Course, and a stale order is refused', async () => {
  const admin = await signedIn(ADMIN);

  const created = await postJson(admin, '/api/admin/courses', {
    language: 'en', level: 'B2', graderModel: DEFAULT_GRADER_MODEL.en, title: 'Курс с порядком',
  });
  const courseId = (await json(created)).courseId as number;

  const ids: number[] = [];
  for (const title of ['Раз', 'Два', 'Три']) {
    const response = await postJson(admin, `/api/admin/courses/${courseId}/lessons`, { title });
    ids.push((await json(response)).lessonId as number);
  }

  const swapped = await postJson(admin, `/api/admin/courses/${courseId}/lessons/order`, {
    lessonIds: [ids[1], ids[0], ids[2]],
  });
  assert.equal(swapped.status, 200);

  const page = await admin.fetch(`/admin/courses/${courseId}`);
  const html = await page.text();
  assert.ok(html.indexOf('Два') < html.indexOf('Раз'), 'the Course lists them in the new order');
  assert.match(html, new RegExp(ru.admin.draft), 'and says that none of them is published');

  // A tab that still holds yesterday's order must not half-apply it.
  const stale = await postJson(admin, `/api/admin/courses/${courseId}/lessons/order`, {
    lessonIds: [ids[0], ids[1]],
  });
  assert.equal(stale.status, 409);
  assert.deepEqual((await json(stale)).faults, ['order_mismatch']);
});

test('a Course whose id names nothing is a 404 on every write, even for an Admin', async () => {
  const admin = await signedIn(ADMIN);
  for (const path of ['/api/admin/courses/9999/lessons', '/api/admin/courses/not-a-number/lessons']) {
    assert.equal((await postJson(admin, path, { title: 'Урок' })).status, 404, path);
  }
});
