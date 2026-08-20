// Turning a Grader's raw deltas into the frames the browser reads.
//
// This lives here rather than inside the route handler because it is the seam
// where two tested things are joined — the incremental feedback_ru extractor and
// the terminal result — and a seam nobody can reach is a seam nobody can test. A
// route handler needs a booted application and a live model; this needs neither.

import { feedbackRuSoFar } from '../grader/contract.ts';
import { encodeFrame, type ResultFrame } from './wire.ts';

export type StreamedGrading = {
  /** Raw text deltas from the Grader: a JSON object being typed out. */
  deltas: AsyncIterable<string>;
  /** Already running. Reading it must not be what makes it finish. */
  frame: Promise<ResultFrame>;
};

export function gradingStream({ deltas, frame }: StreamedGrading): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let raw = '';
      let sent = '';
      try {
        for await (const delta of deltas) {
          raw += delta;
          // The Student must never see a `{`, a field name, or half an escape
          // sequence — so what is sent is the decoded value as far as it is
          // known, minus what has already gone.
          const soFar = feedbackRuSoFar(raw);
          if (soFar.length > sent.length) {
            controller.enqueue(encoder.encode(encodeFrame({ t: 'delta', text: soFar.slice(sent.length) })));
            sent = soFar;
          }
        }
        // Exactly one terminal frame, carrying the Verdict, the Errors and the
        // correction whole. Errors never stream.
        controller.enqueue(encoder.encode(encodeFrame(await frame)));
      } catch {
        // The Student closed the tab. Grading carries on and the row still lands;
        // there is simply nobody left to tell.
      } finally {
        controller.close();
      }
    },
  });
}
