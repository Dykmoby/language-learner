// Publishing a Draft: the deliberate second step that moves a Draft into the
// Lesson a Student reads.
//
// design.md § Authoring — a generated Draft must never publish unreviewed. The
// document is checked here even though the same rules ran when it was saved,
// because a Draft can be saved by one path and published by another, and this is
// the last point before a Student sees it.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { currentStudent } from '../../../../../../auth/current-student.ts';
import { findDraft, latestDraft, publishDraft } from '../../../../../../admin/drafts.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const student = await currentStudent();
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!student.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const lessonId = Number((await params).lessonId);
  if (!Number.isInteger(lessonId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { draftId?: unknown } | null;
  const { db } = getDatabase();

  // A named Draft is published; without one, the newest. Naming it is what lets
  // the editor publish exactly what it just saved rather than whatever happens
  // to be newest by the time the request lands.
  const draft = typeof body?.draftId === 'number'
    ? findDraft(db, body.draftId)
    : latestDraft(db, lessonId);

  // A Draft belonging to some other Lesson is not publishable through this
  // Lesson's endpoint, whatever id the browser sent. Answered as 404 rather than
  // 403: which Drafts exist elsewhere is not this request's business.
  if (draft === null || draft.lessonId !== lessonId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const result = publishDraft(db, draft.id);
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 422;
    return NextResponse.json(
      { ok: false, faults: result.reason === 'invalid' ? result.faults : [] },
      { status },
    );
  }

  return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
