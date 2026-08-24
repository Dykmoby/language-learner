// Seam 1 — the header, against a booted application.
//
// Two of these are about live defects rather than appearance. A Student could
// not sign out: the control lived on the home screen, and the home screen sends
// a Student who has a Current Course straight into that Course, so the one
// screen carrying the button was the one screen an enrolled Student was never
// allowed to stay on. And the back-link from a Course pointed at the home
// screen, which redirected to the Current Course, which was the Course they had
// just left — the ordinary path, since working in a Course is what makes it the
// Current Course.
//
// Both are the kind of thing that is obvious in a browser and invisible to every
// other test in this repository, which is why they are asserted here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ru } from '../src/ru.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { courseIdFor, lessonsOf, unenroll } from './helpers/inspect.ts';

let app: BootedApp;

before(async () => {
  app = await bootApp({ content: [ENGLISH_A1, DETERMINISTIC_COURSE] });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

async function signedIn(account = STUDENT): Promise<Client> {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(account.username, account.password);
  assert.equal(response.status, 303);
  return client;
}

const courseId = () => courseIdFor(app.databasePath, ENGLISH_A1.title);
const lessonId = () => lessonsOf(app.databasePath, ENGLISH_A1.title)[0]!.lesson.id;

/** The header's own element, whether or not it is wearing the Admin section's width. */
const HEADER = /class="appHeader[ "]/;

/** Every href a screen offers, absolute paths only. */
function linksOn(html: string): string[] {
  return [...new Set([...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]!))]
    // Next's own asset URLs are not navigation.
    .filter((href) => !href.startsWith('/_next') && !href.startsWith('/fonts'));
}

test('the header wraps every signed-in screen, Student and Admin alike', async () => {
  const student = await signedIn();
  const admin = await signedIn(ADMIN);

  const studentScreens = [
    '/courses',
    `/courses/${courseId()}`,
    `/courses/${courseId()}/progress`,
    `/lessons/${lessonId()}`,
    `/lessons/${lessonId()}/practice`,
  ];
  const adminScreens = ['/admin', '/admin/disputes', `/admin/courses/${courseId()}`];

  for (const [client, screens] of [[student, studentScreens], [admin, adminScreens]] as const) {
    for (const path of screens) {
      const response = await client.fetch(path);
      assert.equal(response.status, 200, `${path} did not render`);
      const html = await response.text();
      assert.match(html, HEADER, `${path} has no header`);
      assert.ok(html.includes(ru.common.signOut), `${path} offers no way to sign out`);
    }
  }
});

test('the sign-in screen has no header — there is no session to show and nowhere to go', async () => {
  const html = await (await new Client(app.baseUrl).fetch('/login')).text();
  assert.doesNotMatch(html, HEADER);
  assert.ok(!html.includes(ru.common.signOut));
});

test('sign-out is reachable from a Course screen reached by redirect from the home screen', async () => {
  // The exact path the defect lived on: open a Course, which records it as the
  // Current Course, then go home and be sent straight back into it.
  const client = await signedIn();
  assert.equal((await client.fetch(`/courses/${courseId()}`)).status, 200);

  const home = await client.fetch('/');
  assert.equal(home.status, 307);
  const landing = new URL(home.headers.get('location')!, app.baseUrl).pathname;
  assert.equal(landing, `/courses/${courseId()}`, 'the Current Course is what home means');

  const html = await (await client.fetch(landing)).text();
  assert.ok(html.includes(ru.common.signOut), 'and it can be left');
  assert.match(html, /action="\/api\/logout"/, 'by the endpoint that ends the session');
});

test('the Admin link appears for an Admin and for nobody else', async () => {
  const admin = await signedIn(ADMIN);
  const adminHtml = await (await admin.fetch(`/courses/${courseId()}`)).text();
  assert.match(adminHtml, /href="\/admin"/, 'an Admin is offered the section');
  assert.ok(adminHtml.includes(ru.chrome.admin));

  const student = await signedIn();
  for (const path of ['/courses', `/courses/${courseId()}`, `/lessons/${lessonId()}`]) {
    const html = await (await student.fetch(path)).text();
    assert.doesNotMatch(html, /href="\/admin/, `${path} advertises the Admin section`);
    assert.ok(!html.includes(ru.chrome.admin), `${path} names the Admin section`);
  }
});

test('the header names the open Course, on the Course and inside its Lessons', async () => {
  const client = await signedIn();

  const course = await (await client.fetch(`/courses/${courseId()}`)).text();
  assert.ok(course.includes(ENGLISH_A1.title));

  // A Lesson's path names no Course, so this is the resolution doing its work
  // rather than the title happening to be on the page anyway.
  const lesson = await (await client.fetch(`/lessons/${lessonId()}`)).text();
  assert.match(
    lesson,
    new RegExp(`class="openCourse" href="/courses/${courseId()}">${ENGLISH_A1.title}`),
    'the header names the Course the Lesson belongs to, and links back to it',
  );
});

test('the header names no Course it is not the Student\'s to see', async () => {
  // The path reaches the layout through a request header, so what it names is a
  // claim rather than a fact — and the layout renders even for a screen that is
  // about to answer 404, which is precisely where a header that trusted the path
  // would leak the title of somebody else's Course.
  const client = await signedIn();
  const otherId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);

  const enrolled = await client.fetch(`/courses/${otherId}`);
  assert.equal(enrolled.status, 200);
  assert.ok((await enrolled.text()).includes(DETERMINISTIC_COURSE.title), 'named while they are in it');

  unenroll(app.databasePath, STUDENT.username, DETERMINISTIC_COURSE.title);

  const refused = await client.fetch(`/courses/${otherId}`);
  assert.equal(refused.status, 404, 'a Course they are not in does not exist for them');
  assert.ok(
    !(await refused.text()).includes(DETERMINISTIC_COURSE.title),
    'and the header does not name it on the way out',
  );
});

test('no link on a signed-in screen leads back to the screen it is on', async () => {
  // The defect this whole ticket starts from, generalised: a link that resolves
  // to its own origin is a link that does nothing, and the only way to notice is
  // to follow it.
  const client = await signedIn();
  await client.fetch(`/courses/${courseId()}`); // sets the Current Course

  const screens = ['/courses', `/courses/${courseId()}`, `/lessons/${lessonId()}`];
  const circular: string[] = [];

  for (const screen of screens) {
    const html = await (await client.fetch(screen)).text();
    for (const href of linksOn(html)) {
      const response = await client.fetch(href);
      if (response.status < 300 || response.status >= 400) continue;
      const destination = new URL(response.headers.get('location')!, app.baseUrl).pathname;
      if (destination === screen) circular.push(`${screen}: ${href} → ${destination}`);
    }
  }

  assert.deepEqual(circular, [], 'a link that redirects to its own origin');
});
