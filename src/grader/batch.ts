// The SDK half of Test grading: one call carrying every free-form answer of an
// attempt.
//
// Everything about the response contract lives next door in batch-contract.ts and
// stays pure; everything about making an SDK call lives in the shared harness.
// What is left here is what is actually about grading a Test: the model rule ADR
// 0002 enforces, the lane and the clock the call runs under, and a two-armed
// outcome a caller cannot render as content.
//
// Nothing streams. The Practice streams because a Student is sitting in front of
// one Verdict; a Test's Student is looking at a review of many answers, and half
// an explanation for one of ten is not information.

import {
  buildBatchSystemPrompt, buildBatchUserPrompt, judgeBatch, parseBatchOutput,
  type BatchContext, type JudgedExercise,
} from './batch-contract.ts';
import { graderModelRefusal } from './contract.ts';
import type { GradingFailure } from './grade.ts';
import { callClaude, EMPTY_USAGE, type CallOutcome, type ClaudeUsage } from '../claude/harness.ts';
import { effortTimeoutMs, type Effort } from '../claude/effort.ts';
import { config } from '../config.ts';

export type BatchRequest = {
  /** Per-Course, per ADR 0002. Never a Haiku model — see the ADR. */
  model: string;
  context: BatchContext;
  /** The editable grading guidance — issue #79, ADR 0006. */
  guidance: string;
  /** The Course's Effort — issue #76. `null` is «По умолчанию». */
  effort: Effort | null;
};

// The same two arms the single-Submission path has, and for the same reason:
// there is no third state and no exception path, so a caller cannot render a
// failure as a set of wrong answers.
export type BatchGradingOutcome =
  | { ok: true; judged: JudgedExercise[]; wasFenced: boolean; usage: ClaudeUsage; wallMs: number }
  | { ok: false; failure: GradingFailure; usage: ClaudeUsage; wallMs: number };

function refused(reason: string): BatchGradingOutcome {
  return {
    ok: false, wallMs: 0, usage: EMPTY_USAGE,
    failure: {
      kind: 'refused', reason, raw: null,
      likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
    },
  };
}

/**
 * Judges every free-form answer of one attempt, in one call.
 *
 * Resolves; never rejects. A caller that has already lost its client must not be
 * handed a rejection nobody is there to catch — and the answers are in the
 * database either way.
 */
export async function gradeBatch(request: BatchRequest): Promise<BatchGradingOutcome> {
  const refusal = graderModelRefusal(request.model);
  // Refused before the call goes out, so a forbidden model costs nothing and,
  // more to the point, never reaches a Student.
  if (refusal !== null) return refused(refusal);
  if (request.context.exercises.length === 0) return refused('nothing to grade');

  const call = callClaude({
    lane: 'grading',
    model: request.model,
    systemPrompt: buildBatchSystemPrompt(request.context.language, request.guidance),
    prompt: buildBatchUserPrompt(request.context),
    // The Course's, exactly as a Practice Submission in the same Course — a Test
    // judged by less reasoning than the Practice that prepared for it would be a
    // mirror of something else (issue #76).
    ...(request.effort === null ? {} : { effort: request.effort }),
    // Its own base, and the same ladder. A batch is many answers in one call and
    // its clock was already longer than the Grader's before Effort was a choice;
    // what the Effort changes is the multiple, not the base.
    timeoutMs: effortTimeoutMs(config.testGrading.timeoutMs, request.effort),
    maxTurns: 1, // single-shot, ADR 0004
  });

  return judge(await call.result, request);
}

function judge(outcome: CallOutcome, request: BatchRequest): BatchGradingOutcome {
  const { wallMs, usage } = outcome;
  if (!outcome.ok) {
    // 'aborted' becomes 'sdk' rather than gaining an arm of its own: a Test's
    // grading is never abandoned — it persists whether or not the Student is
    // still on the page — so an abort here is unexpected, not a Student leaving.
    const kind = outcome.failure.kind === 'aborted' ? 'sdk' : outcome.failure.kind;
    return { ok: false, wallMs, usage, failure: { ...outcome.failure, kind } };
  }

  const expected = request.context.exercises.map((exercise) => exercise.exerciseId);
  const parsed = parseBatchOutput(outcome.text, expected);
  if (!parsed.ok) {
    return {
      ok: false, wallMs, usage,
      // A contract failure means the call reached the model and came back. It
      // says nothing about credentials, the network, or how busy the API is.
      failure: {
        kind: 'contract', reason: parsed.reason, raw: parsed.raw,
        likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
      },
    };
  }

  if (parsed.wasFenced) {
    // A routine model habit, not worth failing an attempt over — but logged, so
    // a change in how often it happens is visible rather than invisible.
    console.warn(`[grader] ${request.model} wrapped its batch JSON in markdown fences`);
  }

  return {
    ok: true,
    wallMs,
    usage,
    wasFenced: parsed.wasFenced,
    judged: judgeBatch(parsed.judgements, request.context),
  };
}
