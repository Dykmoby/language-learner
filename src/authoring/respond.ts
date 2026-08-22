// Answering an authoring call over HTTP.
//
// Generation and Refinement differ in what they are asked and in what they store.
// They do not differ in anything here: the same refusals, the same abort, the
// same wire, the same headers. Two copies of this is two places for the abort
// wiring to be forgotten in — and forgetting it means a Generation nobody is
// waiting for runs on for minutes and writes a Draft nobody asked for.

import { NextResponse } from 'next/server';
import { progressiveStream } from '../wire/ndjson.ts';
import type { AuthoringResultFrame } from './wire.ts';

/**
 * A call that started, or the reason it did not.
 *
 * The fault codes are the caller's own — a Generation's inputs and a Refinement's
 * request fail for different reasons — so the type carries them rather than
 * flattening them to `string` and losing the exhaustiveness that keeps every code
 * attached to a Russian sentence.
 */
export type StartedAuthoring<Fault extends string> =
  | { ok: false; reason: 'not_found' }
  // Refused before the call goes out. Authoring is minutes of work, and spending
  // them to report something knowable at the button press is worse than not
  // starting.
  | { ok: false; reason: 'invalid_request'; faults: Fault[] }
  | {
      ok: true;
      /** The Lesson document being typed out, raw. */
      deltas: AsyncIterable<string>;
      /** The Theory as far as it is known — what the editor actually shows. */
      decode: (rawSoFar: string) => string;
      /** Already running. Reading it must not be what makes it finish. */
      frame: Promise<AuthoringResultFrame>;
      /** Abandons the call. Nothing has been written, so nothing has to be undone. */
      abort: () => void;
    };

export function authoringResponse(
  request: Request,
  started: StartedAuthoring<string>,
): Response {
  if (!started.ok) {
    if (started.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // 422, not 400: the request was understood, and the Admin is told which input
    // is impossible rather than that their Lesson "failed". The codes travel as
    // faults so the editor renders them through the one dictionary lookup it
    // already uses for everything else.
    return NextResponse.json(
      { ok: false, reason: 'invalid_request', faults: started.faults.map((code) => ({ code })) },
      { status: 422 },
    );
  }

  // The Admin navigating away, closing the tab, or pressing «Отменить» all reach
  // here as the same signal, and all three mean the same thing: nobody wants this
  // Lesson any more, so stop paying for it.
  //
  // The opposite of grading, deliberately. The Grader persists whether or not the
  // Student is still listening, because a closed tab must never lose a
  // Submission; here the Draft is written only once the whole Lesson has come
  // back and passed every rule, so abandoning one leaves nothing behind.
  request.signal.addEventListener('abort', started.abort, { once: true });

  return new Response(progressiveStream(started), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Nothing between here and the browser should hold the first token back for
      // the sake of a fuller buffer: the whole point is that it arrives early.
      'x-accel-buffering': 'no',
    },
  });
}
