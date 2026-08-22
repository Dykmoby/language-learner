// Saving a Test: its title, its pass threshold and its Exercises, in one write.
//
// Unlike a Lesson there is no Draft between this and what a Student sees — a
// published Test changes when it is saved. What stands between an incoherent
// Exercise and a Student is the same thing that stands there in a Lesson: the
// validity rules, refusing the save and naming the Exercise at fault.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../admin/guard.ts';
import { saveTest } from '../../../../../admin/tests.ts';
import { parseTestDocument } from '../../../../../content/test-document.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ testId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const testId = idFromParam((await params).testId);
  if (testId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // A body that is not this shape at all is malformed; one that is this shape
  // and breaks a rule is a fault the Admin can read, and comes back below rather
  // than as a parse failure that throws away everything they typed.
  const document = parseTestDocument(await request.json().catch(() => null));
  if (document === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const saved = saveTest(getDatabase().db, testId, document);
  if (!saved.ok) {
    if (saved.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    // 422, not 400: the request was understood, and the Admin is told which
    // Exercise is at fault rather than that their save "failed".
    return NextResponse.json({ ok: false, reason: 'invalid', faults: saved.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, document: saved.document },
    { headers: { 'cache-control': 'no-store' } },
  );
}
