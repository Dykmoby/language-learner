// The SDK half of the Grader module. It owns the query() call, the timeout and
// the concurrency limit; everything about the response contract lives next door
// in contract.ts and stays pure.
//
// The public surface is one entry point taking the Exercise context plus the
// Student's Submission, and exposing both a stream of text deltas and a terminal
// result. Step 2 consumes only the terminal result — the stream exists because
// design.md § Grading makes streaming mandatory for step 3, and retrofitting it
// into a promise-shaped API later is a rewrite.

import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import {
  buildSystemPrompt, buildUserPrompt, buildStudentBlock,
  parseGraderOutput, validateErrorTypes, coherenceGuard,
  type ExerciseContext, type GraderResponse, type GuardOutcome, type Verdict,
} from './contract.ts';
import { Semaphore } from './semaphore.ts';
import { config } from '../config.ts';

export type GradeRequest = {
  /** Per-Course, per ADR 0002. Never a Haiku model — see the ADR. */
  model: string;
  context: ExerciseContext;
  submission: string;
};

export type GraderUsage = {
  inputTokens: number | null;
  cacheReadInputTokens: number | null;
  outputTokens: number | null;
  /** True context size is inputTokens + cacheReadInputTokens. */
  contextTokens: number | null;
  costUsd: number | null;
  /** The SDK invokes an auxiliary Haiku model on every query (ADR 0002). */
  modelsInvoked: string[];
};

export type GradingFailureKind = 'timeout' | 'contract' | 'sdk';

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
    }
  | { ok: false; failure: GradingFailure; usage: GraderUsage; wallMs: number };

export type GradingHandle = {
  /** Text deltas, buffered from the start so a late subscriber misses nothing. */
  deltas: AsyncIterable<string>;
  /** Resolves; never rejects. */
  result: Promise<GradingOutcome>;
};

const EMPTY_USAGE: GraderUsage = {
  inputTokens: null, cacheReadInputTokens: null, outputTokens: null,
  contextTokens: null, costUsd: null, modelsInvoked: [],
};

// One semaphore for the process, at the configured limit (design.md § Grading).
const gradingSlots = new Semaphore(config.grader.concurrency);

// Buffers every delta and wakes any number of subscribers. Buffering is what
// lets grading run to completion regardless of whether anyone is listening: the
// pump is driven by the SDK loop, never by a consumer pulling.
class DeltaStream {
  #chunks: string[] = [];
  #closed = false;
  #wakers = new Set<() => void>();

  push(chunk: string): void {
    this.#chunks.push(chunk);
    this.#wakeAll();
  }

  close(): void {
    this.#closed = true;
    this.#wakeAll();
  }

