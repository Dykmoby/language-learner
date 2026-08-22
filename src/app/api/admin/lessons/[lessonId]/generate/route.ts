// Generation, answered as a stream.
//
// The body is newline-delimited JSON on the wire the Practice already uses: zero
// or more delta frames carrying the Theory as it is written, then exactly one
// result frame with the Draft, or with the reason there is no Draft. design.md
// § Grading's finding holds with more force here rather than less — the measured
// 4-7s was for a Verdict, and a whole Lesson at high Effort is a different order
// of wait entirely.
//
// Everything below the parse is shared with the Refinement route, which fails,
// aborts and streams identically.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { startGeneration } from '../../../../../../authoring/generation.ts';
import { parseGenerationForm } from '../../../../../../authoring/form.ts';
import { authoringResponse } from '../../../../../../authoring/respond.ts';

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

  return authoringResponse(
    request,
    startGeneration(getDatabase().db, { lessonId, studentId: student.id, form }),
  );
}
