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
  callClaude, diagnose, errorResultReason, harnessEnv, isPushbackStatus, laneLoad,
  looksRateLimited, queryOptions,
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

// --- The third heuristic -----------------------------------------------------
//
// A rate limit is not a credentials failure, and until now it was reported as
// one. `src/grader/grade.ts` knew two ways a call could fail for reasons outside
// itself, and a 429 under load landed as a generic SDK failure whose most
// specific guess — credentials, on a box whose HOME the check could not read —
// was the wrong one. That is the trap the egress heuristic was added to avoid,
// met at the other end.
//
// No live model is involved in any of this, and none could be: the failures
// below are exactly the ones an API will not produce on request.

test('a 429 is read as the API being busy, not as anything wrong with this box', () => {
  const hints = diagnose('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}', null);

  assert.equal(hints.likelyRateLimit, true);
  assert.equal(hints.likelyCredentials, false, 'the call reached the API, so the credentials were read');
  assert.equal(hints.likelyEgress, false, 'and it left the box, so the proxy is not the story either');
});

test('the shapes a busy API actually arrives in are all recognised', () => {
  // Representative rather than exhaustive, and named one at a time so a shape
  // that stops being matched fails with the shape in the message.
  const busy = [
    'API Error: 429 rate_limit_error',
    'API Error: 529 {"type":"overloaded_error"}',
    'Claude AI usage limit reached|1756042800',
    'Too Many Requests',
    'the model is overloaded',
    // Observed on 2026-08-24 from this Pi, and the reason this list is not just
    // the API's own vocabulary: ADR 0001's credentials are a subscription, and
    // the limit that stopped a call first was the plan's, with no status code
    // anywhere in it.
    "Claude Code returned an error result: You've hit your session limit · resets 11:10pm (Asia/Novosibirsk)",
  ];

  for (const reason of busy) {
    assert.equal(looksRateLimited(reason), true, reason);
  }
});

test('the failures that are about this box are not mistaken for a busy API', () => {
  // The other direction, and the one that matters more: a heuristic that fired
  // on everything would replace a wrong diagnosis with a different wrong one.
  const notBusy = [
    'API Error: 403 Request not allowed',
    'Failed to authenticate',
    'the call was aborted after 90000ms',
    'the model produced no text',
    'feedback_ru missing or not a string',
  ];

  for (const reason of notBusy) {
    assert.equal(looksRateLimited(reason), false, reason);
  }
});

test('a rate limit on a box that cannot read its credentials still does not blame them', () => {
  // The case that makes the exclusion load-bearing rather than tidy. Both
  // conditions are true at once — the API is pushing back, and ~/.claude is
  // unreadable — and only one of them explains a 429, because a call that got a
  // 429 got as far as the API.
  const home = process.env.HOME;
  process.env.HOME = '/nonexistent-home-for-this-test';
  try {
    assert.deepEqual(
      diagnose('API Error: 429 rate_limit_error', null),
      { likelyCredentials: false, likelyEgress: false, likelyRateLimit: true },
    );

    // And without the rate limit, the same box is diagnosed the way it was before.
    assert.deepEqual(
      diagnose('some other failure', null),
      { likelyCredentials: true, likelyEgress: false, likelyRateLimit: false },
    );
  } finally {
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
  }
});

test('the API saying so outright beats reading the error text', () => {
  // What the SDK reports on the wire — an `api_retry` carrying a 429, or a
  // `rate_limit_event` the subscription rejected — is evidence rather than
  // inference, and it stands even where the text that came back says nothing.
  const hints = diagnose('the call was aborted after 90000ms', { status: 429, retries: 2, rejected: false });

  assert.equal(hints.likelyRateLimit, true, 'a call spent waiting out a 429 is the busy case in a timeout’s clothes');
  assert.equal(hints.likelyCredentials, false);
  assert.equal(hints.likelyEgress, false);
});

test('only 429 and 529 count as the API pushing back', () => {
  // The SDK retries 500s and 502s as well, and neither is the API saying "not
  // now". A proxy answering 502 is precisely the egress failure ADR 0001 warns
  // about, and counting it here would suppress the guess that is right — the
  // wrong turn this whole heuristic exists to stop, arriving through the door it
  // came in by.
  assert.equal(isPushbackStatus(429), true);
  assert.equal(isPushbackStatus(529), true);

  for (const status of [500, 502, 503, 400, 403, null, undefined]) {
    assert.equal(isPushbackStatus(status), false, String(status));
  }
});

test('an auth-shaped failure is not reclassified by a retry earlier in the same call', () => {
  // A 429 the SDK retried past can sit in the history of a call that got through
  // and then failed for a reason of its own. 403 and 401 are never rate limits,
  // and letting a stale retry outrank them would hide the egress failure ADR
  // 0001 records as the one that presents as something else.
  const afterRetry = { status: 429, retries: 1, rejected: false };
  const hints = diagnose('API Error: 403 Request not allowed', afterRetry);

  assert.equal(hints.likelyRateLimit, false, 'the 403 is what ended this call');
  assert.equal(hints.likelyEgress, true, 'and it points at the proxy, as it did before');
});

test('a subscription rejection outranks even an auth-shaped failure', () => {
  // Nothing proceeded past it, so whatever the text says came after the plan had
  // already refused.
  const rejected = { status: null, retries: 0, rejected: true };
  assert.equal(diagnose('API Error: 403 Request not allowed', rejected).likelyRateLimit, true);
});

test('an error result carries its sentence into the reason, not only into the raw text', () => {
  // `error_during_execution` covers a rate limit and a crash alike. The sentence
  // that tells them apart is the one the heuristics read, so it has to be in the
  // reason — this is how the measured session limit reaches `looksRateLimited`
  // when it arrives as a result message rather than as a thrown error.
  const reason = errorResultReason('error_during_execution', "You've hit your session limit · resets 11:10pm");

  assert.match(reason, /error_during_execution/, 'the subtype is still there');
  assert.equal(looksRateLimited(reason), true, 'and the sentence is now readable');

  // A result with nothing to add says only what it knows.
  assert.equal(errorResultReason('error_max_turns', ''), 'result subtype=error_max_turns');
  assert.equal(errorResultReason('error_max_turns', undefined), 'result subtype=error_max_turns');
});
