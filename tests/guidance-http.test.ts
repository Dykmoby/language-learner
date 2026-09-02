// Issue #79 — the grading guidance edited over HTTP, and the door it is behind.
//
// The rules are covered next door in grader-guidance.test.ts. What is asserted
// here is what a browser can observe: that an Admin can read and change the
// text, that a Student cannot reach the screen or the endpoint at all, and that
// «Вернуть исходный текст» goes back to the shipped constant rather than to the
// previous save.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { SHIPPED_GUIDANCE, GUIDANCE_MAX_LENGTH } from '../src/grader/guidance.ts';
import { ru } from '../src/ru.ts';

let app: BootedApp;

test.before(async () => {
  app = await bootApp({ content: [ENGLISH_A1] });
});

test.after(async () => {
  await app.stop();
});

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(who.username, who.password)).status, 303, 'signed in');
  return client;
}

function put(client: Client, guidance: string): Promise<Response> {
  return client.fetch('/api/admin/guidance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guidance }),
  });
}

test('an Admin opens the editor and finds the shipped text in it', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/admin/guidance');
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.ok(html.includes(ru.guidance.title), 'the screen names itself');
  assert.ok(html.includes('Do not invent errors that are not there.'), 'and holds the shipped guidance');
  assert.ok(html.includes(ru.guidance.shipped), 'and says nobody has changed it');
});

test('the editor is linked from the Admin dashboard and from nowhere a Student can see', async () => {
  const admin = await signedIn(ADMIN);
  assert.match(await (await admin.fetch('/admin')).text(), /href="\/admin\/guidance"/);

  const student = await signedIn(STUDENT);
  assert.equal((await student.fetch('/admin/guidance')).status, 404, 'the screen does not exist for them');
});

test('a Student cannot change the guidance, and a signed-out visitor cannot either', async () => {
  const student = await signedIn(STUDENT);
  assert.equal((await put(student, 'будьте добрее')).status, 404, 'the endpoint does not exist for them');
  assert.equal((await student.fetch('/api/admin/guidance', { method: 'DELETE' })).status, 404);

  const stranger = new Client(app.baseUrl);
  assert.ok([307, 401].includes((await put(stranger, 'будьте добрее')).status), 'and not for a stranger');
});

test('an Admin saves a new guidance, and the screen shows who changed it', async () => {
  const client = await signedIn(ADMIN);
  const saved = await put(client, 'Будьте снисходительны к порядку слов.');
  assert.equal(saved.status, 200);

  const html = await (await client.fetch('/admin/guidance')).text();
  assert.ok(html.includes('Будьте снисходительны к порядку слов.'), 'the new text is in the field');
  assert.ok(!html.includes(ru.guidance.shipped), 'and it no longer claims to be the shipped one');
  assert.ok(html.includes(ADMIN.username), 'the Admin who changed it is named');
});

test('an empty guidance is accepted over HTTP — it means "nothing beyond the skeleton"', async () => {
  const client = await signedIn(ADMIN);
  assert.equal((await put(client, '')).status, 200);
});

test('an over-long guidance is refused in Russian, with the text left as it was', async () => {
  const client = await signedIn(ADMIN);
  assert.equal((await put(client, 'указание')).status, 200);

  const refused = await put(client, 'я'.repeat(GUIDANCE_MAX_LENGTH + 1));
  assert.equal(refused.status, 422);
  const body = await refused.json() as { faults: string[] };
  assert.deepEqual(body.faults, ['guidance_too_long']);
  assert.ok(ru.guidanceFaults.guidance_too_long.length > 0, 'and the code has Russian to be read as');

  const html = await (await client.fetch('/admin/guidance')).text();
  assert.ok(html.includes('указание'), 'the refused write changed nothing');
});

test('«Вернуть исходный текст» goes back to the shipped constant, not to the previous save', async () => {
  const client = await signedIn(ADMIN);
  assert.equal((await put(client, 'первый')).status, 200);
  assert.equal((await put(client, 'второй')).status, 200);

  const restored = await client.fetch('/api/admin/guidance', { method: 'DELETE' });
  assert.equal(restored.status, 200);

  const body = await restored.json() as { standing: { text: string; isShipped: boolean } };
  assert.equal(body.standing.text, SHIPPED_GUIDANCE, 'not «первый»');
  assert.equal(body.standing.isShipped, true);
});

test('a body that is not a string is malformed, which an empty string is not', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/api/admin/guidance', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guidance: 42 }),
  });
  assert.equal(response.status, 400);
});
