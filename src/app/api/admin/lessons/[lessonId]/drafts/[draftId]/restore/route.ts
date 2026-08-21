// Restoring a Draft: appending an earlier version as a new one.
//
// It deletes nothing and it publishes nothing. Those two facts are what make the
// history safe to browse — a restore that truncated would let an Admin destroy
// work by clicking around, and one that published would change what a Student
// reads without anyone deciding to.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../../../admin/guard.ts';
import { restoreDraft } from '../../../../../../../../admin/drafts.ts';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string; draftId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const { lessonId: rawLesson, draftId: rawDraft } = await params;
  const lessonId = idFromParam(rawLesson);
  const draftId = idFromParam(rawDraft);
  if (lessonId === null || draftId === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { db } = getDatabase();
  const result = restoreDraft(db, { lessonId, draftId, studentId: student.id });
  if (!result.ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json(
    { ok: true, draftId: result.draft.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
