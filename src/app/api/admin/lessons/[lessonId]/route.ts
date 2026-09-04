// Removing a Lesson, and everything that was that Lesson's.
//
// DELETE with the Lesson in the path, like the accounts endpoint beside it: what
// is being removed is named by the address, so a request that arrives with the
// wrong body cannot delete the wrong Lesson.
//
// The body carries one thing — the title, typed out. It is checked here and not
// only in the dialog that collects it: a confirmation a caller can skip by
// posting straight at the endpoint is not a confirmation.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../admin/guard.ts';
import { deleteLesson } from '../../../../../admin/authoring.ts';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const lessonId = idFromParam((await params).lessonId);
  if (lessonId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  if (typeof body?.title !== 'string') return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const removed = deleteLesson(getDatabase().db, { lessonId, confirmTitle: body.title });
  if (!removed.ok) {
    // A Lesson that is not there is a 404 rather than a form fault: there is no
    // field on the page that could be corrected to fix it. A name that does not
    // match is the opposite — it is exactly a field to correct.
    if (removed.faults.includes('lesson_not_found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, faults: removed.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, title: removed.title, submissionsRemoved: removed.submissionsRemoved },
    { headers: { 'cache-control': 'no-store' } },
  );
}
