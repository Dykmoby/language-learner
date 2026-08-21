// Reordering the Lessons of a Course.
//
// The whole order at once rather than a "move this one up": positions are unique
// within a Course, so a partial order is a state the database refuses and a
// half-applied one is a Course whose Lessons a Student meets in the wrong
// sequence. One request, one transaction, one order.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../../admin/guard.ts';
import { reorderLessons } from '../../../../../../../admin/authoring.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { lessonIds?: unknown } | null;
  const lessonIds = body?.lessonIds;
  if (!Array.isArray(lessonIds) || !lessonIds.every((id) => Number.isInteger(id))) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const { db } = getDatabase();
  const result = reorderLessons(db, courseId, lessonIds as number[]);
  if (!result.ok) {
    // 409: nothing is wrong with the request's shape — the browser is holding an
    // order that no longer describes this Course.
    return NextResponse.json({ ok: false, faults: result.faults }, { status: 409 });
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
