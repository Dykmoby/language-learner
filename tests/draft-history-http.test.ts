// Seam 1 — the Draft history and Theory images over HTTP.
//
// Both surfaces are Admin-only and both are refused with a 404 rather than a
// 403, which is the rule the whole section holds to: a Student who is not an
// Admin should not learn that an authoring surface exists at all. That is what
// the first tests here check, on every page and endpoint the two tickets add.
//
// The serving route is the one deliberate exception, and it is stated as a
// decision rather than left as an accident: a Theory image is part of a Lesson a
// Student reads, so any signed-in Student may fetch one. It is still behind the
// session choke point — as reachable as the Lessons that embed it, and no more.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { lessonsOf } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

let app: BootedApp;

test.before(async () => {
  app = await bootApp({ content: [DETERMINISTIC_COURSE] });
});

test.after(async () => {
  await app.stop();
});

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(who.username, who.password)).status, 303);
  return client;
}

function lessonId(): number {
  return lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[0]!.lesson.id;
}

function postJson(client: Client, path: string, body: unknown): Promise<Response> {
  return client.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function saveTheory(client: Client, theoryMarkdown: string): Promise<number> {
  const response = await postJson(client, `/api/admin/lessons/${lessonId()}/draft`, {
    title: 'Первый урок',
    grammarFocus: 'Indefinite article a/an with singular countable nouns.',
    theoryMarkdown,
    exercises: [],
  });
  assert.equal(response.status, 200);
  return ((await response.json()) as { draftId: number }).draftId;
}

function uploadPng(client: Client, bytes: Buffer = PNG, filename = 'схема.png'): Promise<Response> {
  const body = new FormData();
  body.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), filename);
  return client.fetch('/api/admin/uploads', { method: 'POST', body });
}

// --- The guard ---------------------------------------------------------------

test('the history and the upload are closed to a Student who is not an Admin', async () => {
  const client = await signedIn(STUDENT);
  const id = lessonId();

  assert.equal((await client.fetch(`/admin/lessons/${id}/history`)).status, 404, 'the history page');
  assert.equal(
    (await postJson(client, `/api/admin/lessons/${id}/drafts/1/restore`, {})).status,
    404,
    'the restore endpoint',
  );
  assert.equal((await uploadPng(client)).status, 404, 'the upload endpoint');
});

test('the history and the upload are closed to a visitor with no session', async () => {
  const client = new Client(app.baseUrl);
  const id = lessonId();

  for (const path of [`/admin/lessons/${id}/history`, `/api/admin/lessons/${id}/drafts/1/restore`]) {
    assert.equal((await client.fetch(path)).status, 307, `${path} is turned away by the choke point`);
  }
  assert.equal((await uploadPng(client)).status, 307, 'and so is the upload');
});

// --- The history -------------------------------------------------------------

test('an Admin sees every Draft, newest first, with its origin, and restoring appends', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);
  const id = lessonId();

  const first = await saveTheory(admin, '# Первая правка\n\nСамая ранняя версия.');
  await saveTheory(admin, '# Вторая правка\n\nСледующая версия.');

  const page = await admin.fetch(`/admin/lessons/${id}/history`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, new RegExp(ru.draftOrigins.manual!), 'each Draft says what made it');
  assert.match(html, new RegExp(ru.draft.historyEntry(2)), 'and both are listed');
  assert.match(html, /Вторая правка/, 'the newest is shown by default');

  // Selecting an earlier Draft shows what it held.
  const earlier = await admin.fetch(`/admin/lessons/${id}/history?draft=${first}`);
  assert.match(await earlier.text(), /Самая ранняя версия/);

  const beforeRestore = (await (await admin.fetch(`/admin/lessons/${id}/history`)).text())
    .split(ru.draft.historyEntry(1)).length;
  assert.ok(beforeRestore > 1, 'the numbering is in the page');

  const restored = await postJson(admin, `/api/admin/lessons/${id}/drafts/${first}/restore`, {});
  assert.equal(restored.status, 200);

  const after = await (await admin.fetch(`/admin/lessons/${id}/history`)).text();
  assert.match(after, new RegExp(ru.draft.historyEntry(3)), 'a third Draft, rather than two');
  assert.match(after, new RegExp(ru.draftOrigins.restore!), 'and it says it came from a restore');
  assert.match(after, /Самая ранняя версия/, 'holding what the restored Draft held');

  // Restoring does not publish: what a Student reads is still the seeded Lesson.
  const read = await student.fetch(`/lessons/${id}`);
  assert.equal(read.status, 200);
  const theory = await read.text();
  assert.doesNotMatch(theory, /Самая ранняя версия/, 'the Student sees the published Lesson');
  assert.match(theory, /Артикль/, 'which is the one the fixture seeded');
});

