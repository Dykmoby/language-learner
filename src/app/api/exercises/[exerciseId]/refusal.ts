// One place that turns a refusal from the practice module into an HTTP answer,
// so the submit route and the reveal route cannot disagree about what a missing
// Exercise is.

import { NextResponse } from 'next/server';
import { ru } from '../../../../ru.ts';
import type { SubmitRefusal } from '../../../../practice/submit.ts';

// One entry per refusal, rather than a status map beside a message map: two maps
// keyed by the same union are two things that have to be edited together.
const REFUSALS: Record<SubmitRefusal['reason'], { status: number; message: string }> = {
  // An Exercise in a Course the Student is not enrolled in is not theirs to know
  // about, so it is missing rather than forbidden.
  not_found: { status: 404, message: ru.errors.notFound },
  already_complete: { status: 409, message: ru.practice.alreadyComplete },
  not_current: { status: 409, message: ru.practice.notCurrent },
  empty_answer: { status: 400, message: ru.practice.emptyAnswer },
  not_ready: { status: 409, message: ru.practice.revealHint },
};

export function refuse(reason: SubmitRefusal['reason']): NextResponse {
  const { status, message } = REFUSALS[reason];
  return NextResponse.json({ error: message }, { status });
}