  #wakeAll(): void {
    for (const wake of this.#wakers) wake();
    this.#wakers.clear();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    let index = 0;
    for (;;) {
      while (index < this.#chunks.length) yield this.#chunks[index++]!;
      if (this.#closed) return;
      await new Promise<void>((resolve) => this.#wakers.add(resolve));
    }
  }
}

// ADR 0001: the SDK reads credentials from ~/.claude at call time, and the
// failure when it cannot does not present as an auth error. Checking whether the
// directory is readable is a better signal than matching on error text — but it
// is still only a signal, which is why the caller phrases it as a likelihood.
// An auth-shaped error while the credentials are perfectly readable is far more
// likely to be egress than credentials — that is the failure this step actually hit.
function looksAuthShaped(reason: string): boolean {
  return /\b(403|401|authenticate|authentication|unauthorized|forbidden)\b/i.test(reason);
}

function diagnose(reason: string): { likelyCredentials: boolean; likelyEgress: boolean } {
  const unreachable = credentialsLookUnreachable();
  return {
    likelyCredentials: unreachable,
    likelyEgress: !unreachable && looksAuthShaped(reason),
  };
}

function credentialsLookUnreachable(): boolean {
  const home = process.env.HOME;
  if (!home) return true;
  try {
    accessSync(join(home, '.claude'), constants.R_OK);
    return false;
  } catch {
    return true;
  }
}

type SdkMessage = Record<string, unknown>;

function textDeltaOf(message: SdkMessage): string | null {
  // The partial-message wrapper is version-dependent; the spike found both shapes.
  const raw = (message.type === 'stream_event' ? message.event
    : message.type === 'partial' ? message.raw_event
    : null) as Record<string, any> | null;
  if (!raw || raw.type !== 'content_block_delta') return null;
  const delta = raw.delta;
  return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : null;
}

function usageFrom(result: Record<string, any>, model: string): GraderUsage {
  // result.usage aggregates ACROSS models — the SDK makes an auxiliary Haiku call
  // on every query — so it under-reports the grading model. modelUsage is per-model.
  const perModel = result.modelUsage ?? {};
  const own = perModel[model];
  const inputTokens = own?.inputTokens ?? null;
  const cacheReadInputTokens = own?.cacheReadInputTokens ?? null;
  return {
    inputTokens,
    cacheReadInputTokens,
    outputTokens: own?.outputTokens ?? null,
    contextTokens: inputTokens === null ? null : inputTokens + (cacheReadInputTokens ?? 0),
    costUsd: result.total_cost_usd ?? null,
    modelsInvoked: Object.keys(perModel),
  };
}

export function grade(request: GradeRequest): GradingHandle {
  const deltas = new DeltaStream();

  // Started eagerly and never awaited by the caller before it runs: grading must
  // run to completion and persist server-side whether or not the client is still
  // listening. Even at 4-7s a closed tab must never lose a Submission.
  const result = gradingSlots
    .run(() => runQuery(request, deltas))
    .catch((error: unknown): GradingOutcome => ({
      // Belt and braces: the contract promises no exception path, so even an
      // unexpected throw becomes a failure the caller can render safely.
      ok: false,
      wallMs: 0,
      usage: EMPTY_USAGE,
      failure: {
        kind: 'sdk',
        ...diagnose(error instanceof Error ? error.message : String(error)),
        reason: error instanceof Error ? error.message : String(error),
        raw: null,
      },
    }))
    .finally(() => deltas.close());

  return { deltas, result };
}

async function runQuery(request: GradeRequest, deltas: DeltaStream): Promise<GradingOutcome> {
  const { model, context, submission } = request;
  const timeoutMs = config.grader.timeoutMs;

  const prompt = [buildUserPrompt(context), '', buildStudentBlock(submission)].join('\n');

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const startedAt = performance.now();

  let text = '';
  let usage = EMPTY_USAGE;
  let sdkError: string | null = null;

  try {
    // Imported lazily: the SDK spawns a subprocess and reads ~/.claude, and no
    // page should pay for loading it until something actually grades.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    for await (const message of query({
      prompt,
      options: {
        model,
        // A plain string REPLACES Claude Code's harness prompt rather than adding
        // to it. Worth 2-3x the wall time on its own — but only together with the
        // three settings below, all four of which the spike measured as required.
        systemPrompt: buildSystemPrompt(context.language),
        tools: [],              // availability. allowedTools/disallowedTools govern
                                // permission and would NOT do this.
        skills: [],             // otherwise project and user skills re-inflate context
        settingSources: [],     // default is user+project+local: CLAUDE.md, ~/.claude, hooks
        strictMcpConfig: true,  // claude.ai connectors load under subscription auth otherwise
        maxTurns: 1,            // grading is single-shot (ADR 0004)
        includePartialMessages: true,
        // Not 'disabled'. The spike measured adaptive+low as matching or beating
        // it on every pair, and disabling thinking carries the tag-leakage risk
        // that would corrupt a strict JSON contract.
        thinking: { type: 'adaptive' },
        effort: 'low',
        abortController: abort,
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // auto-memory ignores settingSources
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          API_TIMEOUT_MS: String(timeoutMs),
          CLAUDE_CODE_MAX_RETRIES: '1',
          // DISABLE_NON_ESSENTIAL_MODEL_CALLS is deliberately not set: the spike
          // measured that it does not suppress the auxiliary Haiku call (ADR 0002).
        },
      },
    } as never) as AsyncIterable<SdkMessage>) {
      const delta = textDeltaOf(message);
      if (delta) deltas.push(delta);

      if (message.type === 'assistant') {
        const content = (message.message as Record<string, any> | undefined)?.content ?? [];
        for (const block of content) if (block?.type === 'text') text += block.text;
      }

      if (message.type === 'result') {
        const asResult = message as Record<string, any>;
        usage = usageFrom(asResult, model);
        if (asResult.is_error) sdkError = `result subtype=${asResult.subtype}`;
        if (!text && typeof asResult.result === 'string') text = asResult.result;
      }
    }
  } catch (error) {
    const wallMs = performance.now() - startedAt;
    clearTimeout(timer);
    const timedOut = abort.signal.aborted;
    return {
      ok: false,
      wallMs,
      usage,
      failure: (() => {
        const reason = timedOut
          ? `grading aborted after ${timeoutMs}ms`
          : error instanceof Error ? error.message : String(error);
        // A timeout is a timeout — it is not evidence about credentials or egress.
        const hints = timedOut ? { likelyCredentials: false, likelyEgress: false } : diagnose(reason);
        return { kind: timedOut ? 'timeout' as const : 'sdk' as const, reason, ...hints, raw: text || null };
      })(),
    };
  } finally {
    clearTimeout(timer);
  }

  const wallMs = performance.now() - startedAt;

  if (sdkError || !text) {
    return {
      ok: false, wallMs, usage,
      failure: (() => {
        const reason = sdkError ?? 'the Grader produced no text';
        return { kind: 'sdk' as const, reason, ...diagnose(reason), raw: text || null };
      })(),
    };
  }

  const parsed = parseGraderOutput(text);
  if (!parsed.ok) {
    // Measured at roughly 1 call in 24. This path is load-bearing, not defensive.
    return {
      ok: false, wallMs, usage,
      // A contract failure means the call reached the model and came back. It
      // says nothing about credentials or the network.
      failure: { kind: 'contract', reason: parsed.reason, likelyCredentials: false, likelyEgress: false, raw: parsed.raw },
    };
  }

  return {
    ok: true,
    wallMs,
    usage,
    response: parsed.value,
    proposedVerdict: parsed.value.verdict,
    guarded: coherenceGuard(parsed.value.verdict, parsed.value.errors),
    wasFenced: parsed.wasFenced,
    unknownErrorTypes: validateErrorTypes(parsed.value.errors, context.language),
  };
}
