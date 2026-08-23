// The dashboard's memory, at the HTTP seam.
//
// The failure is provoked rather than mocked, exactly as the Practice's failure
// path is: an application booted with a broken HOME cannot reach its
// credentials, so the check really runs and really fails. No live model is
// involved, and nothing here asserts the text of the failure — ADR 0001 records
// that text as misleading.
//
// The three tests run in order and share one application on purpose: what is
// under test is a memory, and a memory is only worth anything across time.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { count } from 'drizzle-orm';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { withDatabase } from './helpers/inspect.ts';
import { recordHealthCheck, latestHealthCheck } from '../src/ops/health-history.ts';
import { healthChecks } from '../src/db/schema.ts';
import { ru } from '../src/ru.ts';

let app: BootedApp;

before(async () => {
  app = await bootApp({ env: { HOME: '/nonexistent-home-for-this-test' } });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

async function adminClient(): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);
  return client;
}

function recordedRuns(): number {
  return withDatabase(app.databasePath, (db) =>
    db.select({ n: count() }).from(healthChecks).get()?.n ?? 0);
}

test('a dashboard with no check ever recorded says so, and does not read as a failure', async () => {
  const html = await (await (await adminClient()).fetch('/admin')).text();

  assert.ok(html.includes(ru.health.never), 'the dashboard says the check has never run');
  assert.ok(html.includes(ru.health.neverHint), 'and says what that means');
  assert.ok(!html.includes(ru.health.unhealthy), 'it does not claim the Grader is down');
  assert.equal(recordedRuns(), 0, 'and rendering it ran no check');
});

test('a run too old to be evidence renders as stale rather than as a failure', async () => {
  // A healthy run, a month ago. Written through the application's own module,
  // never hand-rolled SQL — a stale row has to be the same shape as a fresh one.
  withDatabase(app.databasePath, (db) => {
    recordHealthCheck(
      db,
      {
        healthy: true, wallMs: 4800, reason: null,
        likelyCredentials: false, likelyEgress: false,
        detail: {
          verdict: 'partially_correct', errorCount: 1, contextTokens: 894,
          modelsInvoked: ['claude-sonnet-5'], wasFenced: false, unknownErrorTypes: [],
        },
      },
      'timer',
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    );
  });

  const html = await (await (await adminClient()).fetch('/admin')).text();

  assert.ok(html.includes(ru.health.stale), 'the dashboard calls it stale');
  assert.ok(html.includes(ru.health.staleHint), 'and says why an old pass proves nothing');
  assert.ok(!html.includes(ru.health.unhealthy), 'and does not call a pass a failure');
  assert.ok(html.includes(ru.health.ranBy.timer!), 'it says the run came from the timer');
  assert.equal(recordedRuns(), 1, 'rendering the dashboard still ran no check');
});

test('the button records what it found, and the dashboard reads it back without a call of its own', { timeout: 180_000 }, async () => {
  const client = await adminClient();

  const response = await client.fetch('/api/admin/health', { method: 'POST' });
  assert.equal(response.status, 200);
  const result = await response.json() as { healthy: boolean };
  assert.equal(result.healthy, false, 'an application that cannot reach its credentials is not healthy');

  assert.equal(recordedRuns(), 2, 'the run was kept');
  const latest = withDatabase(app.databasePath, latestHealthCheck);
  assert.equal(latest?.healthy, false);
  assert.equal(latest?.source, 'button', 'and knows it was a person who asked');

  const dashboard = await (await client.fetch('/admin')).text();
  assert.ok(dashboard.includes(ru.health.unhealthy), 'the dashboard is red about it');
  assert.ok(dashboard.includes(ru.health.ranBy.button!), 'and says who asked');
  assert.equal(recordedRuns(), 2, 'and reading it spent no Grader call');

  // Not only on the health page — the point of the ticket — but there too, so
  // the page opens with an answer instead of asking for another paid call.
  const page = await (await client.fetch('/admin/health')).text();
  assert.ok(page.includes(ru.health.unhealthy));
  assert.equal(recordedRuns(), 2);
});

test('a Student who is not an Admin never reaches the dashboard, banner and all', async () => {
  const student = new Client(app.baseUrl);
  await student.signIn(STUDENT.username, STUDENT.password);
  assert.equal((await student.fetch('/admin')).status, 404);
});
