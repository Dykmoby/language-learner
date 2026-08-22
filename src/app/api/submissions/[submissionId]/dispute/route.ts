// Objecting to a Verdict.
//
// One endpoint for both places a Verdict is reached, because a Test's answers are
// Submissions (ADR 0005) and the objection is against the Submission rather than
// against the screen it was made from. A second route for Tests would be a second
// copy of the same four refusals.
//
// Nothing here touches the Submission. What it writes is a Dispute row; what the
// Student gets back is the fact that it landed.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../ru.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { getDatabase } from '../../../../../db/index.ts';
import {
  disputeVerdict, MAX_COMMENT_LENGTH, type DisputeRefusal,
} from '../../../../../practice/disputes.ts';

// One entry per refusal, as the practice routes do it: a status map beside a
// message map is two things that have to be edited together.
const REFUSALS: Record<DisputeRefusal['reason'], { status: number; message: string }> = {
  // Another Student's answer is not theirs to object to, and its existence is not
  // theirs to learn — so it is missing rather than forbidden.
  not_found: { status: 404, message: ru.errors.notFound },
  not_judged: { status: 409, message: ru.dispute.notJudged },
  already_disputed: { status: 409, message: ru.dispute.already },
  empty_comment: { status: 400, message: ru.dispute.emptyComment },
  comment_too_long: { status: 400, message: ru.dispute.tooLong(MAX_COMMENT_LENGTH) },
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ submissionId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session. This is the
  // narrowing, and it is not redundant: a session can expire between the two.
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const submissionId = Number((await params).submissionId);
  if (!Number.isInteger(submissionId)) {
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  const body = await request.json().catch(() => null) as { comment?: unknown } | null;
  const comment = typeof body?.comment === 'string' ? body.comment : '';

  const outcome = disputeVerdict(getDatabase().db, student.id, submissionId, comment);
  if (!outcome.ok) {
    const { status, message } = REFUSALS[outcome.reason];
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ ok: true, disputeId: outcome.dispute.id });
}
