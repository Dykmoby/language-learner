// One Refinement turn, answered as a stream.
//
// The same wire as Generation and as the Practice: delta frames carrying the
// Theory as it is rewritten, then exactly one result frame with the appended
// Draft or with the reason there is none.
//
// The document travels in the request body rather than being read from the
// newest Draft, and that is the point (ADR 0004): what goes over is whatever is
// in the editor at this moment, hand edits included, so editing and conversing
// interleave with no merge step anywhere.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { startRefinement } from '../../../../../../authoring/refinement.ts';
import { parseRefinementForm } from '../../../../../../authoring/form.ts';
import { progressiveStream } from '../../../../../../wire/ndjson.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const lessonId = idFromParam((await params).lessonId);
  if (lessonId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const form = parseRefinementForm(await request.json().catch(() => null));
  if (form === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const started = startRefinement(getDatabase().db, { lessonId, studentId: student.id, form });
  if (!started.ok) {
    if (started.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(
      { ok: false, reason: 'invalid_request', faults: started.faults.map((code) => ({ code })) },
      { status: 422 },
    );
  }

  // Abandoning a turn writes nothing, exactly as abandoning a Generation does —
  // and here it also leaves the thread where it was, because the Draft that
  // records the session is only written on success.
  request.signal.addEventListener('abort', started.abort, { once: true });

  return new Response(progressiveStream(started), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
