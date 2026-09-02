import { NextResponse } from 'next/server';
import { currentStudent } from '../../../../auth/current-student.ts';
import { runHealthCheck } from '../../../../grader/health-check.ts';
import { getDatabase } from '../../../../db/index.ts';
import { currentGuidance } from '../../../../grader/guidance.ts';
import { tryRecordHealthCheck } from '../../../../ops/health-history.ts';
import { ru } from '../../../../ru.ts';

// The middleware has already turned away anyone without a session. This is the
// Admin narrowing on top of it.
export async function POST(): Promise<NextResponse> {
  const student = await currentStudent();
  // The choke point makes this all but unreachable. All but: a session can expire
  // between the middleware's check and this one, and an endpoint that spends a
  // paid Grader call should not rely on another layer having looked.
  if (!student) return NextResponse.json({ error: ru.health.forbidden }, { status: 401 });
  if (!student.isAdmin) return NextResponse.json({ error: ru.health.forbidden }, { status: 403 });

  // Never throws: the Grader module's terminal result is a discriminated union,
  // so an unhealthy check is a value rather than an exception.
  const { db } = getDatabase();
  const result = await runHealthCheck(currentGuidance(db));

  // Kept, so the answer outlives the tab it was asked in and reaches the
  // dashboard. Recorded whether it passed or failed — a memory that only keeps
  // the good news is not one worth reading.
  //
  // A failure to record is not allowed to swallow the result. The Admin has just
  // spent a real Grader call, and answering them with a 500 because the row
  // could not be written would lose the one thing they asked for — most likely
  // on a deploy where the step-8 migration has not been applied yet, which is
  // exactly when somebody is pressing this button.
  const kept = tryRecordHealthCheck(db, result, 'button');
  if (!kept.kept) console.error(`health check not recorded: ${kept.reason}`);

  return NextResponse.json(result);
}
