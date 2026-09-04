import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, setCookieFor, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ru } from '../src/ru.ts';

const COOKIE = 'll_session';
let app: BootedApp;

before(async () => {
  // Backoff off. These tests are about the session and the choke point, and
  // several of them submit a wrong password on purpose — with the throttle armed
  // they would then be made to wait before the next correct sign-in, and would be
  // testing #7's behaviour by accident. The throttle has its own suite.
  app = await bootApp({ env: { LOGIN_BACKOFF_BASE_SECONDS: '0' } });
});
after(async () => { await app?.stop(); });

test('a signed-out request for a protected page redirects to the login screen', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.fetch('/');
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get('location')!, app.baseUrl).pathname, '/login');
});

test('the login screen is reachable while signed out, and every string on it comes from the dictionary', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.fetch('/login');
  assert.equal(response.status, 200);

  const html = await response.text();
  for (const expected of [ru.login.title, ru.login.username, ru.login.password, ru.login.submit]) {
    assert.ok(html.includes(expected), `the login screen is missing ${JSON.stringify(expected)}`);
  }
});

test('correct credentials sign the Student in and land them on a page that proves the session', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(STUDENT.username, STUDENT.password);
  assert.equal(response.status, 303);
  assert.equal(new URL(response.headers.get('location')!, app.baseUrl).pathname, '/');

  // `/` renders nothing of its own: a Student who was working somewhere is put
  // back there, and one who was not is sent to their Courses.
  const home = await client.fetch('/');
  assert.equal(home.status, 307);
  assert.equal(new URL(home.headers.get('location')!, app.baseUrl).pathname, '/courses');

  const landing = await client.fetch('/courses');
  assert.equal(landing.status, 200);
  const html = await landing.text();
  assert.ok(html.includes(ru.home.signedInAs(STUDENT.username)), 'the page names the signed-in Student');
});

test('wrong credentials produce one Russian message that names neither field', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(STUDENT.username, 'not the password');
  assert.equal(response.status, 303);

  const location = new URL(response.headers.get('location')!, app.baseUrl);
  const page = await client.fetch(`${location.pathname}${location.search}`);
  const html = await page.text();

  assert.ok(html.includes(ru.login.invalid), 'the Russian message is shown');
  assert.ok(!/имя пользователя не найдено|неверный пароль/i.test(html), 'neither field is singled out');
});

test('a wrong username and a wrong password are indistinguishable to the caller', async () => {
  const wrongPassword = await new Client(app.baseUrl).signIn(STUDENT.username, 'not the password');
  const noSuchUser = await new Client(app.baseUrl).signIn('nobody-by-that-name', 'not the password');

  assert.equal(wrongPassword.status, noSuchUser.status);
  assert.equal(wrongPassword.headers.get('location'), noSuchUser.headers.get('location'));
  assert.equal(setCookieFor(wrongPassword, COOKIE), null, 'no session is handed out either way');
  assert.equal(setCookieFor(noSuchUser, COOKIE), null);
});

test('the session cookie carries httpOnly, Secure and SameSite=Lax', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(ADMIN.username, ADMIN.password);

  const cookie = setCookieFor(response, COOKIE);
  assert.ok(cookie, 'a session cookie is set');
  assert.match(cookie, /HttpOnly/i, 'page scripts cannot read it');
  assert.match(cookie, /Secure/i, 'it never crosses plain HTTP');
  assert.match(cookie, /SameSite=Lax/i);
});

test('the session id is opaque and random', async () => {
  const first = new Client(app.baseUrl);
  const second = new Client(app.baseUrl);
  await first.signIn(ADMIN.username, ADMIN.password);
  await second.signIn(ADMIN.username, ADMIN.password);

  const idOf = (c: Client) => /ll_session=([^;]+)/.exec(c.cookieHeader)![1]!;
  const a = idOf(first);
  const b = idOf(second);

  assert.notEqual(a, b, 'two sign-ins never produce the same id');
  assert.ok(a.length >= 32, 'long enough not to be guessable');
  assert.ok(!a.toLowerCase().includes(ADMIN.username), 'it encodes nothing about the Student');
});

