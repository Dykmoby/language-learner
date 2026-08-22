// Refinement: the conversation over a Draft.
//
// The Admin says what should change and Claude returns the whole Lesson again
// with that change made. What comes back is appended as a Draft with origin
// `refinement`, and like every other Draft it changes nothing a Student reads.
//
// **The document in the editor is what goes over, every turn.** Manual edits and
// conversation therefore interleave with no merge step anywhere: an Admin can fix
// a typo by hand, ask for two more Exercises, and get back a document carrying
// both. ADR 0004 settles this against server-side mutation through tool calls.
//
// **The conversation is resumed, not restarted**, and it is resumed from the
// Draft the Admin is looking at rather than from the newest one. That is what
// makes an old Draft more than old text: going back three turns and carrying on
// is a fork rather than a rewind, and the history stays a history.
//
// **A lost session degrades, it never lies.** The prompt carries the whole
// document either way, so a conversation that cannot be resumed falls back to a
// fresh one that still knows the Lesson — and the Admin is told the thread was
// lost rather than left to wonder why Claude forgot the last three turns.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { DeltaStream } from '../claude/harness.ts';
import { findDraft, openDraft, saveDraft } from '../admin/drafts.ts';
import { documentFaults, type LessonDocument } from '../content/lesson-document.ts';
import { buildRefinementPrompt, type RequestFaultCode } from './contract.ts';
import type { RefinementForm } from './form.ts';
import { authorLesson, theorySoFar, type AuthoringHandle, type AuthoringOutcome } from './call.ts';
import { refusalFrame } from './result.ts';
import type { AuthoringResultFrame } from './wire.ts';
import type { StartedAuthoring } from './respond.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type StartedRefinement = StartedAuthoring<RequestFaultCode>;

export function startRefinement(
  db: Db,
  input: { lessonId: number; studentId: number; form: RefinementForm },
): StartedRefinement {
  const open = openDraft(db, input.lessonId);
  if (open === null) return { ok: false, reason: 'not_found' };
  if (input.form.message.trim() === '') {
    return { ok: false, reason: 'invalid_request', faults: ['message_empty'] };
  }

  // The Draft's own session, not the Lesson's newest — that is the whole of
  // forking off an earlier point. A Draft belonging to another Lesson names no
  // session here, whatever id arrived.
  const from = input.form.fromDraftId === null ? null : findDraft(db, input.form.fromDraftId);
  const resume = from?.lessonId === input.lessonId ? from.sessionId ?? undefined : undefined;

  const prompt = buildRefinementPrompt(input.form.document, input.form.message);
  const start = (session: string | undefined): AuthoringHandle => authorLesson({
    language: open.course.language,
    prompt,
    model: input.form.model,
    ...(input.form.effort === undefined ? {} : { effort: input.form.effort }),
    ...(session === undefined ? {} : { resume: session }),
    // Nothing to measure a Refinement against: there is no order, only a Lesson
    // and a request. The validity rules still hold in full — an incoherent
    // Exercise must never reach a Draft, whichever call produced it.
    check: (document) => ({ faults: documentFaults(document), mismatches: [] }),
  });

  // One stream for the Admin whether the turn took one attempt or two. The
  // fallback only ever runs when the first attempt produced no text at all, so
  // nothing half-written is ever followed by a second beginning.
  const deltas = new DeltaStream();
  const attempt: Attempt = { abort: () => {}, abandoned: false };

  const frame = runTurn(start, resume, deltas, attempt)
    .then(({ outcome, threadLost }) => (
      outcome.ok
        ? storeRefined(db, {
          lessonId: input.lessonId,
          studentId: input.studentId,
          document: outcome.document,
          sessionId: outcome.sessionId,
          message: input.form.message,
          threadLost,
        })
        // A failed or timed-out turn leaves both the Draft and the thread exactly
        // as they were: nothing is written here, so there is nothing to undo.
        : refusalFrame(outcome.failure)
    ))
    .finally(() => deltas.close());

  return {
    ok: true,
    deltas,
    decode: theorySoFar,
    frame,
    abort: () => {
      // Recorded as well as forwarded: an abort that lands between the two
      // attempts would otherwise be answered by starting a second call nobody
      // is waiting for.
      attempt.abandoned = true;
      attempt.abort();
    },
  };
}

