// A Submission, answered as a stream.
//
// The body is newline-delimited JSON: zero or more delta frames carrying the
// progressively-decoded Russian explanation, then exactly one result frame with
// the Verdict, the Errors and the correction. Errors do not stream — a
// half-arrived error list is not information.
//
// The route does not own persistence. submitAnswer() has already started it by
// the time this handler builds a stream, and it finishes whether or not anybody
// reads a single byte of what follows.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { submitAnswer } from '../../../../../practice/submit.ts';
import { gradingStream } from '../../../../../practice/stream.ts';
import { encodeFrame } from '../../../../../practice/wire.ts';
import { refuse } from '../refusal.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session. This is the
  // narrowing, and it is not redundant: a session can expire between the two.
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const exerciseId = Number((await params).exerciseId);
  if (!Number.isInteger(exerciseId)) return refuse('not_found');

  const body = await request.json().catch(() => null) as { answer?: unknown } | null;
  const answer = typeof body?.answer === 'string' ? body.answer : '';

  const started = submitAnswer(getDatabase().db, student.id, exerciseId, answer);
  if (!started.ok) return refuse(started.reason);

  const headers = {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    // Nothing between here and the browser should hold the first token back for
    // the sake of a fuller buffer: the whole point is that it arrives early.
    'x-accel-buffering': 'no',
  };

  // A Deterministic Check is already settled. It still answers on the same wire
  // in the same shape, so the browser has one code path rather than two.
  if (!started.streamed) {
    return new Response(encodeFrame(started.frame), { headers });
  }

  return new Response(gradingStream(started), { headers });
}
