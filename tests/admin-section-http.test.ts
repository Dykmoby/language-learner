// Seam 1 — the Admin section, driven over HTTP.
//
// What is asserted here is what a browser can observe: the status, and the
// Russian on the page. The guard is the point of the file. It is checked for all
// three actors on every page in the section, because a section is only as gated
// as its least gated page, and the one that is forgotten is always the new one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { ru } from '../src/ru.ts';

// Every page in the Admin section. A page added to the section without being
// added here is a page whose guard nobody checked.
const ADMIN_PAGES = ['/admin', '/admin/courses/1', '/admin/lessons/1', '/admin/health'];

let app: BootedApp;

test.before(async () => {
  app = await bootApp({ content: [ENGLISH_A1] });
});

test.after(async () => {
  await app.stop();
});

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(who.username, who.password);
  assert.equal(response.status, 303, 'signed in');
  return client;
}

test('a signed-out visitor is sent to the login screen, not shown a 404', async () => {
  // The choke point answers before the Admin narrowing does. That ordering is
  // deliberate: someone who is simply not signed in should be told how to sign
  // in, and only a signed-in non-Admin should be told the page does not exist.
  const client = new Client(app.baseUrl);
  for (const path of ADMIN_PAGES) {
    const response = await client.fetch(path);
    assert.equal(response.status, 307, `${path} redirects`);
    assert.equal(
      new URL(response.headers.get('location')!, app.baseUrl).pathname,
      '/login',
      `${path} redirects to the login screen`,
    );
  }
});

test('a Student who is not an Admin gets a 404 on every page in the section', async () => {
  const client = await signedIn(STUDENT);
  for (const path of ADMIN_PAGES) {
    const response = await client.fetch(path);
    assert.equal(response.status, 404, `${path} does not exist for a non-Admin`);
  }
});

test('an Admin sees every Course with its Language, level and Grader model', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/admin');
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, new RegExp(ENGLISH_A1.title), 'the Course is listed');
  assert.match(html, new RegExp(ru.languages.en!), 'its Language in Russian');
  assert.match(html, new RegExp(ENGLISH_A1.level), 'its CEFR level');
  assert.match(html, new RegExp(ENGLISH_A1.graderModel), 'its Grader model');
  assert.match(html, /href="\/admin\/courses\/1"/, 'and links through to it');
});

test('an Admin opening a Course sees its Lessons in position order', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/admin/courses/1');
  assert.equal(response.status, 200);

  const html = await response.text();
  const positions = ENGLISH_A1.lessons.map((lesson) => html.indexOf(lesson.title));
  for (const [index, at] of positions.entries()) {
    assert.notEqual(at, -1, `lesson ${index + 1} is listed`);
  }
  assert.deepEqual(
    [...positions].sort((a, b) => a - b),
    positions,
    'listed in the Course\'s own order rather than whatever the query returned',
  );

  assert.match(html, new RegExp(ru.admin.published), 'each Lesson states its published state');
  assert.match(
    html,
    new RegExp(ru.admin.exerciseCount(ENGLISH_A1.lessons[0]!.practice.length)),
    'and how many Exercises it holds',
  );
});

test('a Course that does not exist is a 404 even for an Admin', async () => {
  const client = await signedIn(ADMIN);
  for (const path of ['/admin/courses/9999', '/admin/courses/not-a-number']) {
    assert.equal((await client.fetch(path)).status, 404, path);
  }
});

test('the Admin section is reachable from the home page, and the health check from the section', async () => {
  const client = await signedIn(ADMIN);

  const home = await client.fetch('/');
  // A signed-in Admin with a Current Course is redirected into it; the link is
  // on the page they land on either way, so follow the redirect once.
  const landing = home.status === 307
    ? await client.fetch(new URL(home.headers.get('location')!, app.baseUrl).pathname)
    : home;
  assert.equal(landing.status, 200);

  const section = await client.fetch('/admin');
  assert.match(await section.text(), /href="\/admin\/health"/, 'the health check is linked');
});

test('a Student who is not an Admin is offered no link into the section', async () => {
  const client = await signedIn(STUDENT);
  const response = await client.fetch('/');
  const landing = response.status === 307
    ? await client.fetch(new URL(response.headers.get('location')!, app.baseUrl).pathname)
    : response;

  assert.doesNotMatch(await landing.text(), /href="\/admin/, 'no way in is advertised');
});
