// Enrolling a Student in a Course.
//
// The missing half of authoring: a Course nobody is enrolled in is unreachable
// by construction, so without this a Course written through these screens would
// be invisible to everyone including its author.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { enrollStudent } from '../../../../../../admin/authoring.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { studentId?: unknown } | null;
  if (!Number.isInteger(body?.studentId)) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const { db } = getDatabase();
  const result = enrollStudent(db, { courseId, studentId: body!.studentId as number });
  if (!result.ok) {
    if (result.faults.includes('course_not_found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, faults: result.faults }, { status: 422 });
  }

  // `created: false` is a Student who was already enrolled. Reported rather than
  // refused: enrolling twice is not a mistake worth a red message, and an
  // Enrollment is a fact rather than an event.
  return NextResponse.json(
    { ok: true, created: result.created },
    { headers: { 'cache-control': 'no-store' } },
  );
}
