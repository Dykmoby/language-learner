// Seam 1 — accounts and the forced first password change, over HTTP.
//
// The unit suite proves the rules; this proves the doors. What is asserted here
// is what a browser can observe: the status it receives, where it is sent, and
// the Russian on the page.
//
// The claim the whole feature rests on is one of these tests: an account holding
// a Temporary Password can reach *nothing* — not a Lesson, not the Courses list,
// not the Admin section — until it has one of its own. A rule enforced on some
// paths is not enforced.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { studentIdFor } from './helpers/inspect.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
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
  const response = await client.signIn(who.username, who.password);
  assert.equal(response.status, 303, `${who.username} signed in`);
  return client;
}

async function createAccount(client: Client, username: string): Promise<string> {
  const response = await client.fetch('/api/admin/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  assert.equal(response.status, 200, `the account ${username} was created`);
  const body = await response.json() as { temporaryPassword: string };
  return body.temporaryPassword;
}

function redirectedTo(response: Response): string {
  return new URL(response.headers.get('location')!, app.baseUrl).pathname;
}

// --- The guard ---------------------------------------------------------------

test('the account endpoints do not exist for a Student who is not an Admin', async () => {
  const client = await signedIn(STUDENT);

  const created = await client.fetch('/api/admin/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'smuggled' }),
  });
  assert.equal(created.status, 404, 'creating an account');

  const deleted = await client.fetch('/api/admin/students/1', { method: 'DELETE' });
  assert.equal(deleted.status, 404, 'deleting one');

  const withdrawn = await client.fetch('/api/admin/courses/1/enrollments/1', { method: 'DELETE' });
  assert.equal(withdrawn.status, 404, 'and taking somebody off a Course');
});

// --- Making an account -------------------------------------------------------

test('an Admin creates an account and is handed its Temporary Password once', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/api/admin/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'anna' }),
  });

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('cache-control') ?? '', /no-store/,
    'a password in plain text must not be kept by anything between here and the screen',
  );

  const body = await response.json() as {
    ok: boolean;
    student: { id: number; username: string };
    temporaryPassword: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.student.username, 'anna');
  assert.match(body.temporaryPassword, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
});

test('a username already taken is refused with a reason an Admin can read', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/api/admin/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'anna' }),
  });

  assert.equal(response.status, 422);
  const body = await response.json() as { faults: string[] };
  assert.deepEqual(body.faults, ['username_taken']);
  assert.ok(ru.accountFaults.username_taken.length > 0, 'and the code has a sentence behind it');
});

test('the accounts screen lists every account, the Admin included', async () => {
  const client = await signedIn(ADMIN);
  const response = await client.fetch('/admin/students');
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.ok(html.includes('anna'), 'the account just made');
  assert.ok(html.includes(ADMIN.username), 'and the one looking at the screen');
  assert.ok(
    html.includes(ru.admin.cannotDeleteSelfHint),
    'which says plainly that it cannot be deleted from here',
  );
});

// --- The forced first change -------------------------------------------------

test('an account holding a Temporary Password can reach nothing else', async () => {
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'boris');

  const boris = new Client(app.baseUrl);
  assert.equal((await boris.signIn('boris', temporary)).status, 303, 'the Temporary Password signs in');

  // Everything a signed-in Student would otherwise be able to open, including
  // the section that would normally answer a non-Admin with a 404: the middleware
  // answers first, and what it says is "change your password".
  for (const path of ['/', '/courses', '/courses/1', '/lessons/1', '/admin', '/admin/students']) {
    const response = await boris.fetch(path);
    assert.equal(response.status, 307, `${path} is not served`);
    assert.equal(redirectedTo(response), '/password', `${path} leads to the password screen`);
  }

  const screen = await boris.fetch('/password');
  assert.equal(screen.status, 200);
  const html = await screen.text();
  assert.ok(html.includes(ru.password.forcedLead), 'which says why it is the only screen there is');
  assert.ok(html.includes(ru.password.temporaryField), 'and asks for the password they were given');
});

test('the Temporary Password cannot be kept by typing it back in', async () => {
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'vera');

  const vera = new Client(app.baseUrl);
  await vera.signIn('vera', temporary);

  const response = await vera.fetch('/api/password', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      current: temporary, next: temporary, confirmation: temporary,
    }).toString(),
  });

  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location')!, app.baseUrl);
  assert.equal(location.pathname, '/password');
  assert.deepEqual(location.searchParams.getAll('error'), ['password_unchanged']);

  // Still fenced in, which is the point of refusing.
  assert.equal(redirectedTo(await vera.fetch('/courses')), '/password');
});

test('a refusal is shown on the screen it came from, in Russian', async () => {
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'galina');

  const galina = new Client(app.baseUrl);
  await galina.signIn('galina', temporary);

  const response = await galina.fetch('/password?error=password_too_short&error=password_mismatch');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes(ru.accountFaults.password_too_short));
  assert.ok(html.includes(ru.accountFaults.password_mismatch));
});

test('a fault code invented in the address bar becomes no message at all', async () => {
  // Everywhere else an unknown code is rendered as it came, so a real fault is
  // never hidden from whoever has to fix it. Here the code came from the address
  // bar, and a screen that turned it into a message would be somewhere to write
  // a sentence for somebody else to read.
  //
  // What is asserted is that no refusal is *shown* — the alert list is simply not
  // there. Not that the string is absent from the response: React escapes it
  // either way, and Next serialises the search parameters into the flight payload
  // of any dynamic page whether or not anything rendered them.
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'dmitri');

  const dmitri = new Client(app.baseUrl);
  await dmitri.signIn('dmitri', temporary);

  const invented = await (await dmitri.fetch('/password?error=ВАШ_АККАУНТ_ВЗЛОМАН')).text();
  assert.ok(!invented.includes('role="alert"'), 'nothing is reported');

  const real = await (await dmitri.fetch('/password?error=password_mismatch')).text();
  assert.ok(real.includes('role="alert"'), 'and a real code still is');
  assert.ok(real.includes(ru.accountFaults.password_mismatch));
});

