// The unhealthy path, tested without a mock: boot the application with a
// deliberately broken HOME and assert the check reports unhealthy with a reason.
//
// This is the one test that reaches a live SDK call. It is expected to be slow.
// It asserts only that the check reports unhealthy with a reason — never on the
// specific error text, which ADR 0001 records as misleading: the failure does not
// present as an auth error.
//
// The HEALTHY path is deliberately not automated. It needs real credentials and a
// real paid call, which would make the suite non-hermetic; it is verified by hand
// on the Pi as the go-live proof of this step.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, type BootedApp } from './helpers/app.ts';

let app: BootedApp;

before(async () => {
  app = await bootApp({ env: { HOME: '/nonexistent-home-for-this-test' } });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

test('a service that cannot read its credentials reports unhealthy, with a reason', { timeout: 180_000 }, async () => {
  const client = new Client(app.baseUrl);
  await client.signIn(ADMIN.username, ADMIN.password);

  const response = await client.fetch('/api/admin/health', { method: 'POST' });
  assert.equal(response.status, 200, 'an unhealthy check is a result, not an error status');

  const result = await response.json() as {
    healthy: boolean; reason: string | null; wallMs: number; likelyCredentials: boolean;
  };

  assert.equal(result.healthy, false, 'the failure surfaces to the Admin rather than to a Student mid-Lesson');
  assert.ok(result.reason && result.reason.length > 0, 'and it carries a reason');
  assert.equal(typeof result.wallMs, 'number');

  // A heuristic, and the interface says so. Asserting the flag, never the text.
  assert.equal(result.likelyCredentials, true,
    'a service that cannot reach ~/.claude at all should say this looks like credentials');
});

test('an auth-shaped failure with readable credentials is reported as egress, not credentials', { timeout: 180_000 }, async () => {
  // The failure this step actually hit: credentials perfectly readable, no
  // outbound proxy, and a 403 that reads like an authentication problem. Pointing
  // the Admin at ~/.claude there would send them to exactly the wrong place.
  const withoutProxy = await bootApp({
    env: { HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' },
  });
  try {
    const client = new Client(withoutProxy.baseUrl);
    await client.signIn(ADMIN.username, ADMIN.password);

    const result = await (await client.fetch('/api/admin/health', { method: 'POST' })).json() as {
      healthy: boolean; likelyCredentials: boolean; likelyEgress: boolean; reason: string | null;
    };

    assert.equal(result.healthy, false);
    assert.equal(result.likelyCredentials, false, 'the credentials are readable and must not be blamed');
    assert.equal(result.likelyEgress, true, 'the Admin is pointed at the proxy instead');
  } finally { await withoutProxy.stop(); }
});
