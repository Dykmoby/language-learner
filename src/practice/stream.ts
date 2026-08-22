// Turning a Grader's raw deltas into the frames the browser reads.
//
// The framing and the pump live in ../wire/ndjson.ts, shared with the editor's
// Generation stream. What is decided here is this stream's own business: which
// field of the Grader's JSON is the one the Student is waiting on.

import { feedbackRuSoFar } from '../grader/contract.ts';
import { progressiveStream } from '../wire/ndjson.ts';
import type { ResultFrame } from './wire.ts';

export type StreamedGrading = {
  /** Raw text deltas from the Grader: a JSON object being typed out. */
  deltas: AsyncIterable<string>;
  /** Already running. Reading it must not be what makes it finish. */
  frame: Promise<ResultFrame>;
};

export function gradingStream({ deltas, frame }: StreamedGrading): ReadableStream<Uint8Array> {
  // The Student must never see a `{`, a field name, or half an escape sequence,
  // so what is sent is the decoded value of feedback_ru as far as it is known.
  // design.md § Response contract puts that field first for exactly this reason.
  return progressiveStream({ deltas, decode: feedbackRuSoFar, frame });
}
