// Generation, answered as a stream.
//
// The body is newline-delimited JSON on the wire the Practice already uses: zero
// or more delta frames carrying the Theory as it is written, then exactly one
// result frame with the Draft, or with the reason there is no Draft. design.md
// § Grading's finding holds with more force here rather than less — the measured
// 4-7s was for a Verdict, and a whole Lesson at high Effort is a different order
// of wait entirely.
//
// **Abandoning writes nothing.** The Grader persists whether or not the Student
// is still listening, because a closed tab must never lose a Submission. This is
// the opposite case and deliberately so: a Generation nobody is waiting for is a
// Draft nobody asked for, and the Draft is written only once the whole Lesson has
// come back and passed the validity rules. So the client going away aborts the
// call, and there is no half-written row to clean up.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { startGeneration } from '../../../../../../authoring/generation.ts';
import { parseGenerationForm } from '../../../../../../authoring/form.ts';
import { progressiveStream } from '../../../../../../wire/ndjson.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const lessonId = idFromParam((await params).lessonId);
  if (lessonId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = parseGenerationForm(await request.json().catch(() => null));
  if (form === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const started = startGeneration(getDatabase().db, { lessonId, studentId: student.id, form });
  if (!started.ok) {
    if (started.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // 422, not 400: the request was understood, and the Admin is told which
    // input is impossible rather than that their Generation "failed".
    return NextResponse.json(
      { ok: false, reason: 'invalid_request', faults: started.faults.map((code) => ({ code })) },
      { status: 422 },
    );
  }

  // The Admin navigating away, closing the tab, or pressing «Отменить» all reach
  // here as the same signal, and all three mean the same thing: nobody wants
  // this Lesson any more, so stop paying for it.
  request.signal.addEventListener('abort', started.abort, { once: true });

  return new Response(progressiveStream(started), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Nothing between here and the browser should hold the first token back
      // for the sake of a fuller buffer: the whole point is that it arrives early.
      'x-accel-buffering': 'no',
    },
  });
}
