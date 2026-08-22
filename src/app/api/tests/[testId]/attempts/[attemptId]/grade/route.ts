// Judging an attempt again after a batch failed.
//
// The same answers, judged again — nothing is re-entered and nothing new is
// written. It exists because design.md § Failure behaviour's rule has a second
// half: a failure is never rendered as a wrong answer, and the Student is left
// with something they can do about it.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../../../ru.ts';
import { getDatabase } from '../../../../../../../db/index.ts';
import { currentStudent } from '../../../../../../../auth/current-student.ts';
import { openAttempt } from '../../../../../../../tests/taking.ts';
import { gradeAttempt, reopenFailedGrading } from '../../../../../../../tests/grading.ts';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ testId: string; attemptId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { testId: rawTestId, attemptId: rawAttemptId } = await params;
  const testId = Number(rawTestId);
  const attemptId = Number(rawAttemptId);
  if (!Number.isInteger(testId) || !Number.isInteger(attemptId)) {
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  const { db } = getDatabase();

  // The guard first, and through the same door the review reads: another
  // Student's attempt is not theirs to have judged, or to learn the existence of.
  const before = openAttempt(db, student.id, attemptId);
  if (!before.ok || before.view.testId !== testId) {
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  reopenFailedGrading(db, attemptId);
  // Not awaited, for the same reason submitting does not await it.
  void gradeAttempt(db, attemptId);

  // Read back after the reopen, so what comes back says «проверяется» rather
  // than still showing the failure the Student just asked to clear.
  const after = openAttempt(db, student.id, attemptId);
  if (!after.ok) return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });

  return NextResponse.json(
    { ok: true, view: after.view },
    { headers: { 'cache-control': 'no-store' } },
  );
}
