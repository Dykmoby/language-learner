// Creating a Lesson in a Course.
//
// It arrives unpublished, with its first Draft, and stays invisible to every
// Student until someone deliberately publishes it — see `createLesson`.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { createLesson } from '../../../../../../admin/authoring.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  if (typeof body?.title !== 'string') return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const created = createLesson(db, { courseId, title: body.title, studentId: student.id });
  if (!created.ok) {
    // A Course that does not exist is a 404 rather than a form fault: there is
    // no field on the page that could be corrected to fix it.
    if (created.faults.includes('course_not_found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, faults: created.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, lessonId: created.lesson.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
