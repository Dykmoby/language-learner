// The SDK half of the Grader module. Everything about the response contract
// lives next door in contract.ts and stays pure; everything about *making* an
// SDK call lives in the shared harness, which the Generation and Refinement
// callers use too.
//
// What is left here is the part that is actually about grading: the model rule
// ADR 0002 enforces, the Grader's prompt, the parse, the Coherence Guard, and
// the two-armed outcome a caller cannot render as content.
//
// The public surface is one entry point taking the Exercise context plus the
// Student's Submission, and exposing both a stream of text deltas and a terminal
// result. design.md § Grading makes streaming mandatory, and retrofitting it into
// a promise-shaped API later is a rewrite.

import {
  buildSystemPrompt, buildUserPrompt, buildStudentBlock,
  parseGraderOutput, validateErrorTypes, coherenceGuard, graderModelRefusal,
  type ExerciseContext, type GraderResponse, type GuardOutcome, type Verdict,
} from './contract.ts';
import {
  callClaude, EMPTY_USAGE,
  type ApiPushback, type CallFailure, type CallOutcome, type ClaudeUsage,
} from '../claude/harness.ts';
import { config } from '../config.ts';

export type GradeRequest = {
  /** Per-Course, per ADR 0002. Never a Haiku model — see the ADR. */
  model: string;
  context: ExerciseContext;
  submission: string;
};

/** The harness's accounting, under the name the Grader's callers already use. */
export type GraderUsage = ClaudeUsage;

// 'refused' is a call that never went out: the configuration asked for something
// the domain forbids, such as grading with Haiku (ADR 0002).
export type GradingFailureKind = 'timeout' | 'contract' | 'sdk' | 'refused';

export type GradingFailure = {
  kind: GradingFailureKind;
  reason: string;
  /**
   * A heuristic, and it must be read as one. ADR 0001 records that a credentials
   * failure does not present as an auth error, so this can only ever be a guess.
   */
  likelyCredentials: boolean;
  /**
   * Also a heuristic. Measured on 2026-08-20: with credentials perfectly readable
   * but no outbound proxy, every call fails with "Failed to authenticate. API
   * Error: 403 Request not allowed" — which points at exactly the wrong thing.
   */
  likelyEgress: boolean;
  /**
   * The API said "not now" rather than "no" — a 429, a 529, or the subscription's
   * own window. It excludes the other two: a call the API pushed back on got as
   * far as the API, so neither the credentials nor the egress path is what went
   * wrong. See the harness, where it is read off the call rather than guessed.
   */
  likelyRateLimit: boolean;
  raw: string | null;
};

// A discriminated union with exactly two arms. There is no third state and no
// exception path, so a caller cannot render a failure as a wrong answer.
export type GradingOutcome =
  | {
      ok: true;
      response: GraderResponse;
      /** What the Grader proposed, kept apart from the guarded value (ADR 0003). */
      proposedVerdict: Verdict;
      guarded: GuardOutcome;
      wasFenced: boolean;
      unknownErrorTypes: string[];
      usage: GraderUsage;
      wallMs: number;
      /** What the API said about load, if anything. Null on a call it never met. */
      pushback: ApiPushback | null;
    }
  | {
      ok: false; failure: GradingFailure; usage: GraderUsage; wallMs: number;
      pushback: ApiPushback | null;
    };

export type GradingHandle = {
  /** Text deltas, buffered from the start so a late subscriber misses nothing. */
  deltas: AsyncIterable<string>;
  /** Resolves; never rejects. */
  result: Promise<GradingOutcome>;
};

/**
 * The harness's failure under the Grader's names.
 *
 * 'aborted' becomes 'sdk' rather than gaining an arm of its own: grading never
 * abandons a call — a Submission is persisted whether or not the Student is
 * still listening — so an abort here is something unexpected, not a Student
 * navigating away.
 */
function asGradingFailure(failure: CallFailure): GradingFailure {
  return { ...failure, kind: failure.kind === 'aborted' ? 'sdk' : failure.kind };
}

export function grade(request: GradeRequest): GradingHandle {
  const refusal = graderModelRefusal(request.model);
  if (refusal !== null) {
    // Refused before the call goes out, so a forbidden model costs nothing and,
    // more to the point, never reaches a Student. The stream is present and
    // empty, so the shape a caller consumes does not depend on why it failed.
    return {
      deltas: (async function* () {})(),
      result: Promise.resolve({
        ok: false, wallMs: 0, usage: EMPTY_USAGE, pushback: null,
        failure: {
          kind: 'refused', reason: refusal, raw: null,
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
        },
      }),
    };
  }

  const call = callClaude({
    lane: 'grading',
    model: request.model,
    systemPrompt: buildSystemPrompt(request.context.language),
    prompt: [buildUserPrompt(request.context), '', buildStudentBlock(request.submission)].join('\n'),
    // design.md § Grading: adaptive thinking at low Effort. Not the Admin's
    // choice — a Verdict is not a place to spend minutes of reasoning, and the
    // spike measured this as matching or beating every alternative.
    effort: 'low',
    timeoutMs: config.grader.timeoutMs,
    maxTurns: 1, // grading is single-shot (ADR 0004)
  });

  return { deltas: call.deltas, result: call.result.then((outcome) => judge(outcome, request)) };
}

function judge(outcome: CallOutcome, request: GradeRequest): GradingOutcome {
  const { wallMs, usage, pushback } = outcome;
  if (!outcome.ok) {
    return { ok: false, wallMs, usage, pushback, failure: asGradingFailure(outcome.failure) };
  }

  const parsed = parseGraderOutput(outcome.text);
  if (!parsed.ok) {
    // Measured at roughly 1 call in 24. This path is load-bearing, not defensive.
    return {
      ok: false, wallMs, usage, pushback,
      // A contract failure means the call reached the model and came back. It
      // says nothing about credentials, the network, or how busy the API is.
      failure: {
        kind: 'contract', reason: parsed.reason, raw: parsed.raw,
        likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
      },
    };
  }

  if (parsed.wasFenced) {
    // design.md § Response contract: a routine model habit, not worth failing a
    // Submission over — but logged when it happens, so a change in how often it
    // happens is visible rather than invisible.
    console.warn(`[grader] ${request.model} wrapped its JSON in markdown fences`);
  }

  return {
    ok: true,
    wallMs,
    usage,
    pushback,
    response: parsed.value,
    proposedVerdict: parsed.value.verdict,
    guarded: coherenceGuard(parsed.value.verdict, parsed.value.errors),
    wasFenced: parsed.wasFenced,
    unknownErrorTypes: validateErrorTypes(parsed.value.errors, request.context.language),
  };
}
