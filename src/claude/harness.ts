// One SDK harness, two callers.
//
// Everything about an Agent SDK call that is not about *what* is being asked
// lives here: the lazy import, the four context-stripping settings, the
// environment they depend on, the abort and the timeout, the buffered delta
// stream, the per-model token accounting, and the credentials/egress heuristics
// ADR 0001 requires be phrased as heuristics rather than as diagnoses.
//
// **Why one and not two.** Stripping Claude Code's own ~8-11k-token harness
// prompt takes four settings, not one (design.md § Configuration), and not one
// of them announces itself when it is missing. A call that omits `settingSources`
// still works, still returns an answer, and quietly loads this repo's CLAUDE.md,
// ~/.claude and every project skill into a request that needs none of them. It
// is slower and more expensive and nothing on any screen says so. A second copy
// of those settings is a second place for them to drift, and the drift is
// invisible in exactly the way that means nobody finds it.
//
// The contract with every caller has exactly two arms and no exception path, so
// a failure can never be rendered as content. That discipline came from the
// Grader, where a failure rendered as a Verdict would teach a Student that their
// correct answer was wrong; it holds with equal force for authoring, where half
// a Lesson is not a Lesson.

import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { Semaphore } from './semaphore.ts';
import type { Effort } from './effort.ts';
import { config } from '../config.ts';


/**
 * Which limit a call queues behind.
 *
 * Not a number the caller passes: a caller that could name its own concurrency
 * could name the Grader's, which is the one thing this split exists to prevent.
 */
export type Lane = 'grading' | 'authoring';

export type ClaudeRequest = {
  lane: Lane;
  model: string;
  /** A plain string, which REPLACES the harness prompt rather than adding to it. */
  systemPrompt: string;
  prompt: string;
  /**
   * Omitted entirely where the caller wants the model's own default — design.md
   * § Authoring's «По умолчанию». `undefined` is a real choice here, not a
   * missing argument, which is why nothing defaults it.
   */
  effort?: Effort;
  timeoutMs: number;
  /** Single-shot unless a caller says otherwise. Grading is single-shot by ADR 0004. */
  maxTurns?: number;
  /**
   * An earlier session to carry on from. Always **forked**, never continued in
   * place: #36 restores an earlier Draft and carries on from that point, and a
   * session continued in place would make the branch overwrite the trunk. The
   * fork is not optional for the same reason the concurrency lane is not a
   * number — the one dangerous variant is simply not expressible.
   */
  resume?: string;
};

export type ClaudeUsage = {
  inputTokens: number | null;
  cacheReadInputTokens: number | null;
  outputTokens: number | null;
  /** True context size is inputTokens + cacheReadInputTokens. */
  contextTokens: number | null;
  costUsd: number | null;
  /** The SDK invokes an auxiliary Haiku model on every query (ADR 0002). */
  modelsInvoked: string[];
};

export const EMPTY_USAGE: ClaudeUsage = {
  inputTokens: null, cacheReadInputTokens: null, outputTokens: null,
  contextTokens: null, costUsd: null, modelsInvoked: [],
};

// 'aborted' is a caller abandoning its own call — an Admin who navigated away
// from a Generation. It is kept apart from 'timeout' because they mean opposite
// things about the system: one is a call nobody wants any more, the other is one
// that took too long.
export type CallFailureKind = 'timeout' | 'aborted' | 'sdk';

export type CallFailure = {
  kind: CallFailureKind;
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
  /** Whatever text had arrived when it failed. Never content — evidence. */
  raw: string | null;
};

/**
 * The session this call ran in, where the SDK named one.
 *
 * Carried on both arms: a turn that failed still consumed a session, and a
 * conversation that lost its thread because the failure was not recorded is the
 * degradation #36 exists to avoid.
 */
export type CallOutcome =
  | { ok: true; text: string; sessionId: string | null; usage: ClaudeUsage; wallMs: number }
  | { ok: false; failure: CallFailure; sessionId: string | null; usage: ClaudeUsage; wallMs: number };

export type CallHandle = {
  /** Text deltas, buffered from the start so a late subscriber misses nothing. */
  deltas: AsyncIterable<string>;
  /** Resolves; never rejects. */
  result: Promise<CallOutcome>;
  /**
   * Abandons the call. The harness writes nothing anywhere, so abandoning one
   * is exactly as consequential as never having made it.
   */
  abort: () => void;
};

