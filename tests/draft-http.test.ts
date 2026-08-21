// Seam 1 — the Draft over HTTP.
//
// The assertion that matters most here is negative: an Admin saves a Draft, and
// a Student reloading the Lesson sees exactly what they saw before. Saving and
// publishing being different acts is a claim about what another actor can
// observe, so it is checked by having that actor look.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { ru } from '../src/ru.ts';

const DRAFT_ENDPOINTS = ['/api/admin/lessons/1/draft', '/api/admin/lessons/1/publish'];

let app: BootedApp;

test.before(async () => {
  app = await bootApp({ content: [ENGLISH_A1] });
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

const A_THEORY = {
  title: 'Артикли и существительные',
  grammarFocus: 'Неопределённый артикль a/an',
  theoryMarkdown: '# Совсем другая теория\n\nЭтот текст студент видеть пока не должен.',
};

test('the Draft endpoints are closed to a Student who is not an Admin', async () => {
  const client = await signedIn(STUDENT);
  for (const path of DRAFT_ENDPOINTS) {
    assert.equal((await postJson(client, path, A_THEORY)).status, 404, path);
  }
});

test('the Draft endpoints are closed to a visitor with no session', async () => {
  const client = new Client(app.baseUrl);
  for (const path of DRAFT_ENDPOINTS) {
    const response = await postJson(client, path, A_THEORY);
    assert.equal(response.status, 307, `${path} is turned away by the choke point`);
  }
});

test('an Admin opens the editor and sees the Lesson as it is published', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/admin/lessons/1');
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, new RegExp(ENGLISH_A1.lessons[0]!.grammarFocus), 'the grammar focus is offered for editing');
  assert.match(html, new RegExp(ru.draft.save), 'and can be saved');
  assert.match(html, new RegExp(ru.draft.publish), 'and published, as a separate act');
});

test('a saved Draft changes nothing the Student reads; publishing it does', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);

  const before = await (await student.fetch('/lessons/1')).text();
  assert.doesNotMatch(before, /Совсем другая теория/, 'the new Theory is not there yet, obviously');

  const saved = await postJson(admin, '/api/admin/lessons/1/draft', A_THEORY);
  assert.equal(saved.status, 200);
  const { draftId } = (await saved.json()) as { draftId: number };
  assert.ok(Number.isInteger(draftId), 'the Draft is identified so exactly it can be published');

  const afterSave = await (await student.fetch('/lessons/1')).text();
  assert.doesNotMatch(afterSave, /Совсем другая теория/, 'saving published nothing');
  assert.equal(
    afterSave.includes(ENGLISH_A1.lessons[0]!.title),
    true,
    'the Student still reads the published Lesson',
  );

  const published = await postJson(admin, '/api/admin/lessons/1/publish', { draftId });
  assert.equal(published.status, 200);
  assert.deepEqual(await published.json(), { ok: true });

  const afterPublish = await (await student.fetch('/lessons/1')).text();
  assert.match(afterPublish, /Совсем другая теория/, 'now the Student reads it');
});

test('the Course listing says which Lessons are ahead of what is published', async () => {
  const admin = await signedIn(ADMIN);

  await postJson(admin, '/api/admin/lessons/2/draft', {
    title: ENGLISH_A1.lessons[1]!.title,
    grammarFocus: ENGLISH_A1.lessons[1]!.grammarFocus,
    theoryMarkdown: '# Черновик второго урока',
  });

  const html = await (await admin.fetch('/admin/courses/1')).text();
  assert.match(html, new RegExp(ru.admin.unpublishedChanges), 'the Lesson with a newer Draft says so');
});

test('a publish refused for a broken document leaves the Lesson alone and says why', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);
  const before = await (await student.fetch('/lessons/2')).text();

  const saved = await postJson(admin, '/api/admin/lessons/2/draft', {
    title: 'Название есть',
    grammarFocus: '   ',
    theoryMarkdown: '# Теория есть',
  });
  const { draftId } = (await saved.json()) as { draftId: number };

  const refused = await postJson(admin, '/api/admin/lessons/2/publish', { draftId });
  assert.equal(refused.status, 422);
  const body = (await refused.json()) as { ok: boolean; faults: Array<{ code: string }> };
  assert.equal(body.ok, false);
  assert.deepEqual(body.faults.map((f) => f.code), ['grammar_focus_empty']);

  assert.equal(await (await student.fetch('/lessons/2')).text(), before, 'the Lesson is byte-for-byte unchanged');
});

test("a Draft belonging to another Lesson cannot be published through this Lesson's endpoint", async () => {
  const admin = await signedIn(ADMIN);

  const saved = await postJson(admin, '/api/admin/lessons/2/draft', {
    title: ENGLISH_A1.lessons[1]!.title,
    grammarFocus: ENGLISH_A1.lessons[1]!.grammarFocus,
    theoryMarkdown: '# Черновик, принадлежащий второму уроку',
  });
  const { draftId } = (await saved.json()) as { draftId: number };

  assert.equal(
    (await postJson(admin, '/api/admin/lessons/1/publish', { draftId })).status,
    404,
    'refused, and told nothing about which Drafts exist elsewhere',
  );
});

test('a body that is not a Theory at all is refused before anything is stored', async () => {
  const admin = await signedIn(ADMIN);
  for (const body of [null, 'a string', { title: 'x' }, { title: 1, grammarFocus: 'y', theoryMarkdown: 'z' }]) {
    assert.equal(
      (await postJson(admin, '/api/admin/lessons/1/draft', body)).status,
      400,
      JSON.stringify(body) ?? 'null',
    );
  }
});

test('a Lesson that does not exist is a 404 on every Draft surface', async () => {
  const admin = await signedIn(ADMIN);
  assert.equal((await admin.fetch('/admin/lessons/9999')).status, 404);
  assert.equal((await postJson(admin, '/api/admin/lessons/9999/draft', A_THEORY)).status, 404);
  assert.equal((await postJson(admin, '/api/admin/lessons/9999/publish', {})).status, 404);
});

test('republishing a Draft that is already live is refused with a conflict', async () => {
  const admin = await signedIn(ADMIN);

  const saved = await postJson(admin, '/api/admin/lessons/2/draft', {
    title: ENGLISH_A1.lessons[1]!.title,
    grammarFocus: ENGLISH_A1.lessons[1]!.grammarFocus,
    theoryMarkdown: '# Первая опубликованная правка',
  });
  const { draftId } = (await saved.json()) as { draftId: number };
  assert.equal((await postJson(admin, '/api/admin/lessons/2/publish', { draftId })).status, 200);

  const again = await postJson(admin, '/api/admin/lessons/2/publish', { draftId });
  assert.equal(again.status, 409, 'nothing is wrong with the Draft — it is simply already live');
  const body = (await again.json()) as { ok: boolean; reason: string };
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'already_published');
});