test('once the password is their own, the Student is let through and the old one is dead', async () => {
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'ekaterina');

  const katya = new Client(app.baseUrl);
  await katya.signIn('ekaterina', temporary);

  const changed = await katya.fetch('/api/password', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      current: temporary,
      next: 'её собственный пароль',
      confirmation: 'её собственный пароль',
    }).toString(),
  });
  assert.equal(changed.status, 303);
  assert.equal(new URL(changed.headers.get('location')!, app.baseUrl).pathname, '/password');

  const confirmation = await (await katya.fetch('/password?changed=1')).text();
  assert.ok(confirmation.includes(ru.password.changed), 'the screen says it worked');
  assert.ok(confirmation.includes(ru.password.voluntaryLead), 'and stops saying they are stuck here');

  // No longer fenced in. Enrolled in nothing yet, so `/courses` is the honest
  // destination — what matters is that it is served rather than redirected.
  assert.equal((await katya.fetch('/courses')).status, 200);

  // The password the Admin still knows is not a way in.
  const withTheOldOne = new Client(app.baseUrl);
  const refused = await withTheOldOne.signIn('ekaterina', temporary);
  assert.equal(refused.status, 303);
  assert.match(refused.headers.get('location')!, /\/login\?error=invalid/);
});

test('a Student whose password was never temporary can still change it on purpose', async () => {
  const client = await signedIn(STUDENT);
  const response = await client.fetch('/password');
  assert.equal(response.status, 200, 'the screen is not only for a forced change');

  const html = await response.text();
  assert.ok(html.includes(ru.password.voluntaryLead));
  assert.ok(html.includes(ru.password.currentField), 'and asks for the password they chose');
});

// --- Deleting an account -----------------------------------------------------

test('deleting an account signs out the device that was already using it', async () => {
  const admin = await signedIn(ADMIN);
  const temporary = await createAccount(admin, 'pavel');

  const pavel = new Client(app.baseUrl);
  await pavel.signIn('pavel', temporary);
  assert.equal(redirectedTo(await pavel.fetch('/courses')), '/password', 'signed in');

  const id = studentIdFor(app.databasePath, 'pavel');
  const deleted = await admin.fetch(`/api/admin/students/${id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true, username: 'pavel' });

  // The session was a row, and the row went with the account. A stateless token
  // could not have been taken away.
  assert.equal(redirectedTo(await pavel.fetch('/password')), '/login');
});

test('an Admin cannot delete their own account, and is told why', async () => {
  const admin = await signedIn(ADMIN);
  const id = studentIdFor(app.databasePath, ADMIN.username);

  const response = await admin.fetch(`/api/admin/students/${id}`, { method: 'DELETE' });
  assert.equal(response.status, 422);
  const body = await response.json() as { faults: string[] };
  assert.deepEqual(body.faults, ['cannot_delete_self']);

  // Still an Admin, still signed in.
  assert.equal((await admin.fetch('/admin')).status, 200);
});

test('deleting an account that is not there is a 404, not a success', async () => {
  const admin = await signedIn(ADMIN);
  assert.equal((await admin.fetch('/api/admin/students/9999', { method: 'DELETE' })).status, 404);
  assert.equal((await admin.fetch('/api/admin/students/nonsense', { method: 'DELETE' })).status, 404);
});

// --- Taking a Student off a Course -------------------------------------------

test('a Student taken off a Course stops seeing it, and gets it back unchanged', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);
  const id = studentIdFor(app.databasePath, STUDENT.username);

  const before = await (await student.fetch('/courses')).text();
  assert.ok(before.includes(ENGLISH_A1.title), 'enrolled by the fixture');

  const withdrawn = await admin.fetch(`/api/admin/courses/1/enrollments/${id}`, { method: 'DELETE' });
  assert.equal(withdrawn.status, 200);
  assert.deepEqual(await withdrawn.json(), { ok: true, removed: true });

  const after = await (await student.fetch('/courses')).text();
  assert.ok(!after.includes(ENGLISH_A1.title), 'and the Course is out of reach');
  assert.equal((await student.fetch('/courses/1')).status, 404, 'including by its address');

  // Withdrawing again is not an error: an Enrollment is a fact rather than an
  // event, and the fact is already what it is.
  const again = await admin.fetch(`/api/admin/courses/1/enrollments/${id}`, { method: 'DELETE' });
  assert.deepEqual(await again.json(), { ok: true, removed: false });

  // Put back, because withdrawal removes access and nothing else.
  const restored = await admin.fetch('/api/admin/courses/1/enrollments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ studentId: id }),
  });
  assert.equal(restored.status, 200);
  const back = await (await student.fetch('/courses')).text();
  assert.ok(back.includes(ENGLISH_A1.title));
});

test('the Course screen offers the way off it beside the way onto it', async () => {
  const admin = await signedIn(ADMIN);
  const html = await (await admin.fetch('/admin/courses/1')).text();
  assert.ok(html.includes(ru.admin.enroll), 'enrolling');
  assert.ok(html.includes(ru.admin.withdraw), 'and withdrawing');
});
