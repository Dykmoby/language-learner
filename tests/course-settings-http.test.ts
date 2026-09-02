// Issue #75 — the Course settings screen at the HTTP seam.
//
// The rules are covered next door in course-settings.test.ts. What is asserted
// here is what a browser can observe: that an Admin reaches the screen from the
// Course and can change what it offers, that a Student reaches neither the screen
// nor the endpoint, and that the two facts the screen only reports are reported
// rather than offered.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { withDatabase } from './helpers/inspect.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { courses } from '../src/db/schema.ts';
import { ru, faultMessage } from '../src/ru.ts';

let app: BootedApp;

before(async () => {
  app = await bootApp({ content: [DETERMINISTIC_COURSE] });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

function course() {
  return withDatabase(app.databasePath, (db) => db.select().from(courses).all()[0]!);
}

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(who.username, who.password)).status, 303, 'signed in');
  return client;
}

function patch(client: Client, body: unknown): Promise<Response> {
  return client.fetch(`/api/admin/courses/${course().id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('the settings screen is reached from the Course, and shows what it will not change', async () => {
  const admin = await signedIn(ADMIN);
  const { id, level } = course();

  const coursePage = await (await admin.fetch(`/admin/courses/${id}`)).text();
  assert.ok(coursePage.includes(`/admin/courses/${id}/settings`), 'the Course links to its settings');

  const response = await admin.fetch(`/admin/courses/${id}/settings`);
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.ok(html.includes(ru.admin.settingsTitle), 'the screen names itself');
  assert.ok(html.includes(ru.admin.levelFixed(level)), 'the level is stated as a fact');
  assert.ok(html.includes(ru.admin.fixedFactsHint), 'and the screen says why neither moves');
});

test('a Student reaches neither the screen nor the endpoint', async () => {
  const student = await signedIn(STUDENT);
  const { id } = course();

  assert.equal((await student.fetch(`/admin/courses/${id}/settings`)).status, 404,
    'the screen does not exist for them');
  assert.equal((await patch(student, { title: 'мой курс' })).status, 404,
    'and neither does the endpoint');

  const stranger = new Client(app.baseUrl);
  assert.ok([307, 401].includes((await patch(stranger, { title: 'мой курс' })).status),
    'and not for a signed-out visitor either');
});

test('an Admin renames a Course, and the Course reads by its new name', async () => {
  const admin = await signedIn(ADMIN);
  assert.equal((await patch(admin, { title: 'Английский с нуля' })).status, 200);

  const html = await (await admin.fetch(`/admin/courses/${course().id}`)).text();
  assert.ok(html.includes('Английский с нуля'), 'the Course shows the new title');
});

test('an Admin changes the Grader model, and the Course is judged by it from then on', async () => {
  const admin = await signedIn(ADMIN);
  assert.equal(course().graderModel, 'claude-sonnet-5', 'ADR 0002 defaulted it from the Language');

  const response = await patch(admin, { title: course().title, graderModel: 'claude-opus-5' });
  assert.equal(response.status, 200);

  // The row is what the next Submission in this Course reads its model from,
  // with no restart and no second copy anywhere to disagree with it.
  assert.equal(course().graderModel, 'claude-opus-5');
});

test('Haiku is neither offered nor accepted, and the refusal is in Russian', async () => {
  const admin = await signedIn(ADMIN);
  const html = await (await admin.fetch(`/admin/courses/${course().id}/settings`)).text();
  assert.ok(!/haiku/i.test(html), 'ADR 0002 — the option is absent rather than discouraged');

  const refused = await patch(admin, { title: 'Английский A1', graderModel: 'claude-haiku-4-5-20251001' });
  assert.equal(refused.status, 422);
  const body = await refused.json() as { faults: string[] };
  assert.deepEqual(body.faults, ['grader_model_forbidden']);
  assert.notEqual(faultMessage('grader_model_forbidden'), 'grader_model_forbidden',
    'and the code has Russian to be read as');
});

test('every refusal reason arrives at once, and nothing is written', async () => {
  const admin = await signedIn(ADMIN);
  const before = course();

  const refused = await patch(admin, { title: '   ', graderModel: 'gpt-9' });
  assert.equal(refused.status, 422);
  const body = await refused.json() as { faults: string[] };
  assert.deepEqual([...body.faults].sort(), ['course_title_empty', 'grader_model_unknown']);

  const after = course();
  assert.equal(after.title, before.title, 'the refused write changed nothing');
  assert.equal(after.graderModel, before.graderModel);
});

test('a Course that is not there is refused, and a title that is not a string is malformed', async () => {
  const admin = await signedIn(ADMIN);

  const missing = await admin.fetch('/api/admin/courses/9999', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Ничей курс' }),
  });
  assert.equal(missing.status, 422);
  assert.deepEqual((await missing.json() as { faults: string[] }).faults, ['course_not_found']);

  assert.equal((await patch(admin, { title: 42 })).status, 400);
});
