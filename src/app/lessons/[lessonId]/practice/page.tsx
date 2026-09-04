// Practice: one Exercise at a time, in the Exercise Set's order.
//
// One Exercise at a time on the wire as well as on the screen — the browser is
// handed the Exercise being asked and the shape of the progress bar, and nothing
// else. No Reference Answers, no accepted answers, and no Exercise the Student
// has not reached: Reveal is a request, not a field that was sitting in the page
// all along.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { currentStudent } from '../../../../auth/current-student.ts';
import { getDatabase } from '../../../../db/index.ts';
import { nextLesson, openLesson, rememberCurrentCourse } from '../../../../practice/lessons.ts';
import { PracticeShell, type CurrentExercise, type Segment } from './shell.tsx';

export const dynamic = 'force-dynamic';

export default async function PracticePage({ params }: { params: Promise<{ lessonId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const { db } = getDatabase();
  const opened = openLesson(db, student.id, Number((await params).lessonId));
  if (!opened.ok) notFound();

  rememberCurrentCourse(db, student.id, opened.course.id);

  const segments: Segment[] = opened.progress.exercises.map((progress) => ({
    position: progress.position,
    state: progress.state,
  }));

  const currentProgress = opened.progress.exercises.find((p) => p.state === 'current');
  const currentRow = opened.exercises.find((e) => e.id === currentProgress?.exerciseId);

  const current: CurrentExercise | null = currentRow === undefined || currentProgress === undefined
    ? null
    : {
        id: currentRow.id,
        position: currentRow.position,
        kind: currentRow.kind,
        prompt: currentRow.prompt,
        choices: currentRow.choices,
        revealOffered: currentProgress.revealOffered,
      };

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
        current={current}
        segments={segments}
        counts={opened.progress.counts}
        nextLessonId={following?.id ?? null}
        courseId={opened.course.id}
      />
    </main>
  );
}
