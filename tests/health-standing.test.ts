// What the dashboard is actually asking.
//
// Not "did the last check pass" — "is there evidence that grading works now".
// A check that last passed a week ago answers the first question and says
// nothing about the second, and the difference between those two is the whole
// point of keeping the result rather than a boolean.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthStanding } from '../src/ops/health-history.ts';
import type { HealthCheckRow } from '../src/db/schema.ts';

const NOW = new Date('2026-08-22T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function check(overrides: Partial<HealthCheckRow> = {}): HealthCheckRow {
  return {
    id: 1,
    healthy: true,
    wallMs: 4800,
    reason: null,
    likelyCredentials: false,
    likelyEgress: false,
    likelyRateLimit: false,
    source: 'timer',
    ranAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

test('no check has ever run: that is its own state, not a failure', () => {
  const standing = healthStanding(null, NOW, DAY);
  assert.equal(standing.state, 'never');
});

test('a recent healthy check is the only thing that reads as working', () => {
  const standing = healthStanding(check(), NOW, DAY);
  assert.equal(standing.state, 'healthy');
  assert.equal(standing.ageMs, 60_000);
});

test('a recent failed check reads as failed, carrying what the check said', () => {
  const standing = healthStanding(
    check({ healthy: false, reason: 'API Error: 403 Request not allowed', likelyEgress: true }),
    NOW,
    DAY,
  );
  assert.equal(standing.state, 'unhealthy');
  assert.equal(standing.check?.reason, 'API Error: 403 Request not allowed');
  assert.equal(standing.check?.likelyEgress, true);
});

test('a healthy check older than the window is stale, not healthy', () => {
  const standing = healthStanding(check({ ranAt: new Date(NOW.getTime() - 8 * DAY) }), NOW, DAY);
  assert.equal(standing.state, 'stale');
  assert.equal(standing.ageMs, 8 * DAY);
});

test('age wins over the outcome: an old failure is stale, and still says why it failed', () => {
  // Both are red, so nothing is hidden by the precedence. What it avoids is a
  // dashboard asserting a diagnosis from a week ago as if it were current — the
  // likeliest reading of a stale failure is that the timer stopped too.
  const standing = healthStanding(
    check({ healthy: false, reason: 'no credentials', likelyCredentials: true, ranAt: new Date(NOW.getTime() - 3 * DAY) }),
    NOW,
    DAY,
  );
  assert.equal(standing.state, 'stale');
  assert.equal(standing.check?.healthy, false);
  assert.equal(standing.check?.reason, 'no credentials');
});

test('the staleness window is inclusive of its own edge', () => {
  const onTheEdge = healthStanding(check({ ranAt: new Date(NOW.getTime() - DAY) }), NOW, DAY);
  assert.equal(onTheEdge.state, 'healthy', 'exactly the window old is not yet stale');

  const justPast = healthStanding(check({ ranAt: new Date(NOW.getTime() - DAY - 1) }), NOW, DAY);
  assert.equal(justPast.state, 'stale');
});

test('a check timestamped in the future is not aged negatively', () => {
  // The Pi's clock moves when it comes back from being off, and a negative age
  // rendered as "-3 часа назад" would look like a bug in the dashboard rather
  // than a fact about the clock.
  const standing = healthStanding(check({ ranAt: new Date(NOW.getTime() + 5 * 60_000) }), NOW, DAY);
  assert.equal(standing.state, 'healthy');
  assert.equal(standing.ageMs, 0);
});
