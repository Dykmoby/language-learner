// What the browser and the route agree on for an Explanation.
//
// The same framing as a Submission's — newline-delimited JSON, delta frames then
// exactly one terminal frame (../wire/ndjson.ts) — with a much smaller cargo,
// because an Explanation is prose and nothing else. There is no Verdict on this
// stream, no correction and no Errors: it is asked for *after* a judgement and
// changes none of it.
//
// The terminal frame carries only whether the text finished. A Student who has
// read three sentences that stop mid-word has to be told that is what happened,
// and a stream that simply ended cannot say so on its own.

import type { FailureShape } from '../practice/wire.ts';
import { takeFrames as takeAnyFrames, type DeltaFrame } from '../wire/ndjson.ts';

export { encodeFrame } from '../wire/ndjson.ts';
export type { DeltaFrame };

export type ExplanationFrame = {
  t: 'explained';
  ok: boolean;
  /**
   * Why nothing was written, in the only terms a Student can act on — busy is
   * worth waiting out, broken is not. Null when the text arrived whole.
   */
  failure: FailureShape | null;
};

export type Frame = DeltaFrame | ExplanationFrame;

export function takeFrames(buffer: string): { frames: Frame[]; rest: string } {
  return takeAnyFrames<Frame>(buffer);
}
