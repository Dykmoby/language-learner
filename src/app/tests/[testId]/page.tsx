// A Test, as the Student sits down to it.
//
// The whole Test is on one screen, and what the browser is handed carries no
// Reference Answer and no accepted answers — the same rule the Practice keeps.
// Here it is load-bearing twice over: a Test gives no feedback until it is
// submitted, and an answer key in the page source would be feedback.

import { notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { getDatabase } from '../../../db/index.ts';
import { openTest } from '../../../tests/taking.ts';
import { rememberCurrentCourse } from '../../../practice/lessons.ts';
import { TestShell } from './test-shell.tsx';

export const dynamic = 'force-dynamic';

export default async function TestPage({ params }: { params: Promise<{ testId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const testId = Number((await params).testId);
  const { db } = getDatabase();
  const opened = Number.isInteger(testId) ? openTest(db, student.id, testId) : { ok: false } as const;
  if (!opened.ok) notFound();

  rememberCurrentCourse(db, student.id, opened.course.id);

  return (
    <main>
      <p className="muted"><a href={`/courses/${opened.course.id}`}>{opened.course.title}</a></p>
      <h1>{opened.test.title}</h1>
      <p className="muted">
        {ru.test.exerciseCount(opened.exercises.length)}
        {' · '}{ru.test.threshold(opened.test.passThreshold)}
      </p>
      <p className="muted">{ru.test.noFeedbackUntilSubmit}</p>
      <p className="muted">{ru.test.gatesNothing}</p>

      <TestShell
        testId={opened.test.id}
        exercises={opened.exercises}
        attempts={opened.attempts}
        courseId={opened.course.id}
      />
    </main>
  );
}
