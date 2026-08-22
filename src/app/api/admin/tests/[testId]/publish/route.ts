// Publishing a Test: the deliberate act that makes it something a Student can
// open. Everything it checks is checked against the rows rather than against
// whatever a form happened to send, because this is the last point before a
// Student sits down to it.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { publishTest } from '../../../../../../admin/tests.ts';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ testId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const testId = idFromParam((await params).testId);
  if (testId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = publishTest(getDatabase().db, testId);
  if (result.ok) return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });

  if (result.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // 409, not 422: nothing is wrong with the Test — it is already live, and the
  // browser is a step behind.
  if (result.reason === 'already_published') {
    return NextResponse.json({ ok: false, reason: 'already_published', faults: [] }, { status: 409 });
  }
  return NextResponse.json({ ok: false, reason: 'invalid', faults: result.faults }, { status: 422 });
}