test('the session survives across requests and across a browser restart', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.signIn(STUDENT.username, STUDENT.password);

  // What makes a cookie survive a browser restart is an explicit expiry rather
  // than being a session cookie. Assert the mechanism, then the behaviour.
  const cookie = setCookieFor(response, COOKIE)!;
  assert.match(cookie, /Expires=/i, 'nobody retypes a password every time they sit down to study');

  assert.equal((await client.fetch('/courses')).status, 200);
  assert.equal((await client.fetch('/courses')).status, 200, 'and again on a later request');

  // A restarted browser is a fresh client that still holds the stored cookie.
  const reopened = new Client(app.baseUrl);
  reopened.setRawCookie(COOKIE, /ll_session=([^;]+)/.exec(client.cookieHeader)![1]!);
  assert.equal((await reopened.fetch('/courses')).status, 200);
});

test('signing out deletes the session, and the old cookie no longer authenticates', async () => {
  const client = new Client(app.baseUrl);
  await client.signIn(STUDENT.username, STUDENT.password);
  const sessionId = /ll_session=([^;]+)/.exec(client.cookieHeader)![1]!;

  const signOut = await client.fetch('/api/logout', { method: 'POST' });
  assert.equal(signOut.status, 303);
  assert.equal(new URL(signOut.headers.get('location')!, app.baseUrl).pathname, '/login');

  // The device is handed to someone else, who still has the old cookie in hand.
  const stale = new Client(app.baseUrl);
  stale.setRawCookie(COOKIE, sessionId);
  const attempt = await stale.fetch('/');
  assert.equal(attempt.status, 307, 'the deleted session is refused, not merely forgotten');
  assert.equal(new URL(attempt.headers.get('location')!, app.baseUrl).pathname, '/login');
});

test('a forged session id does not authenticate', async () => {
  const client = new Client(app.baseUrl);
  client.setRawCookie(COOKIE, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const response = await client.fetch('/');
  assert.equal(response.status, 307);
});

test('/register returns 404 — the route is absent, not guarded', async () => {
  // Asserted from a signed-in client on purpose: a signed-out 404 would be
  // indistinguishable from the choke point turning the request away, and the
  // claim being made is that there is nothing there to sign up to.
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);
  const response = await client.fetch('/register');
  assert.equal(response.status, 404);
});

test('a signed-out stranger cannot even see that /register is absent', async () => {
  const client = new Client(app.baseUrl);
  const response = await client.fetch('/register');
  assert.equal(response.status, 307, 'everything except the login screen goes through the choke point');
});

test('static assets are reachable while signed out', async () => {
  const client = new Client(app.baseUrl);
  const login = await client.fetch('/login');
  const html = await login.text();

  const asset = /\/_next\/static\/[^"']+\.css/.exec(html)?.[0];
  assert.ok(asset, 'the login screen references a stylesheet');

  const response = await client.fetch(asset);
  assert.equal(response.status, 200, 'the login screen can actually render for a signed-out visitor');
});

test('the tab icon is reachable while signed out, and is an image', async () => {
  // The same argument as the typeface below, and it was got wrong once: the
  // matcher excluded `favicon.ico` and not `icon.svg`, so the browser's request
  // for a tab icon — which it makes on its own schedule, often before any
  // session exists — was redirected to the sign-in screen and answered with
  // `text/html`. Nothing errored. The tab was simply blank, and stayed blank
  // after signing in, because a browser caches that answer.
  //
  // So the content type is asserted and not only the status: a 200 of the wrong
  // type is exactly the failure that happened.
  const client = new Client(app.baseUrl);
  const response = await client.fetch('/icon.svg');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg/);
});

test('the sign-in screen points at that icon', async () => {
  // The file being reachable and the page naming it are two claims, and only the
  // pair of them puts an icon in the tab.
  const client = new Client(app.baseUrl);
  const html = await (await client.fetch('/login')).text();

  assert.match(html, /<link[^>]+rel="icon"[^>]+href="\/icon\.svg/);
});

test('the typeface is reachable while signed out', async () => {
  // The sign-in screen is the one screen served to somebody with no session. A
  // font behind the session gate would be answered with a redirect to the
  // sign-in screen, leaving the sign-in screen as the only screen in the
  // application not set in the application's own typeface — and the middleware
  // matcher is a negative lookahead, which is exactly the kind of thing that is
  // right until somebody adds the next entry to it.
  const client = new Client(app.baseUrl);
  const response = await client.fetch('/fonts/ibm-plex-sans-cyrillic.woff2');

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /font/);
});
