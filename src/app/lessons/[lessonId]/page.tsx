// Theory: the Lesson's explanation, rendered as formatted text rather than as
// raw markdown, and a control into the Practice.
//
// The markdown is rendered server-side by a renderer that escapes everything
// before it writes a single tag, which is why setting it as HTML here is safe
// (see src/content/markdown.ts).

import { forbidden, notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { getDatabase } from '../../../db/index.ts';
import { openLesson, rememberCurrentCourse } from '../../../practice/lessons.ts';
import { renderTheory } from '../../../content/markdown.ts';

export const dynamic = 'force-dynamic';

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const { db } = getDatabase();
  const opened = openLesson(db, student.id, Number((await params).lessonId));

  // Typing the URL of a locked Lesson gets the same refusal as clicking a link
  // that is not there — a guard that only hides a link is not a guard.
  if (!opened.ok) {
    if (opened.reason === 'locked') forbidden();
    notFound();
  }

  rememberCurrentCourse(db, student.id, opened.course.id);

  return (
    <main>
      {/* No Course breadcrumb: the header names the open Course and links back
          to it on every screen, and a Student may only be here at all if they
          are enrolled in it. */}
      <h1>{opened.lesson.title}</h1>
      <p className="muted">{ru.lesson.grammarFocus}: {opened.lesson.grammarFocus}</p>

      <article className="theory" dangerouslySetInnerHTML={{ __html: renderTheory(opened.lesson.theoryMarkdown) }} />

      <p className="actions">
        <a className="button" href={`/lessons/${opened.lesson.id}/practice`}>{ru.lesson.toPractice}</a>
      </p>
      <p><a href={`/courses/${opened.course.id}`}>{ru.lesson.backToCourse}</a></p>
    </main>
  );
}
