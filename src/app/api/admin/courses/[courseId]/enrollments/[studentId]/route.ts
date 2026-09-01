// Taking a Student off a Course.
//
// The other half of the enrolment endpoint beside it, and deliberately a
// different shape: enrolling names its Student in a JSON body, withdrawing names
// them in the path. That is what DELETE is for, and it means a request stripped
// of its body cannot remove somebody at random.
//
// It removes access and nothing else — their Submissions in the Course stay
// where they are, so putting them back on it resumes rather than restarts.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../../admin/guard.ts';
import { withdrawStudent } from '../../../../../../../admin/authoring.ts';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ courseId: string; studentId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const raw = await params;
  const courseId = idFromParam(raw.courseId);
  const studentId = idFromParam(raw.studentId);
  if (courseId === null || studentId === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // `removed: false` is a Student who was not enrolled — reported rather than
  // refused, the mirror of enrolling one who already was.
  const result = withdrawStudent(getDatabase().db, { courseId, studentId });

  return NextResponse.json(
    { ok: true, removed: result.removed },
    { headers: { 'cache-control': 'no-store' } },
  );
}