test('restoring a Draft of another Lesson is a 404, whatever id arrives', async () => {
  const admin = await signedIn(ADMIN);
  const lessons = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title);
  const elsewhere = await saveTheory(admin, '# Правка первого урока');

  const refused = await postJson(
    admin, `/api/admin/lessons/${lessons[1]!.lesson.id}/drafts/${elsewhere}/restore`, {},
  );
  assert.equal(refused.status, 404);
  assert.equal(
    (await postJson(admin, `/api/admin/lessons/${lessons[0]!.lesson.id}/drafts/9999/restore`, {})).status,
    404,
  );
});

test('a Lesson that has never been saved renders its history without a special case', async () => {
  const admin = await signedIn(ADMIN);
  const second = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!.lesson.id;

  const page = await admin.fetch(`/admin/lessons/${second}/history`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), new RegExp(ru.draft.historyEmpty));
});

// --- Images ------------------------------------------------------------------

test('an Admin uploads an image, and it comes back through the application route', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);

  const uploaded = await uploadPng(admin);
  assert.equal(uploaded.status, 200);
  const { url } = (await uploaded.json()) as { url: string };

  // The name is the application's, not the file's: nothing supplied reaches a path.
  assert.match(url, /^\/api\/uploads\/[0-9a-f]{32}\.png$/);
  assert.doesNotMatch(url, /схема/, 'the uploaded filename is nowhere in it');

  const served = await admin.fetch(url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png', 'the stored type, set explicitly');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), new Uint8Array(PNG));

  // The decided read rule: a Theory image is part of a Lesson a Student reads.
  assert.equal((await student.fetch(url)).status, 200, 'any signed-in Student may read it');
  assert.equal(
    (await new Client(app.baseUrl).fetch(url)).status,
    307,
    'but the session choke point still applies',
  );

  // Outside the build output, which is what makes it survive a rebuild.
  const stored = readdirSync(app.uploadDir);
  assert.equal(stored.length >= 1, true, 'the file is in the upload folder');
  assert.doesNotMatch(app.uploadDir, /\.next/, 'and the folder is not inside .next');
  assert.ok(statSync(join(app.uploadDir, url.split('/').pop()!)).size > 0);
});

test('a file that is not an allowed image is refused by its bytes, not by its name', async () => {
  const admin = await signedIn(ADMIN);

  // Declared as a PNG, named as a PNG, and an SVG: an SVG is a document that can
  // carry script, and serving one from this origin would undo the Theory
  // renderer's escaping.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const refused = await uploadPng(admin, svg, 'picture.png');

  assert.equal(refused.status, 415);
  assert.deepEqual(await refused.json(), { ok: false, reason: 'wrong_type' });
});

test('a file over the cap is refused before it is written', async () => {
  const admin = await signedIn(ADMIN);
  const before = readdirSync(app.uploadDir).length;

  // A real PNG header followed by more bytes than the cap allows: refused for
  // its size rather than for its type, which is why the header is genuine.
  const huge = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
  const refused = await uploadPng(admin, huge, 'большой.png');

  assert.equal(refused.status, 413);
  assert.deepEqual(await refused.json(), { ok: false, reason: 'too_large' });
  assert.equal(readdirSync(app.uploadDir).length, before, 'nothing reached the folder');
});

test('a file just under the cap is accepted, not eaten by the multipart envelope', async () => {
  const admin = await signedIn(ADMIN);

  // `content-length` measures the whole multipart body, not the file: boundary
  // lines, part headers and the filename are all in it. A cap compared against
  // that number directly refuses a legal file for bytes the browser added, and
  // the effective cap silently drops a few hundred bytes below the configured
  // one.
  const justUnder = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 - PNG.length - 64)]);
  assert.equal(justUnder.length, 2 * 1024 * 1024 - 64, 'a hair under the 2 MB default');

  const accepted = await uploadPng(admin, justUnder, 'почти-предельный.png');
  assert.equal(accepted.status, 200);
  const { url } = (await accepted.json()) as { url: string };
  assert.equal((await admin.fetch(url)).status, 200, 'and it serves back');
});

test('a name the application did not generate is a 404, not a path', async () => {
  const admin = await signedIn(ADMIN);

  for (const name of ['..%2F..%2Fetc%2Fpasswd', 'not-a-stored-name.png', 'a'.repeat(32) + '.svg']) {
    const response = await admin.fetch(`/api/uploads/${name}`);
    assert.equal(response.status, 404, name);
  }
});

test('an uploaded image survives a restart, and renders in a published Theory', async () => {
  const admin = await signedIn(ADMIN);
  const id = lessonId();

  const { url } = (await (await uploadPng(admin)).json()) as { url: string };

  const draftId = await saveTheory(admin, `# Урок с картинкой\n\n![схема](${url})`);
  const published = await postJson(admin, `/api/admin/lessons/${id}/publish`, { draftId });
  assert.equal(published.status, 200);

  // The folder lives outside the build output on purpose; restarting the
  // process against the same folder is the closest a test gets to a redeploy.
  await app.restart();

  const student = await signedIn(STUDENT);
  const html = await (await student.fetch(`/lessons/${id}`)).text();
  assert.match(html, new RegExp(`<img src="${url}"`), 'the image is in the Student\'s Theory');
  assert.equal((await student.fetch(url)).status, 200, 'and still serves after the restart');
});
