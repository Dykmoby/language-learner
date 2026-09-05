// Practice: one Exercise at a time, in whatever order the Student works it.
//
// One Exercise at a time on the wire as well as on the screen. The browser is
// handed the Exercise it opens on — the one the Student is up to — with the
// shape of the progress bar, and asks the server again for each Exercise it
// moves to. No Reference Answers, no accepted answers, and nothing about an
// Exercise that is not on screen: Reveal is a request, not a field that was
// sitting in the page all along, and that stays true now that every Exercise in
// the Practice can be reached (issue #95).

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { currentStudent } from '../../../../auth/current-student.ts';
import { getDatabase } from '../../../../db/index.ts';
import { practiceView } from '../../../../practice/exercise-view.ts';
import { nextLesson, openLesson, rememberCurrentCourse } from '../../../../practice/lessons.ts';
import { PracticeShell } from './shell.tsx';

export const dynamic = 'force-dynamic';

export default async function PracticePage({ params }: { params: Promise<{ lessonId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const { db } = getDatabase();
  const lessonId = Number((await params).lessonId);
  const opened = openLesson(db, student.id, lessonId);
  if (!opened.ok) notFound();

  rememberCurrentCourse(db, student.id, opened.course.id);

  // The Exercise the Student is up to, which on a finished Practice is the first
  // one: there is nothing left to work on and everything left to re-read.
  const read = practiceView(db, student.id, lessonId, 'current');
  if (!read.ok) notFound();

  const following = nextLesson(opened.outline, opened.lesson.id);

  return (
    <main>
      {/* No breadcrumb: the navigation column names the Course, lists its
          Lessons and marks which half of this one is open. A second copy of that
          across the top of the screen would be the same fact twice. */}
      <div className="pageHead">
        <div>
          <p className="muted">{ru.practice.title}</p>
          <h1>{opened.lesson.title}</h1>
        </div>
      </div>

      <PracticeShell
        lessonId={lessonId}
        initial={read.view}
        nextLessonId={following?.id ?? null}
        courseId={opened.course.id}
      />
    </main>
  );
}
