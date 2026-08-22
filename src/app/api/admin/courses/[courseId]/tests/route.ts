// Creating a Test on a Course.
//
// It arrives unpublished and empty, and stays invisible to every Student until
// someone deliberately publishes it — see `createTest`.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { createTest } from '../../../../../../admin/tests.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  if (typeof body?.title !== 'string') return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const created = createTest(getDatabase().db, { courseId, title: body.title });
  if (!created.ok) {
    // A Course that does not exist is a 404 rather than a form fault: there is
    // no field on the page that could be corrected to fix it.
    if (created.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: false, faults: created.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, testId: created.test.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
