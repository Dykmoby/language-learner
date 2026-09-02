// What actually happens when this application is busy.
//
// design.md § Open risks: *"Rate-limit behaviour under real concurrent use is
// unmeasured — every call measured so far has been sequential."* The system now
// has three ways to be busy at once — two Students in Practice against a
// `GRADER_CONCURRENCY` of 2, a Test batch holding a grading slot for up to
// `TEST_GRADING_TIMEOUT_MS`, and an Admin's Generation in the authoring lane —
// and nothing had ever driven two of them together.
//
// So this drives both lanes at once and writes down what came back: how long
// each call waited for a permit, how long it then took, and — the part that
// cannot be inferred from a stopwatch — whether the API pushed back. The SDK
// retries a 429 or a 529 itself and says so on the wire, so a call that
// succeeded after two retries is a call that met the limit and papered over it.
// `ApiPushback` is how that reaches this script.
//
// What this is not: a rate limit on demand. The API decides that, not the probe.
// A run where nothing pushed back is a real finding — it says this box cannot
// generate enough load to reach the limit, which is worth knowing — and the
// classification a rate limit would receive is pinned without a model in
// `tests/claude-harness.test.ts`.
//
// It spends real calls: one per grading slot asked for, plus one per authoring
// call. Nothing here is run by the application, by a test, or by a timer.
//
//   node src/ops/concurrency-probe.ts [--grading K] [--authoring M]

import { fileURLToPath } from 'node:url';
import { callClaude, type ApiPushback, type Lane } from '../claude/harness.ts';
import { config } from '../config.ts';
import { grade } from '../grader/grade.ts';
import { SHIPPED_GUIDANCE } from '../grader/guidance.ts';
import type { ExerciseContext } from '../grader/contract.ts';

// The health check's known input, for the same reason it uses it: one planted
// error, an answer whose grading is cheap, and a case this project has already
// measured sequentially — so a wall time here is comparable to the step-1 table.
const KNOWN_ANSWER = 'I have cat.';
const KNOWN_CONTEXT: ExerciseContext = {
  language: 'en',
  level: 'A1',
  lessonTitle: 'Present Simple и артикли',
  grammarFocus: 'Indefinite article with countable nouns',
  prompt: 'Переведите на английский: У меня есть кошка.',
  referenceAnswer: 'I have a cat.',
  acceptedVariants: ['I have got a cat.'],
  priorSubmissions: [],
};

export type ProbeResult = {
  lane: Lane;
  label: string;
  /** Wall from launch to terminal outcome: the wait a person would experience. */
  totalMs: number;
  /** The call's own duration, measured after it took its permit. */
  callMs: number;
  ok: boolean;
  failure: string | null;
  likelyRateLimit: boolean;
  pushback: ApiPushback | null;
};

/**
 * How long a call sat behind its lane's limit.
 *
 * Derived rather than instrumented: the harness starts its own clock after the
 * semaphore lets it through, so the difference between the two is exactly the
 * queue. Clamped at zero — the two clocks are started microseconds apart and a
 * negative queue is an artefact of that, not a call that finished before it
 * started.
 */
export function queuedMs(result: ProbeResult): number {
  return Math.max(0, result.totalMs - result.callMs);
}

export function laneRow(lane: Lane, results: readonly ProbeResult[]): string {
  const own = results.filter((result) => result.lane === lane);
  if (own.length === 0) return `| ${lane} | — | — | — | — |`;

  const queues = own.map(queuedMs);
  const calls = own.map((result) => result.callMs);
  const range = (values: number[]) =>
    `${Math.round(Math.min(...values))}-${Math.round(Math.max(...values))}ms`;

  return `| ${lane} | ${own.length} | ${own.filter((result) => result.ok).length}`
    + ` | ${range(queues)} | ${range(calls)} |`;
}

/** Every call the API pushed back on, whether or not it went on to succeed. */
export function pushedBack(results: readonly ProbeResult[]): ProbeResult[] {
  return results.filter((result) => result.pushback !== null || result.likelyRateLimit);
}

