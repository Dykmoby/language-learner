// The Grader's failure modes, tested over HTTP without a single mock: each one is
// provoked by booting the application into the condition that causes it.
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

test('the 90s hard timeout aborts the call rather than hanging a Submission', { timeout: 180_000 }, async () => {
  // The abort path is real behaviour a Student can hit, so it is exercised rather
  // than assumed. The timeout is configuration, so the test shortens it instead of
  // waiting 90 seconds for the deployed value.
  const impatient = await bootApp({ env: { GRADER_TIMEOUT_MS: '400' } });
  try {
    const client = new Client(impatient.baseUrl);
    await client.signIn(ADMIN.username, ADMIN.password);

    const result = await (await client.fetch('/api/admin/health', { method: 'POST' })).json() as {
      healthy: boolean; reason: string | null; likelyCredentials: boolean; likelyEgress: boolean;
    };

    assert.equal(result.healthy, false);
    assert.match(result.reason ?? '', /abort/i, 'the AbortController fired');

    // A timeout is a timeout. Blaming credentials or the network for one would
    // send the Admin looking in the wrong place.
    assert.equal(result.likelyCredentials, false);
    assert.equal(result.likelyEgress, false);
  } finally { await impatient.stop(); }
});

test('a Course configured to grade with Haiku fails closed, without spending a call', async () => {
  // The end-to-end half of ADR 0002: not merely that the predicate refuses, but
  // that a refusal reaches the Admin as an unhealthy result instead of reaching a
  // Student as a Verdict.
  const { grade } = await import('../src/grader/grade.ts');
  const started = performance.now();
  const { SHIPPED_GUIDANCE } = await import('../src/grader/guidance.ts');
  const outcome = await grade({
    model: 'claude-haiku-4-5',
    submission: 'I have cat.',
    instructions: { guidance: SHIPPED_GUIDANCE, course: '' },
    effort: 'low',
    context: {
      language: 'en', level: 'A1', lessonTitle: 'Урок', grammarFocus: 'Articles',
      prompt: 'Переведите: У меня есть кошка.', referenceAnswer: 'I have a cat.',
      acceptedVariants: [], priorSubmissions: [],
    },
  }).result;

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.failure.kind, 'refused');
  assert.match(outcome.failure.reason, /ADR 0002/);
  assert.ok(performance.now() - started < 1000, 'refused before the call went out, so it cost nothing');
});
