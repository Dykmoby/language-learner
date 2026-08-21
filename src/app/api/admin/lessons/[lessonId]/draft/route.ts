// Saving a Draft. Appends; never overwrites, and never touches what a Student
// reads — that only happens through the publish endpoint beside this one.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { currentStudent } from '../../../../../../auth/current-student.ts';
import { openDraft, saveDraft } from '../../../../../../admin/drafts.ts';
import { parseLessonTheory } from '../../../../../../content/lesson-document.ts';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
): Promise<Response> {
  // The middleware has already turned away anyone without a session, and the
  // pages 404 for a non-Admin. This is the same narrowing at the endpoint,
  // because an endpoint that relied on another layer having looked is an
  // endpoint anyone can call.
  const student = await currentStudent();
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  if (!student.isAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const lessonId = Number((await params).lessonId);
  if (!Number.isInteger(lessonId)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const theory = parseLessonTheory(await request.json().catch(() => null));
  if (theory === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const open = openDraft(db, lessonId);
  if (!open) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // The Exercises come from the document already on the server rather than from
  // the browser. Until the Exercise forms land there is nothing for a client to
  // say about them, and round-tripping them through the page would be a way to
  // lose them to a stale tab.
  const draft = saveDraft(db, {
    lessonId,
    studentId: student.id,
    document: { ...open.document, ...theory },
  });

  return NextResponse.json(
    { draftId: draft.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
