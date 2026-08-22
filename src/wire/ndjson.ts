// The framing both streamed answers share.
//
// Newline-delimited JSON, not SSE. The objection to SSE is issue #18's: an event
// protocol, reconnection semantics and a text framing for one one-shot stream is
// machinery for nothing. A frame per line is the smallest thing that lets a long
// value arrive progressively and the structured payload arrive whole.
//
// One protocol, two cargoes. The Practice streams a Grader's explanation and
// then a Verdict; the editor streams a Lesson's Theory and then a Draft. What
// differs is the terminal frame, and that is the only thing either side has to
// know about the other's business.

/** A newly revealed piece of whatever long value this stream is decoding. */
export type DeltaFrame = { t: 'delta'; text: string };

/** Anything with a discriminator. The terminal frame's shape belongs to its caller. */
export type Framed = { t: string };

export function encodeFrame(frame: Framed): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Splits a growing buffer into whole frames, returning the remainder. A frame
 * that has not finished arriving is not a frame yet.
 */
export function takeFrames<F extends Framed>(buffer: string): { frames: F[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const frames: F[] = [];
  for (const part of parts) {
    if (part.trim() === '') continue;
    frames.push(JSON.parse(part) as F);
  }
  return { frames, rest };
}

export type ProgressiveStream<R extends Framed> = {
  /** Raw text deltas from a model: a JSON object being typed out. */
  deltas: AsyncIterable<string>;
  /**
   * The long field's value as far as it is known from the text that has arrived.
   * Never the raw text: a reader must not see a `{`, a field name, or half an
   * escape sequence.
   */
  decode: (rawSoFar: string) => string;
  /** Already running. Reading it must not be what makes it finish. */
  frame: Promise<R>;
};

/**
 * Deltas as they are revealed, then exactly one terminal frame.
 *
 * This lives apart from every route handler because it is the seam where two
 * tested things are joined — an incremental decoder and a terminal result — and a
 * seam nobody can reach is a seam nobody can test. A route handler needs a booted
 * application and a live model; this needs neither.
 */
export function progressiveStream<R extends Framed>(
  { deltas, decode, frame }: ProgressiveStream<R>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let raw = '';
      let sent = '';
      try {
        for await (const delta of deltas) {
          raw += delta;
          const soFar = decode(raw);
          if (soFar.length > sent.length) {
            const revealed: DeltaFrame = { t: 'delta', text: soFar.slice(sent.length) };
            controller.enqueue(encoder.encode(encodeFrame(revealed)));
            sent = soFar;
          }
        }
        // Exactly one terminal frame, carrying the structured payload whole.
        controller.enqueue(encoder.encode(encodeFrame(await frame)));
      } catch {
        // Whoever was reading has gone. The work carries on and whatever it
        // persists still lands; there is simply nobody left to tell.
      } finally {
        controller.close();
      }
    },
  });
}
