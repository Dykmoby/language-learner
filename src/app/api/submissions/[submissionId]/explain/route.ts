// An Explanation, streamed.
//
// The body is newline-delimited JSON: delta frames carrying the text as it is
// written, then one frame saying whether it finished. Unlike a Submission's
// stream there is nothing to persist at the end of it — an Explanation is not
// stored — so if the Student navigates away, the call is simply money spent on
// a paragraph nobody read, and nothing is lost from the record.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../ru.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { getDatabase } from '../../../../../db/index.ts';
import { explainSubmission, type ExplanationRefusal } from '../../../../../practice/explanation.ts';
import { progressiveStream } from '../../../../../wire/ndjson.ts';
import type { ExplanationFrame } from '../../../../../explain/wire.ts';

// One entry per refusal, as the other Student-facing routes do it.
const REFUSALS: Record<ExplanationRefusal['reason'], { status: number; message: string }> = {
  // Another Student's answer is not theirs to ask about, and its existence is
  // not theirs to learn — so it is missing rather than forbidden.
  not_found: { status: 404, message: ru.errors.notFound },
  not_judged: { status: 409, message: ru.explain.notJudged },
  not_wrong: { status: 409, message: ru.explain.notWrong },
  explained_already: { status: 409, message: ru.explain.alreadyExplained },
};

export async function POST(
  _request: Request,
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

  const started = explainSubmission(getDatabase().db, student.id, submissionId);
  if (!started.ok) {
    const { status, message } = REFUSALS[started.reason];
    return NextResponse.json({ error: message }, { status });
  }

  const frame: Promise<ExplanationFrame> = started.result.then((outcome) => ({
    t: 'explained',
    ok: outcome.ok,
    // Busy or broken — the only distinction that changes what the Student should
    // do next, and the same two words a failed grading is reported in.
    failure: outcome.ok ? null : outcome.failure.likelyRateLimit ? 'busy' : 'broken',
  }));

  return new Response(
    // The text is the answer, so what has arrived so far *is* what is shown —
    // there is no field to decode out of it, the way a Grader's JSON has one.
    progressiveStream({ deltas: started.deltas, decode: (raw) => raw, frame }),
    {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      },
    },
  );
}
