// Saving a Draft. Appends; never overwrites, and never touches what a Student
// reads — that only happens through the publish endpoint beside this one.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { openDraft, saveDraft } from '../../../../../../admin/drafts.ts';
import { parseLessonDocument } from '../../../../../../content/lesson-document.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const lessonId = idFromParam((await params).lessonId);
  if (lessonId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // The whole Lesson, Exercises included — the shape ADR 0004 settles, and the
  // shape Refinement will exchange every turn. A body that is not that shape at
  // all is malformed; one that is that shape and breaks a rule is a fault the
  // Admin can read, and comes back below rather than as a parse failure that
  // throws away everything they typed.
  const document = parseLessonDocument(await request.json().catch(() => null));
  if (document === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const open = openDraft(db, lessonId);
  if (!open) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const saved = saveDraft(db, { lessonId, studentId: student.id, document });
  if (!saved.ok) {
    // 422, not 400: the request was understood, and the Admin is told which
    // Exercise is at fault rather than that their save "failed".
    return NextResponse.json({ ok: false, reason: 'invalid', faults: saved.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, draftId: saved.draft.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
