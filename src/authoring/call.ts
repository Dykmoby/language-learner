// One authoring call: a prompt goes out, a Lesson document comes back.
//
// Everything about *making* the call lives in the shared harness; everything
// about what a Lesson document is lives in the pure contract next door. What is
// here is the join, and the discipline the Grader established:
//
// **A failure must never look like content.** A timeout, a refusal, or an answer
// that will not parse leaves the Draft that was there exactly as it was, and says
// so. Half a Lesson is not a Lesson, and an Admin must never be left unsure
// whether what they are reading came from Claude or was already on the screen.
//
// So the outcome is a two-armed value with no exception path, and nothing here
// writes anything. Persisting a successful call is its caller's act, which is
// what makes "abandoning it writes nothing" true by construction rather than by
// remembering to undo something.
//
// Generation and Refinement differ in what they ask for and in what counts as a
// discrepancy — a Generation is measured against an order, a Refinement against
// nothing — so the check is a parameter. Everything else they share.

import { callClaude, type CallFailure, type ClaudeUsage } from '../claude/harness.ts';
import type { Effort } from '../claude/effort.ts';
import { jsonStringFieldSoFar, type Language } from '../grader/contract.ts';
import { config } from '../config.ts';
import type { DocumentFault, LessonDocument } from '../content/lesson-document.ts';
import {
  buildAuthorPrompt, buildAuthorSystemPrompt, parseGeneratedLesson, checkGeneratedLesson,
  type AuthorRefusal, type GenerationRequest, type MixMismatch,
} from './contract.ts';

/** Why nothing came back that could be stored. Never a partial Lesson. */
export type AuthoringFailure =
  | { kind: 'call'; call: CallFailure }
  // Not a document at all. Never a partial one.
  | { kind: 'refusal'; refusal: AuthorRefusal }
  // A document, and one the validity rules turn down. An incoherent Exercise
  // must never reach a Draft, because a Draft is what Refinement will work from
  // and what a restore will bring back.
  | { kind: 'invalid'; faults: DocumentFault[] };

export type AuthoringOutcome =
  | {
      ok: true;
      document: LessonDocument;
      /** Not a reason to refuse: see `mixMismatches`. */
      mismatches: MixMismatch[];
      sessionId: string | null;
      usage: ClaudeUsage;
      wallMs: number;
    }
  | {
      ok: false;
      failure: AuthoringFailure;
      sessionId: string | null;
      usage: ClaudeUsage;
      wallMs: number;
    };

export type AuthoringHandle = {
  /** Raw text deltas: the Lesson document being typed out. */
  deltas: AsyncIterable<string>;
  /** Resolves; never rejects. */
  result: Promise<AuthoringOutcome>;
  /** Abandons the call. Nothing has been written, so nothing has to be undone. */
  abort: () => void;
};

/**
 * The Theory as far as it is known from the text that has arrived.
 *
 * The document's fields are emitted in a fixed order — title, grammarFocus,
 * theoryMarkdown — so the two short ones land almost at once and the long one is
 * what the Admin actually watches being written. The decoder is the Grader's, on
 * a different field: the same escape rules, got right once.
 */
export function theorySoFar(rawSoFar: string): string {
  return jsonStringFieldSoFar(rawSoFar, 'theoryMarkdown');
}

/**
 * What counts as wrong with the document that came back.
 *
 * A check, not a review: "review" means the thing a person does before a Lesson
 * reaches a Student, and no rule here can do it — see authoring/review.ts.
 */
export type Check = (document: LessonDocument) => { faults: DocumentFault[]; mismatches: MixMismatch[] };

export type AuthoringCall = {
  language: Language;
  prompt: string;
  model: string;
  /** Omitted entirely where the Admin chose «По умолчанию». */
  effort?: Effort;
  /** A conversation to carry on from. Always forked — see ClaudeRequest.resume. */
  resume?: string;
  check: Check;
};

export function authorLesson(call: AuthoringCall): AuthoringHandle {
  const running = callClaude({
    lane: 'authoring',
    model: call.model,
    systemPrompt: buildAuthorSystemPrompt(call.language),
    prompt: call.prompt,
    ...(call.effort === undefined ? {} : { effort: call.effort }),
    ...(call.resume === undefined ? {} : { resume: call.resume }),
    timeoutMs: config.authoring.timeoutMs,
  });

  return {
    deltas: running.deltas,
    abort: running.abort,
    result: running.result.then((outcome) => judge(outcome, call)),
  };
}

function judge(
  outcome: Awaited<ReturnType<typeof callClaude>['result']>,
  call: AuthoringCall,
): AuthoringOutcome {
  const { sessionId, usage, wallMs } = outcome;
  if (!outcome.ok) {
    return { ok: false, sessionId, usage, wallMs, failure: { kind: 'call', call: outcome.failure } };
  }

  const parsed = parseGeneratedLesson(outcome.text);
  if (!parsed.ok) {
    return { ok: false, sessionId, usage, wallMs, failure: { kind: 'refusal', refusal: parsed.refusal } };
  }

  if (parsed.wasFenced) {
    // A routine model habit rather than something worth throwing a whole
    // generated Lesson away over — but logged when it happens, so a change in
    // how often it happens is visible rather than invisible.
    console.warn(`[authoring] ${call.model} wrapped its Lesson in markdown fences`);
  }

  const checked = call.check(parsed.document);
  if (checked.faults.length > 0) {
    return { ok: false, sessionId, usage, wallMs, failure: { kind: 'invalid', faults: checked.faults } };
  }

  return { ok: true, sessionId, usage, wallMs, document: parsed.document, mismatches: checked.mismatches };
}

export type GenerateInput = {
  request: GenerationRequest;
  model: string;
  effort?: Effort;
};

/** A Lesson written from an Admin's structured inputs, measured against them. */
export function generateLesson(input: GenerateInput): AuthoringHandle {
  return authorLesson({
    language: input.request.language,
    prompt: buildAuthorPrompt(input.request),
    model: input.model,
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    check: (document) => checkGeneratedLesson(document, input.request),
  });
}
