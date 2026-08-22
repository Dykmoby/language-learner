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
import { authoringResponse } from '../../../../../../authoring/respond.ts';

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

  return authoringResponse(
    request,
    startRefinement(getDatabase().db, { lessonId, studentId: student.id, form }),
  );
}
