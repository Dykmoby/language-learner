// Seam 2 — the reading half of the concurrency probe.
//
// The probe itself drives real calls through both lanes at once and lives in
// `src/ops/concurrency-probe.ts`. What is tested here is the derivation it
// reports: how long a call sat behind its lane's limit, and which calls the API
// pushed back on. Neither needs a model, and neither could be checked with one —
// a 429 arrives when the API decides, not when a test asks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneRow, pushedBack, queuedMs, type ProbeResult } from '../src/ops/concurrency-probe.ts';

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    lane: 'grading',
    label: 'grading-1',
    totalMs: 5000,
    callMs: 5000,
    ok: true,
    failure: null,
    likelyRateLimit: false,
    pushback: null,
    ...overrides,
  };
}

test('the queue is the difference between the wait and the call', () => {
  // The harness starts its own clock after the semaphore lets the call through,
  // so what is left over is exactly the time spent behind the limit.
  assert.equal(queuedMs(result({ totalMs: 12_000, callMs: 5000 })), 7000);
  assert.equal(queuedMs(result({ totalMs: 5000, callMs: 5000 })), 0, 'a call that never queued');
});

test('a negative queue is an artefact of two clocks, not a call that finished early', () => {
  assert.equal(queuedMs(result({ totalMs: 4999.4, callMs: 5000 })), 0);
});

test('a call the API pushed back on is counted even though it succeeded', () => {
  // The case a failure-only view cannot see: the SDK retries a 429 itself, so a
  // call that came back fine after two retries still met the limit.
  const results = [
    result({ label: 'grading-1' }),
    result({ label: 'grading-2', pushback: { status: 429, retries: 2, rejected: false } }),
    result({ label: 'grading-3', ok: false, failure: 'sdk: 429', likelyRateLimit: true }),
  ];

  assert.deepEqual(pushedBack(results).map((one) => one.label), ['grading-2', 'grading-3']);
});

test('a lane nothing ran in says so rather than reporting a range over nothing', () => {
  assert.equal(laneRow('authoring', [result()]), '| authoring | — | — | — | — |');
});