/** The call in flight, and whether the Admin has given up on it. */
type Attempt = { abort: () => void; abandoned: boolean };

/**
 * Whether a failed turn should be tried again as a fresh conversation.
 *
 * Three conditions, and each of them rules out a case where retrying would be
 * wrong rather than merely useless:
 *
 *   - **a session was named.** With no session there is nothing that could have
 *     failed to resume, so a second identical call would fail identically.
 *   - **the failure was the SDK, and no text arrived at all.** That is the shape
 *     a session that cannot be resumed has: it fails before the model is
 *     reached. A timeout means the call ran and ran; retrying doubles a wait that
 *     was already too long. An abandonment is a decision the Admin has made.
 *   - **nothing had been written to the stream.** Restarting after half a
 *     document had streamed would put a second beginning after a first middle,
 *     which is precisely the "half a Lesson" the failure rules exist to prevent.
 *
 * Exported because it is the judgement in this module, and it is the one part
 * that cannot be provoked from a live call on demand.
 */
export function shouldStartFresh(
  resume: string | undefined,
  outcome: AuthoringOutcome,
): boolean {
  return resume !== undefined
    && !outcome.ok
    && outcome.failure.kind === 'call'
    && outcome.failure.call.kind === 'sdk'
    && outcome.failure.call.raw === null;
}

/** One turn, with at most one fallback. */
async function runTurn(
  start: (session: string | undefined) => AuthoringHandle,
  resume: string | undefined,
  deltas: DeltaStream,
  attempt: Attempt,
): Promise<{ outcome: AuthoringOutcome; threadLost: boolean }> {
  const first = start(resume);
  attempt.abort = first.abort;
  const pumped = pump(first.deltas, deltas);
  const outcome = await first.result;
  await pumped;

  // Checked again after the await: an abort that landed while the first attempt
  // was settling means nobody is waiting for a second one.
  if (attempt.abandoned || !shouldStartFresh(resume, outcome)) {
    return { outcome, threadLost: false };
  }

  const fresh = start(undefined);
  attempt.abort = fresh.abort;
  if (attempt.abandoned) fresh.abort();
  const pumpedAgain = pump(fresh.deltas, deltas);
  const second = await fresh.result;
  await pumpedAgain;

  // Reported as lost even when the fresh attempt also failed: what the Admin has
  // to know is that the thread is gone, and the next turn starts from the
  // document rather than from three turns of context.
  return { outcome: second, threadLost: true };
}

async function pump(from: AsyncIterable<string>, into: DeltaStream): Promise<void> {
  for await (const chunk of from) into.push(chunk);
}

/**
 * The Draft, appended with origin `refinement`, recording the session it came
 * from.
 *
 * The session is what a later restore forks off. Without it, going back to this
 * turn would be a rewind — the text without the conversation that produced it.
 */
function storeRefined(
  db: Db,
  input: {
    lessonId: number;
    studentId: number;
    document: LessonDocument;
    sessionId: string | null;
    message: string;
    threadLost: boolean;
  },
): AuthoringResultFrame {
  const saved = saveDraft(db, {
    lessonId: input.lessonId,
    studentId: input.studentId,
    document: input.document,
    origin: 'refinement',
    sessionId: input.sessionId,
    // The request is stored with the Draft it produced, which is what makes the
    // thread readable after a reload without a table of its own.
    refinementRequest: input.message,
  });

  // Unreachable: the document has already been through the whole of
  // `documentFaults`, of which saveDraft checks a subset. Reported rather than
  // asserted away, because "cannot happen" and "is not handled" must not be the
  // same line of code.
  if (!saved.ok) {
    return { t: 'result', ok: false, reason: 'invalid', faults: saved.faults, detail: null };
  }

  return {
    t: 'result',
    ok: true,
    draftId: saved.draft.id,
    document: saved.draft.document,
    mismatches: [],
    sessionId: input.sessionId,
    threadLost: input.threadLost,
  };
}
