// What the editor and the Generation route agree on.
//
// The framing is ../wire/ndjson.ts, the same one the Practice uses: delta frames
// carrying the Theory as it is written, then exactly one terminal frame. Not a
// second protocol — the same wire carrying different cargo.
//
// The terminal frame has exactly two shapes and no third. design.md § Authoring:
// a failure must never look like content, and an Admin must never be left unsure
// whether what they are reading came from Claude or was already on the screen.

import type { DocumentFault, LessonDocument } from '../content/lesson-document.ts';
import type { MixMismatch } from './contract.ts';
import type { DeltaFrame } from '../wire/ndjson.ts';

export { encodeFrame } from '../wire/ndjson.ts';
export type { DeltaFrame } from '../wire/ndjson.ts';

import { takeFrames as takeAnyFrames } from '../wire/ndjson.ts';

/** Why nothing was written. Every one of these leaves the Draft exactly as it was. */
export type AuthoringRefusalReason =
  /** The call never came back: a timeout, an abandonment, or an SDK failure. */
  | 'call_failed'
  /** What came back was not a Lesson. `faults` carries the stable refusal code. */
  | 'not_a_lesson'
  /** It was a Lesson, and it breaks the validity rules. Nothing incoherent reaches a Draft. */
  | 'invalid';

export type AuthoringResultFrame = {
  t: 'result';
} & (
  | {
      ok: true;
      /** The Draft that was appended. The editor loads it and carries on as usual. */
      draftId: number;
      document: LessonDocument;
      /**
       * Where the Lesson differs from what was asked for. Facts, not faults: the
       * Draft is stored, and an Admin decides whether the difference matters.
       */
      mismatches: MixMismatch[];
      /** The conversation this turn belongs to, so the next one can resume it. */
      sessionId: string | null;
      /**
       * The conversation could not be resumed and this turn started a fresh one,
       * seeded with the document. Said out loud rather than hidden: an Admin
       * whose next request assumes three turns of context deserves to know the
       * thread is gone. False on a Generation, which starts a thread rather than
       * continuing one.
       */
      threadLost: boolean;
    }
  | {
      ok: false;
      reason: AuthoringRefusalReason;
      /**
       * Stable codes, resolved to Russian at display time — the existing validity
       * faults for an incoherent Lesson, the Author's refusal codes for one that
       * is not a Lesson at all.
       */
      faults: DocumentFault[];
      /** Present when the failure was the call itself, so the Admin is told which. */
      detail: string | null;
    }
);

export type AuthoringFrame = DeltaFrame | AuthoringResultFrame;

/** The shared splitter, bound to this stream's frames so the editor gets types. */
export function takeFrames(buffer: string): { frames: AuthoringFrame[]; rest: string } {
  return takeAnyFrames<AuthoringFrame>(buffer);
}
