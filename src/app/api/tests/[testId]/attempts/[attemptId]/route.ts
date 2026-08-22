// One attempt, as the review screen reads it — and reads it again while a batch
// is still out, which is the only reason this endpoint exists beside the page.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../../ru.ts';
import { getDatabase } from '../../../../../../db/index.ts';
import { currentStudent } from '../../../../../../auth/current-student.ts';
import { openAttempt } from '../../../../../../tests/taking.ts';

export async function GET(
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

  const opened = openAttempt(getDatabase().db, student.id, attemptId);
  // An attempt at some other Test is not this address's business, whatever id
  // the browser sent.
  if (!opened.ok || opened.view.testId !== testId) {
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  return NextResponse.json(
    { ok: true, view: opened.view },
    { headers: { 'cache-control': 'no-store' } },
  );
}
