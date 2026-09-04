// The call that writes an Explanation, and the two-armed outcome it ends in.
//
// It borrows almost everything from the Grader: the same harness, the same lane
// — a Student is waiting on both, and an Explanation that queued behind an
// Admin's Generation would arrive minutes late — and the Course's own model and
// Effort, so a Course that reasons harder about a Verdict reasons harder here
// too (ADR 0002, ADR 0007).
//
// What it does not borrow is the response contract. The Grader answers in JSON
// because a Verdict, a correction and a list of Errors are structure; an
// Explanation is prose, and asking for prose inside a JSON field would buy a
// parse failure on roughly one call in twenty-four for nothing. So the text is
// the answer, and it streams as it is written.

import { buildSystemPrompt, buildUserPrompt, type ExplanationContext } from './contract.ts';
import {
  callClaude, EMPTY_USAGE, type CallFailure, type CallOutcome, type ClaudeUsage,
} from '../claude/harness.ts';
import { effortTimeoutMs, type Effort } from '../claude/effort.ts';
import { graderModelRefusal } from '../grader/contract.ts';
import { config } from '../config.ts';

export type ExplainRequest = {
  /** The Course's, per ADR 0002 — the same model that judged the answer. */
  model: string;
  /** The Course's, per ADR 0007. `null` is «По умолчанию»: no parameter at all. */
  effort: Effort | null;
  context: ExplanationContext;
};

export type ExplanationOutcome =
  | { ok: true; text: string; usage: ClaudeUsage; wallMs: number }
  | { ok: false; failure: CallFailure; usage: ClaudeUsage; wallMs: number };

export type ExplanationHandle = {
  /** The explanation as it is written. Buffered, so a late reader misses none. */
  deltas: AsyncIterable<string>;
  /** Resolves; never rejects. */
  result: Promise<ExplanationOutcome>;
};

/**
 * Whether an Explanation could be written at all.
 *
 * Refused before the call goes out where the Course's model is one the domain
 * forbids — the same rule and the same reason as grading (ADR 0002), because it
 * is the same model on the same call. A Course that cannot be graded cannot be
 * explained either, and finding that out after a Student has waited is worse
 * than finding it out now.
 */
export function explain(request: ExplainRequest): ExplanationHandle {
  const refusal = graderModelRefusal(request.model);
  if (refusal !== null) {
    return {
      deltas: (async function* () {})(),
      result: Promise.resolve({
        ok: false, wallMs: 0, usage: EMPTY_USAGE,
        failure: {
          kind: 'sdk', reason: refusal, raw: null,
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
        },
      }),
    };
  }

  const call = callClaude({
    lane: 'grading',
    model: request.model,
    systemPrompt: buildSystemPrompt(request.context),
    prompt: buildUserPrompt(request.context),
    ...(request.effort === null ? {} : { effort: request.effort }),
    // The Grader's clock, moved by the Course's Effort exactly as the Grader's
    // is: the two calls are the same size and the same wait.
    timeoutMs: effortTimeoutMs(config.grader.timeoutMs, request.effort),
    maxTurns: 1,
  });

  return { deltas: call.deltas, result: call.result.then(settle) };
}

function settle(outcome: CallOutcome): ExplanationOutcome {
  const { wallMs, usage } = outcome;
  if (!outcome.ok) return { ok: false, failure: outcome.failure, usage, wallMs };
  return { ok: true, text: outcome.text, usage, wallMs };
}
