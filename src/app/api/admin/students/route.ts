// Creating an account.
//
// The seed script says of itself that account creation is deliberately not a web
// surface. This is not the reversal of that: there is still no registration
// route and nobody makes an account for themselves. An Admin makes one, behind
// the section guard, and is handed a Temporary Password to pass on.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db/index.ts';
import { adminOrRefusal } from '../../../../admin/guard.ts';
import { createStudent } from '../../../../auth/accounts.ts';

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as { username?: unknown } | null;
  if (typeof body?.username !== 'string') {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const result = await createStudent(getDatabase().db, { username: body.username });
  if (!result.ok) return NextResponse.json({ ok: false, faults: result.faults }, { status: 422 });

  // The Temporary Password crosses the wire exactly once, in the response to the
  // request that generated it. Nothing stores it and no later request can ask
  // for it again — `no-store` so no cache between here and the screen keeps a
  // copy of a password in plain text.
  return NextResponse.json(
    {
      ok: true,
      student: { id: result.student.id, username: result.student.username },
      temporaryPassword: result.temporaryPassword,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
