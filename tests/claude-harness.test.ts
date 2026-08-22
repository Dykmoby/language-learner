// The shared SDK harness: the four context-stripping settings, the two lanes,
// and the promise that a caller never receives an exception where it expected an
// outcome.
//
// Most of this needs no model, which is the point. Every one of the four
// settings is required and not one of them announces itself when it is missing —
// a call that omits `settingSources` still works, still returns an answer, and
// is quietly 2-3× slower on 8-11k tokens of context nobody asked for. A property
// that fails silently in production has to be asserted somewhere it fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  callClaude, queryOptions, harnessEnv, laneLoad,
  type ClaudeRequest,
} from '../src/claude/harness.ts';
import { EFFORTS } from '../src/claude/effort.ts';
import { config } from '../src/config.ts';

const REQUEST: ClaudeRequest = {
  lane: 'authoring',
  model: 'claude-sonnet-5',
  systemPrompt: 'You write lessons.',
  prompt: 'Write one.',
  timeoutMs: 1000,
};

// --- The four settings -------------------------------------------------------

test('every call goes out with all four context-stripping settings', () => {
  // design.md § Configuration measured all four as required to strip Claude
  // Code's own ~8-11k-token harness prompt. Asserted together, because three of
  // four is a call that still works and is quietly expensive.
  const options = queryOptions(REQUEST);

  assert.equal(typeof options.systemPrompt, 'string', '(1) a plain string replaces the harness prompt');
  assert.deepEqual(options.skills, [], '(2) otherwise project and user skills re-inflate the context');
  assert.deepEqual(options.settingSources, [], '(3) the default loads CLAUDE.md, ~/.claude and hooks');
  assert.equal(options.strictMcpConfig, true, '(4) claude.ai connectors load under subscription auth otherwise');
});

test('the fourth setting that is not an option travels in the environment', () => {
  // CLAUDE_CODE_DISABLE_AUTO_MEMORY is the one that cannot be expressed as an
  // option: auto-memory ignores settingSources entirely.
  const options = queryOptions(REQUEST);
  const env = options.env as Record<string, string>;

  assert.equal(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(harnessEnv(1234).CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(harnessEnv(1234).API_TIMEOUT_MS, '1234', 'the timeout reaches the SDK as well as the abort');
});

test('tools are switched off by availability, not by permission', () => {
  // allowedTools/disallowedTools govern permission and would NOT do this.
  assert.deepEqual(queryOptions(REQUEST).tools, []);
});

test('thinking is adaptive rather than disabled', () => {
  // Disabling it is no faster, and it is rejected outright at xhigh/max on
  // Opus 5 — which is precisely what would corrupt a strict document contract.
  assert.deepEqual(queryOptions(REQUEST).thinking, { type: 'adaptive' });
});

// --- Effort ------------------------------------------------------------------

test('Effort is a per-call parameter, and «По умолчанию» omits it entirely', () => {
  for (const effort of EFFORTS) {
    assert.equal(queryOptions({ ...REQUEST, effort }).effort, effort);
  }

  // Not defaulted to anything. The absence of the parameter is a choice an Admin
  // can make, and a harness that filled it in would make that choice unreachable.
  assert.ok(
    !('effort' in queryOptions(REQUEST)),
    'the sixth entry is the absence of the parameter, not a sixth value',
  );
});

test('grading always asks for low Effort and never for the Admin\'s choice', () => {
  // A Verdict is not a place to spend minutes of reasoning. The Grader builds its
  // own request, so this is asserted where the request is built rather than here —
  // what this checks is that the harness would carry a different one if asked.
  assert.equal(queryOptions({ ...REQUEST, lane: 'grading', effort: 'low' }).effort, 'low');
});

// --- Resuming a conversation -------------------------------------------------

test('a resumed session is always forked, never continued in place', () => {
  // #36 restores an earlier Draft and carries on from that point. A session
  // continued in place would make that branch overwrite the trunk, which is the
  // one thing an append-only history must never allow.
  const options = queryOptions({ ...REQUEST, resume: 'session-abc' });
  assert.equal(options.resume, 'session-abc');
  assert.equal(options.forkSession, true);
});

test('a call with no session to resume names neither', () => {
  const options = queryOptions(REQUEST);
  assert.ok(!('resume' in options));
  assert.ok(!('forkSession' in options));
});

// --- Two lanes ---------------------------------------------------------------

test('an authoring call can never occupy a grading slot', async () => {
  // design.md § Grading sizes the grading limit for calls the spike measured at
  // 4-7s. A Generation at max Effort on Opus 5 is minutes of work, and a Student
  // waiting behind one has no way of knowing that is what they are waiting for.
  //
  // The lanes are read synchronously, before anything awaits: the semaphore takes
  // its permit on the way in, so a saturated authoring lane is observable without
  // a model ever being reached.
  assert.deepEqual(laneLoad('grading'), { inFlight: 0, queued: 0 }, 'nothing is grading yet');

  const saturating = Array.from(
    { length: config.authoring.concurrency + 1 },
    () => callClaude({ ...REQUEST, timeoutMs: 1 }),
  );

  assert.equal(laneLoad('authoring').inFlight, config.authoring.concurrency, 'the authoring lane is full');
  assert.equal(laneLoad('authoring').queued, 1, 'and the extra call is queued behind it');
  assert.deepEqual(
    laneLoad('grading'), { inFlight: 0, queued: 0 },
    'a full authoring lane leaves every grading slot free',
  );

  for (const call of saturating) call.abort();
  const outcomes = await Promise.all(saturating.map((call) => call.result));

  for (const outcome of outcomes) {
    assert.equal(outcome.ok, false, 'an abandoned call is a failure, never content');
  }
  assert.deepEqual(laneLoad('authoring'), { inFlight: 0, queued: 0 }, 'every permit came back');
});

test('the authoring lane is configurable from the environment', () => {
  // Configurable, so the limit is an operational decision rather than a rebuild.
  assert.ok(Number.isInteger(config.authoring.concurrency) && config.authoring.concurrency >= 1);
  assert.ok(
    config.authoring.timeoutMs > config.grader.timeoutMs,
    'a whole Lesson is a different order of wait from a Verdict, and sharing 90s would time out the calls this exists for',
  );
});

// --- The two-armed contract --------------------------------------------------

test('abandoning a call resolves to a failure rather than throwing', async () => {
  // A caller must not be able to receive an exception where it expected an
  // outcome: that is exactly how a failure gets rendered as content.
  const call = callClaude({ ...REQUEST, timeoutMs: 60_000 });
  call.abort();

  const outcome = await call.result;
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.failure.kind, 'aborted', 'told apart from a timeout: nobody wants this call any more');
  // Neither is evidence about credentials or the network, and guessing would
  // point an Admin at the wrong thing.
  assert.equal(outcome.failure.likelyCredentials, false);
  assert.equal(outcome.failure.likelyEgress, false);
});

test('the delta stream terminates even when nobody reads it until the end', async () => {
  const call = callClaude({ ...REQUEST, timeoutMs: 60_000 });
  call.abort();
  await call.result;

  const deltas: string[] = [];
  for await (const delta of call.deltas) deltas.push(delta);
  assert.deepEqual(deltas, [], 'a late subscriber gets what was buffered and then an end');
});
