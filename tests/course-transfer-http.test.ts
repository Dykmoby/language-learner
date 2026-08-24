// Export and import at the HTTP seam.
//
// The rule under test is the one a middleware cannot be trusted with alone: both
// endpoints are Admin-only in their own right. An export is every Reference
// Answer in a Course in one file — the answer key — and an import writes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { withDatabase } from './helpers/inspect.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { courses } from '../src/db/schema.ts';
import { COURSE_EXPORT_VERSION, type CourseExport } from '../src/admin/course-export.ts';
import { ru, faultMessage } from '../src/ru.ts';

let app: BootedApp;

before(async () => {
  app = await bootApp({ content: [DETERMINISTIC_COURSE] });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

function courseId(): number {
  return withDatabase(app.databasePath, (db) => db.select().from(courses).all()[0]!.id);
}

function courseCount(): number {
  return withDatabase(app.databasePath, (db) => db.select().from(courses).all().length);
}

async function adminClient(): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);
  return client;
}

async function exported(): Promise<CourseExport> {
  const response = await (await adminClient()).fetch(`/api/admin/courses/${courseId()}/export`);
  assert.equal(response.status, 200);
  return await response.json() as CourseExport;
}

function upload(file: unknown): FormData {
  const body = new FormData();
  body.append('file', new File([JSON.stringify(file)], 'course.json', { type: 'application/json' }));
  return body;
}

test('the Admin downloads a Course as one file, offered as a download', async () => {
  const response = await (await adminClient()).fetch(`/api/admin/courses/${courseId()}/export`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/);

  const file = await response.json() as CourseExport;
  assert.equal(file.version, COURSE_EXPORT_VERSION);
  assert.equal(file.course.title, DETERMINISTIC_COURSE.title);
  assert.equal(file.lessons.length, DETERMINISTIC_COURSE.lessons.length);
});

test('the Course screen offers the download', async () => {
  const html = await (await (await adminClient()).fetch(`/admin/courses/${courseId()}`)).text();
  assert.ok(html.includes(`/api/admin/courses/${courseId()}/export`));
  assert.ok(html.includes(ru.transfer.exportCourse));
});

test('a file uploaded on the Admin screens becomes a new Course', async () => {
  const file = await exported();
  const before = courseCount();

  const response = await (await adminClient())
    .fetch('/api/admin/courses/import', { method: 'POST', body: upload(file) });

  assert.equal(response.status, 200);
  const result = await response.json() as { ok: boolean; courseId: number; lessons: number };
  assert.equal(result.ok, true);
  assert.equal(result.lessons, DETERMINISTIC_COURSE.lessons.length);
  assert.equal(courseCount(), before + 1);

  const admin = await adminClient();
  const dashboard = await (await admin.fetch('/admin')).text();
  assert.ok(dashboard.includes(`/admin/courses/${result.courseId}`), 'and is listed with the rest');
  assert.ok(dashboard.includes(ru.transfer.importTitle), 'the form that loaded it is on that page');
});

test('a file that cannot become a Course is refused in Russian, with nothing written', async () => {
  const file = await exported();
  const broken = {
    ...file,
    lessons: file.lessons.map((lesson, index) => index !== 0 ? lesson : {
      ...lesson,
      document: { ...lesson.document, theoryMarkdown: '' },
    }),
  };
  const before = courseCount();

  const response = await (await adminClient())
    .fetch('/api/admin/courses/import', { method: 'POST', body: upload(broken) });

  assert.equal(response.status, 422);
  const result = await response.json() as { ok: boolean; faults: Array<{ code: string; lessonPosition?: number }> };
  assert.equal(result.ok, false);
  assert.deepEqual(result.faults.map((fault) => fault.code), ['theory_empty']);
  assert.equal(result.faults[0]!.lessonPosition, 1, 'and says which Lesson of the file');
  // The code the endpoint returns is one the screens already have Russian for.
  assert.equal(faultMessage('theory_empty'), ru.documentFaults.theory_empty);
  assert.equal(courseCount(), before, 'nothing was written');
});

test('a file from a later build is refused rather than guessed at', async () => {
  const file = await exported();
  const response = await (await adminClient()).fetch('/api/admin/courses/import', {
    method: 'POST',
    body: upload({ ...file, version: file.version + 1 }),
  });

  assert.equal(response.status, 422);
  const result = await response.json() as { faults: Array<{ code: string }> };
  assert.deepEqual(result.faults.map((fault) => fault.code), ['version_unknown']);
  assert.notEqual(faultMessage('version_unknown'), 'version_unknown', 'and it has Russian to say so');
});

test('neither endpoint exists for a Student who is not an Admin', async () => {
  const student = new Client(app.baseUrl);
  await student.signIn(STUDENT.username, STUDENT.password);
  const before = courseCount();

  assert.equal((await student.fetch(`/api/admin/courses/${courseId()}/export`)).status, 404);
  assert.equal(
    (await student.fetch('/api/admin/courses/import', { method: 'POST', body: upload(await exported()) })).status,
    404,
  );
  assert.equal(courseCount(), before);
});

test('a signed-out request reaches neither', async () => {
  const nobody = new Client(app.baseUrl);
  assert.equal((await nobody.fetch(`/api/admin/courses/${courseId()}/export`)).status, 307);
  assert.equal((await nobody.fetch('/api/admin/courses/import', { method: 'POST' })).status, 307);
});
