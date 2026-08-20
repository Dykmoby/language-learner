import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT } from './helpers/app.ts';
import { ru } from '../src/ru.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function reason(response: Response, base: string): URLSearchParams {
  return new URL(response.headers.get('location')!, base).searchParams;
}

// Backoff off, so failures can be counted without waiting them out. The counting
// and the waiting are separate behaviours and are tested separately.
const NO_BACKOFF = { LOGIN_BACKOFF_BASE_SECONDS: '0' };

test('the delay before a retry grows across consecutive failures', async () => {
  const app = await bootApp({ env: { LOGIN_BACKOFF_BASE_SECONDS: '1' } });
  try {
    const client = new Client(app.baseUrl);

    await client.signIn(STUDENT.username, 'wrong');
    const afterFirst = reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl);
    assert.equal(afterFirst.get('error'), 'slow');
    const firstDelay = Number(afterFirst.get('seconds'));
    assert.ok(firstDelay >= 1, 'the next attempt has to wait');

    await sleep(firstDelay * 1000 + 250);

    await client.signIn(STUDENT.username, 'wrong');
    const afterSecond = reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl);
    assert.equal(afterSecond.get('error'), 'slow');
    const secondDelay = Number(afterSecond.get('seconds'));

    assert.ok(secondDelay > firstDelay, `the delay grows: ${firstDelay}s then ${secondDelay}s`);
  } finally { await app.stop(); }
});

test('the fifth consecutive failure locks the account', async () => {
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 4; i++) {
      const params = reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl);
      assert.equal(params.get('error'), 'invalid', `failure ${i + 1} slows, it does not lock`);
    }
    const fifth = reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl);
    assert.equal(fifth.get('error'), 'locked', 'guessing stops entirely rather than merely slowing');
  } finally { await app.stop(); }
});

test('a locked account refuses even the correct password', async () => {
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) await client.signIn(STUDENT.username, 'wrong');

    const response = await client.signIn(STUDENT.username, STUDENT.password);
    assert.equal(reason(response, app.baseUrl).get('error'), 'locked');
    assert.equal(response.headers.getSetCookie().find((c) => c.startsWith('ll_session=')), undefined);
  } finally { await app.stop(); }
});

test('the lockout message is Russian, from the central dictionary, and states the duration', async () => {
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) await client.signIn(STUDENT.username, 'wrong');

    const redirected = await client.signIn(STUDENT.username, 'wrong');
    const location = new URL(redirected.headers.get('location')!, app.baseUrl);
    const page = await client.fetch(`${location.pathname}${location.search}`);
    const html = await page.text();

    // The default lockout is 15 minutes, and the Student must be told so rather
    // than left to conclude the application is broken.
    assert.ok(html.includes(ru.login.lockedOut(15)), 'the exact dictionary string is rendered');
    assert.match(html, /15 минут/);
  } finally { await app.stop(); }
});

test('the throttle is keyed by username: failures against one account do not throttle the other', async () => {
  // Keyed by username, not IP: the application sits behind Caddy so the peer
  // address is a proxy header, and with two known accounts the account is the
  // thing being attacked.
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const attacker = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) await attacker.signIn(STUDENT.username, 'wrong');
    assert.equal(reason(await attacker.signIn(STUDENT.username, 'wrong'), app.baseUrl).get('error'), 'locked');

    // Same caller, same address, different account — and the Admin gets in.
    const admin = new Client(app.baseUrl);
    const response = await admin.signIn(ADMIN.username, ADMIN.password);
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('location')!, app.baseUrl).pathname, '/');
  } finally { await app.stop(); }
});

test('restarting the service leaves an active lockout in force', async () => {
  // State is persisted, not held in memory: restarting must not clear a lockout,
  // or the lockout is worth nothing to anyone who can crash the process.
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) await client.signIn(STUDENT.username, 'wrong');
    assert.equal(reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl).get('error'), 'locked');

    await app.restart();

    const after = new Client(app.baseUrl);
    const response = await after.signIn(STUDENT.username, STUDENT.password);
    assert.equal(reason(response, app.baseUrl).get('error'), 'locked', 'the lockout survived the restart');
  } finally { await app.stop(); }
});

test('the correct password simply works once the lockout has expired, with no Admin action', async () => {
  const app = await bootApp({ env: { ...NO_BACKOFF, LOGIN_LOCKOUT_SECONDS: '2' } });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) await client.signIn(STUDENT.username, 'wrong');
    assert.equal(reason(await client.signIn(STUDENT.username, 'wrong'), app.baseUrl).get('error'), 'locked');

    await sleep(2300);

    const response = await client.signIn(STUDENT.username, STUDENT.password);
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('location')!, app.baseUrl).pathname, '/',
      'a locked account is a delay, never something the Admin has to fix');
  } finally { await app.stop(); }
});

test('a successful sign-in resets the failure count to zero', async () => {
  // A bad-typing day must not accumulate toward a lockout weeks later.
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const client = new Client(app.baseUrl);
    for (let i = 0; i < 4; i++) await client.signIn(STUDENT.username, 'wrong');

    const signedIn = await client.signIn(STUDENT.username, STUDENT.password);
    assert.equal(signedIn.status, 303);
    assert.equal(new URL(signedIn.headers.get('location')!, app.baseUrl).pathname, '/');

    // If the counter had survived, the very next failure would be the fifth.
    const next = new Client(app.baseUrl);
    for (let i = 0; i < 4; i++) {
      const params = reason(await next.signIn(STUDENT.username, 'wrong'), app.baseUrl);
      assert.equal(params.get('error'), 'invalid', `failure ${i + 1} after the reset does not lock`);
    }
    assert.equal(reason(await next.signIn(STUDENT.username, 'wrong'), app.baseUrl).get('error'), 'locked',
      'and the count starts again from one, locking on the fifth');
  } finally { await app.stop(); }
});

test('an unknown username is throttled exactly like a real one, so accounts cannot be enumerated', async () => {
  const app = await bootApp({ env: NO_BACKOFF });
  try {
    const real = new Client(app.baseUrl);
    const fake = new Client(app.baseUrl);
    for (let i = 0; i < 5; i++) {
      await real.signIn(STUDENT.username, 'wrong');
      await fake.signIn('nobody-by-that-name', 'wrong');
    }
    const realResponse = await real.signIn(STUDENT.username, 'wrong');
    const fakeResponse = await fake.signIn('nobody-by-that-name', 'wrong');

    assert.equal(reason(realResponse, app.baseUrl).get('error'), 'locked');
    assert.equal(reason(fakeResponse, app.baseUrl).get('error'), 'locked',
      'if only real accounts locked, the lockout itself would confirm which names exist');
  } finally { await app.stop(); }
});
