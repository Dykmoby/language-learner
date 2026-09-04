// One Exercise of a Practice, by its place in the Set.
//
// The endpoint issue #95 needed. Moving between Exercises is a fetch rather than
// a page load because the Practice is one screen a Student works in for twenty
// minutes, and because the Exercise being opened is the only thing that changes
// — but it is a fetch to the server rather than a lookup in a list the page was
// handed, so a Reference Answer still only reaches a Student who has earned it.
//
// `current` is a position of its own: where the Student stands is derived from
// Submissions, and asking the browser to work it out would put a second copy of
// the derivation in the one place it must not be.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../../ru.ts';
import { currentStudent } from '../../../../../../auth/current-student.ts';
import { getDatabase } from '../../../../../../db/index.ts';
import { parseAt, practiceView } from '../../../../../../practice/exercise-view.ts';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string; at: string }> },
): Promise<Response> {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session. This is the
  // narrowing, and it is not redundant: a session can expire between the two.
  if (!student) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { lessonId: rawLesson, at: rawAt } = await params;
  const lessonId = Number(rawLesson);
  const at = parseAt(rawAt);
  if (!Number.isInteger(lessonId) || at === null) {
    return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });
  }

  const read = practiceView(getDatabase().db, student.id, lessonId, at);
  // A Lesson in a Course the Student is not enrolled in is missing rather than
  // forbidden, and so is a position that Practice does not have.
  if (!read.ok) return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });

  return NextResponse.json({ ok: true, view: read.view }, {
    headers: { 'cache-control': 'no-store' },
  });
}
