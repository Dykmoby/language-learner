import { NextResponse } from 'next/server';
import { currentStudent } from '../../../../auth/current-student.ts';
import { runHealthCheck } from '../../../../grader/health-check.ts';
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
  return NextResponse.json(await runHealthCheck());
}