// One semaphore per lane for the process, at its own configured limit. Held at
// module scope so the limit is the process's, not one caller's.
const LANES: Record<Lane, Semaphore> = {
  grading: new Semaphore(config.grader.concurrency),
  authoring: new Semaphore(config.authoring.concurrency),
};

/**
 * How many calls are running and queued in each lane.
 *
 * Exported for one test, and it earns that: the semaphore takes its permit on the
 * way in, so a saturated authoring lane leaving every grading slot free is
 * observable synchronously — which is the only way to assert the two lanes are
 * separate without a model.
 */
export function laneLoad(lane: Lane): { inFlight: number; queued: number } {
  return { inFlight: LANES[lane].inFlight, queued: LANES[lane].queued };
}

// Buffers every delta and wakes any number of subscribers. Buffering is what
// lets a call run to completion regardless of whether anyone is listening: the
// pump is driven by the SDK loop, never by a consumer pulling.
export class DeltaStream {
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

// --- The four settings, and the environment they depend on -------------------

/**
 * The environment every SDK call goes out with.
 *
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is here rather than beside the other three
 * settings because auto-memory ignores `settingSources` entirely — it is the one
 * of the four that cannot be expressed as an option, and the reason this
 * function exists at all.
 */
export function harnessEnv(timeoutMs: number): Record<string, string | undefined> {
  return {
    ...process.env,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // auto-memory ignores settingSources
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    API_TIMEOUT_MS: String(timeoutMs),
    CLAUDE_CODE_MAX_RETRIES: '1',
    // DISABLE_NON_ESSENTIAL_MODEL_CALLS is deliberately not set: the spike
    // measured that it does not suppress the auxiliary Haiku call (ADR 0002).
  };
}

/**
 * Exactly the options a call goes out with — built here rather than inline at
 * the call so a test can read them back without needing a model.
 *
 * That test is not ceremony. Every one of the four context-stripping settings is
 * required, and not one of them announces itself when it is missing: the call
 * still works, still returns an answer, and is quietly 2-3× slower on 8-11k
 * tokens of context nobody asked for.
 */
export function queryOptions(
  request: ClaudeRequest,
  abortController?: AbortController,
): Record<string, unknown> {
  return {
    model: request.model,
    // (1 of 4) A plain string REPLACES Claude Code's harness prompt rather than
    // adding to it. Worth 2-3× the wall time — but only together with the three
    // below, all four of which the spike measured as required.
    systemPrompt: request.systemPrompt,
    tools: [],              // availability. allowedTools/disallowedTools govern
                            // permission and would NOT do this.
    skills: [],             // (2 of 4) otherwise project and user skills re-inflate context
    settingSources: [],     // (3 of 4) default is user+project+local: CLAUDE.md, ~/.claude, hooks
    strictMcpConfig: true,  // (4 of 4) claude.ai connectors load under subscription auth otherwise
    maxTurns: request.maxTurns ?? 1,
    includePartialMessages: true,
    // Not 'disabled'. The spike measured adaptive+low as matching or beating it
    // on every pair, and disabling thinking is rejected outright at xhigh/max on
    // Opus 5 and causes tool-call and tag leakage elsewhere — which is precisely
    // what would corrupt a strict document contract.
    thinking: { type: 'adaptive' },
    // Omitted entirely, not defaulted, when the caller chose «По умолчанию».
    ...(request.effort === undefined ? {} : { effort: request.effort }),
    // Forked rather than continued: see ClaudeRequest.resume.
    ...(request.resume === undefined ? {} : { resume: request.resume, forkSession: true }),
    ...(abortController === undefined ? {} : { abortController }),
    cwd: process.cwd(),
    env: harnessEnv(request.timeoutMs),
  };
}

// --- Heuristics (ADR 0001) ---------------------------------------------------

// ADR 0001: the SDK reads credentials from ~/.claude at call time, and the
// failure when it cannot does not present as an auth error. Checking whether the
// directory is readable is a better signal than matching on error text — but it
// is still only a signal, which is why the caller phrases it as a likelihood.
// An auth-shaped error while the credentials are perfectly readable is far more
// likely to be egress than credentials — that is the failure step 2 actually hit.
function looksAuthShaped(reason: string): boolean {
  return /\b(403|401|authenticate|authentication|unauthorized|forbidden)\b/i.test(reason);
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

function diagnose(reason: string): { likelyCredentials: boolean; likelyEgress: boolean } {
  const unreachable = credentialsLookUnreachable();
  return {
    likelyCredentials: unreachable,
    likelyEgress: !unreachable && looksAuthShaped(reason),
  };
}

/** A failure value, with the heuristics filled in unless the caller knows better. */
function callFailure(
  kind: CallFailureKind,
  reason: string,
  raw: string | null,
  hints?: { likelyCredentials: boolean; likelyEgress: boolean },
): CallFailure {
  return { kind, reason, raw, ...(hints ?? diagnose(reason)) };
}

// --- The call ----------------------------------------------------------------

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

function usageFrom(result: Record<string, any>, model: string): ClaudeUsage {
  // result.usage aggregates ACROSS models — the SDK makes an auxiliary Haiku call
  // on every query — so it under-reports the model that did the work. modelUsage
  // is per-model, and this reads only the entry for the model that was asked for.
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

/**
 * One call, queued behind its lane's limit.
 *
 * Started eagerly and never awaited by the caller before it runs: work must run
 * to completion and persist server-side whether or not the client is still
 * listening. Even at 4-7s a closed tab must never lose a Submission, and a
 * Generation is far longer than that.
 */
export function callClaude(request: ClaudeRequest): CallHandle {
  const deltas = new DeltaStream();
  const abortController = new AbortController();
  // Told apart from the timeout, which aborts the same controller: they mean
  // opposite things about the system and must not be reported as one.
  let abandoned = false;

  const result = LANES[request.lane]
    .run(() => runQuery(request, deltas, abortController, () => abandoned))
    .catch((error: unknown): CallOutcome => ({
      // Belt and braces: the contract promises no exception path, so even an
      // unexpected throw becomes a failure the caller can render safely.
      ok: false,
      wallMs: 0,
      sessionId: null,
      usage: EMPTY_USAGE,
      failure: callFailure('sdk', error instanceof Error ? error.message : String(error), null),
    }))
    .finally(() => deltas.close());

  return {
    deltas,
    result,
    abort: () => {
      abandoned = true;
      abortController.abort();
    },
  };
}

async function runQuery(
  request: ClaudeRequest,
  deltas: DeltaStream,
  abort: AbortController,
  wasAbandoned: () => boolean,
): Promise<CallOutcome> {
  const { model, timeoutMs } = request;
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const startedAt = performance.now();

  let text = '';
  let usage = EMPTY_USAGE;
  let sessionId: string | null = null;
  let sdkError: string | null = null;

  try {
    // Imported lazily: the SDK spawns a subprocess and reads ~/.claude, and no
    // page should pay for loading it until something actually calls a model.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    for await (const message of query({
      prompt: request.prompt,
      options: queryOptions(request, abort),
    } as never) as AsyncIterable<SdkMessage>) {
      // Recorded from whichever message names it first — the init message does,
      // and so does the result. A turn that fails halfway still names its
      // session, and that is the one a conversation resumes from.
      if (typeof message.session_id === 'string') sessionId = message.session_id;

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
    const stopped = abort.signal.aborted;
    return {
      ok: false,
      wallMs,
      sessionId,
      usage,
      // Neither a timeout nor an abandonment is evidence about credentials or
      // egress, so neither one guesses.
      failure: stopped
        ? wasAbandoned()
          ? callFailure('aborted', 'the call was abandoned by its caller', text || null,
                        { likelyCredentials: false, likelyEgress: false })
          : callFailure('timeout', `the call was aborted after ${timeoutMs}ms`, text || null,
                        { likelyCredentials: false, likelyEgress: false })
        : callFailure('sdk', error instanceof Error ? error.message : String(error), text || null),
    };
  } finally {
    clearTimeout(timer);
  }

  const wallMs = performance.now() - startedAt;

  if (sdkError || !text) {
    return {
      ok: false, wallMs, sessionId, usage,
      failure: callFailure('sdk', sdkError ?? 'the model produced no text', text || null),
    };
  }

  return { ok: true, text, sessionId, usage, wallMs };
}
