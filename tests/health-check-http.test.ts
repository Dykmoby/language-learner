import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { ru } from '../src/ru.ts';

let app: BootedApp;
before(async () => { app = await bootApp(); });
after(async () => { await app?.stop(); });

test('the Admin reaches a page with a health-check control, every string from the dictionary', async () => {
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);

  const response = await client.fetch('/admin/health');
  assert.equal(response.status, 200);

  const html = await response.text();
  for (const expected of [ru.health.title, ru.health.explanation, ru.health.run]) {
    assert.ok(html.includes(expected), `the health page is missing ${JSON.stringify(expected)}`);
  }
});

test('a non-Admin Student is refused the health check', async () => {
  const client = new Client(app.baseUrl);
  await client.signIn(STUDENT.username, STUDENT.password);

  assert.equal((await client.fetch('/admin/health')).status, 404, 'the page does not exist for them');

  const api = await client.fetch('/api/admin/health', { method: 'POST' });
  assert.equal(api.status, 403, 'and neither does the endpoint behind it');
});

test('a signed-out request for the health check is refused', async () => {
  const client = new Client(app.baseUrl);
  assert.equal((await client.fetch('/admin/health')).status, 307);
  assert.equal((await client.fetch('/api/admin/health', { method: 'POST' })).status, 307);
});

test('the Admin landing page links to the health check; a Student sees no such link', async () => {
  const admin = new Client(app.baseUrl);
  await admin.signIn(ADMIN.username, ADMIN.password);
  const adminHtml = await (await admin.fetch('/')).text();
  assert.ok(adminHtml.includes('/admin/health'), 'the Admin is offered the check');
  assert.ok(adminHtml.includes(ru.home.adminBadge), 'and is shown the Admin badge');

  const student = new Client(app.baseUrl);
  await student.signIn(STUDENT.username, STUDENT.password);
  const html = await (await student.fetch('/')).text();
  assert.ok(!html.includes('/admin/health'));
  assert.ok(!html.includes(ru.home.adminBadge), 'and is not shown the Admin badge');
});
