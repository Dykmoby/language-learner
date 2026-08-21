// One Course, and the Lessons in it in position order.
//
// A Lesson is listed whether or not a Student could open it: sequential
// unlocking is a rule about studying, not about authoring.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { requireAdmin } from '../../../../admin/guard.ts';
import { getDatabase } from '../../../../db/index.ts';
import { adminCourse } from '../../../../admin/catalogue.ts';

export const dynamic = 'force-dynamic';

export default async function AdminCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  await requireAdmin();

  const courseId = Number((await params).courseId);
  const { db } = getDatabase();
  const found = Number.isInteger(courseId) ? adminCourse(db, courseId) : null;
  if (!found) notFound();

  const { course, lessons } = found;

  return (
    <main>
      <h1>{course.title}</h1>
      <p className="muted">
        {ru.languages[course.language] ?? course.language}
        {' · '}{course.level}
        {' · '}{ru.admin.graderModel(course.graderModel)}
      </p>

      <h2>{ru.admin.lessonsTitle}</h2>
      {lessons.length === 0 ? (
        <p className="muted">{ru.admin.noLessons}</p>
      ) : (
        <ol className="lessons">
          {lessons.map(({ lesson, exerciseCount, publication }) => (
            <li key={lesson.id}>
              <a href={`/admin/lessons/${lesson.id}`}>{lesson.title}</a>
              <span className="muted">
                {' — '}
                {publication === 'published' ? ru.admin.published : ru.admin.unpublishedChanges}
                {' · '}{ru.admin.exerciseCount(exerciseCount)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p><a href="/admin">{ru.admin.back}</a></p>
    </main>
  );
}