// --- The half that spends money ----------------------------------------------

async function gradingCall(label: string): Promise<ProbeResult> {
  const startedAt = performance.now();
  const outcome = await grade({
    // The probe measures the lane under load, not a Course. `low` is what it has
    // always run at, and the number it reports is only comparable to earlier
    // runs if that stays fixed.
    effort: 'low',
    model: 'claude-sonnet-5', context: KNOWN_CONTEXT, submission: KNOWN_ANSWER,
    // A probe measures the shipped prompt. An installation's edited guidance —
    // or one Course's own instruction — would make two runs of this incomparable.
    instructions: { guidance: SHIPPED_GUIDANCE, course: '' },
  }).result;

  return {
    lane: 'grading',
    label,
    totalMs: performance.now() - startedAt,
    callMs: outcome.wallMs,
    ok: outcome.ok,
    failure: outcome.ok ? null : `${outcome.failure.kind}: ${outcome.failure.reason}`,
    likelyRateLimit: outcome.ok ? false : outcome.failure.likelyRateLimit,
    pushback: outcome.pushback,
  };
}

async function authoringCall(label: string): Promise<ProbeResult> {
  const startedAt = performance.now();
  // Deliberately a small call in the authoring lane rather than a whole
  // Generation: what is under measurement is the lane and the pressure it puts
  // on the API at the same moment as the Grader, not how long a Lesson takes.
  const outcome = await callClaude({
    lane: 'authoring',
    model: 'claude-sonnet-5',
    systemPrompt: 'You write example sentences for a beginner English course. Reply with one sentence.',
    prompt: 'Write one A1 example sentence using the indefinite article.',
    effort: 'low',
    timeoutMs: config.authoring.timeoutMs,
    maxTurns: 1,
  }).result;

  return {
    lane: 'authoring',
    label,
    totalMs: performance.now() - startedAt,
    callMs: outcome.wallMs,
    ok: outcome.ok,
    failure: outcome.ok ? null : `${outcome.failure.kind}: ${outcome.failure.reason}`,
    likelyRateLimit: outcome.ok ? false : outcome.failure.likelyRateLimit,
    pushback: outcome.pushback,
  };
}

function intFlag(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number`);
  return value;
}

// CLI: node src/ops/concurrency-probe.ts [--grading K] [--authoring M]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gradingCalls = intFlag('grading', 6);
  const authoringCalls = intFlag('authoring', 1);

  console.log(`${gradingCalls} grading calls at a limit of ${config.grader.concurrency},`
    + ` ${authoringCalls} authoring calls at a limit of ${config.authoring.concurrency},`
    + ` all launched at once\n`);

  // Launched together, not awaited one at a time: the whole question is what
  // happens when both lanes are under load in the same moment.
  const started = performance.now();
  const results = await Promise.all([
    ...Array.from({ length: gradingCalls }, (_, i) => gradingCall(`grading-${i + 1}`)),
    ...Array.from({ length: authoringCalls }, (_, i) => authoringCall(`authoring-${i + 1}`)),
  ]);
  const elapsed = performance.now() - started;

  console.log('| lane | calls | ok | queued | call |');
  console.log('|---|---|---|---|---|');
  console.log(laneRow('grading', results));
  console.log(laneRow('authoring', results));

  console.log('\n| call | queued | call | outcome |');
  console.log('|---|---|---|---|');
  for (const result of results) {
    const outcome = result.ok
      ? (result.pushback === null ? 'ok' : `ok after ${result.pushback.retries} retry`)
      : `${result.failure}${result.likelyRateLimit ? ' [rate limit]' : ''}`;
    console.log(`| ${result.label} | ${Math.round(queuedMs(result))}ms`
      + ` | ${Math.round(result.callMs)}ms | ${outcome} |`);
  }

  const busy = pushedBack(results);
  console.log(`\nWall for the whole burst: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(busy.length === 0
    ? 'The API pushed back on nothing: no 429, no 529, no subscription rejection.'
    : `The API pushed back on ${busy.length} of ${results.length} calls.`);
}
