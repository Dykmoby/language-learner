// Reveal: the Reference Answer, after three failed attempts.
//
// Offered, not forced — a Student who wants a fourth attempt takes one instead.
// Asking for it early is refused here rather than merely hidden in the browser,
// because a control the server does not enforce is a suggestion.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { revealAnswer } from '../../../../../practice/submit.ts';
import { refuse } from '../refusal.ts';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const exerciseId = Number((await params).exerciseId);
  if (!Number.isInteger(exerciseId)) return refuse('not_found');

  const revealed = revealAnswer(getDatabase().db, student.id, exerciseId);
  if (!revealed.ok) return refuse(revealed.reason);

  return NextResponse.json(revealed, { headers: { 'cache-control': 'no-store' } });
}
