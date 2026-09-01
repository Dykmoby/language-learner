// Submitting an attempt at a Test: every answer at once, in one request.
//
// One request rather than one per Exercise, because a Test is answered as a
// whole — and because a per-Exercise endpoint is exactly the shape that would
// leak a judgement before the Student has finished.
//
// What comes back is where the attempt is, not how it went: the answers judged
// in code are already settled, and anything the Grader judges is still to come.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../ru.ts';
import { getDatabase } from '../../../../../db/index.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { submitAttempt } from '../../../../../tests/taking.ts';
import { gradeAttempt } from '../../../../../tests/grading.ts';
import type { AttemptAnswer } from '../../../../../tests/wire.ts';

function parseAnswers(value: unknown): AttemptAnswer[] | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = (value as Record<string, unknown>).answers;
  if (!Array.isArray(raw)) return null;

  const answers: AttemptAnswer[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    // One value per gap, in reading order — a list of one for every Kind with a
    // single place to answer, so nothing here has to know how many gaps the
    // Exercise being answered has.
    const { exerciseId, answers: written } = entry as Record<string, unknown>;
    if (!Number.isInteger(exerciseId)) return null;
    if (!Array.isArray(written) || !written.every((value) => typeof value === 'string')) return null;
    answers.push({ exerciseId: exerciseId as number, answers: written as string[] });
  }
  return answers;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ testId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session. This is the
  // narrowing, and it is not redundant: a session can expire between the two.
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const testId = Number((await params).testId);
  if (!Number.isInteger(testId)) return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });

  const answers = parseAnswers(await request.json().catch(() => null));
  if (answers === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const submitted = submitAttempt(getDatabase().db, student.id, testId, answers);
  if (!submitted.ok) {
    if (submitted.reason === 'empty_test') {
      return NextResponse.json({ error: ru.test.empty }, { status: 409 });
    }
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  // Started here and deliberately not awaited: the batch runs to completion and
  // persists server-side whether or not this response is ever read. An attempt is
  // many answers, and a closed tab must never cost them.
  if (submitted.awaiting.length > 0) void gradeAttempt(getDatabase().db, submitted.attemptId);

  return NextResponse.json(
    { ok: true, attemptId: submitted.attemptId, awaiting: submitted.awaiting.length },
    { headers: { 'cache-control': 'no-store' } },
  );
}
