// One Course, and the Lessons in it in position order.
//
// A Lesson is listed whether or not a Student could open it: sequential
// unlocking is a rule about studying, not about authoring, and an unpublished
// Lesson is exactly what an Admin came here to work on.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { requireAdmin } from '../../../../admin/guard.ts';
import { getDatabase } from '../../../../db/index.ts';
import { adminCourse, courseRoster } from '../../../../admin/catalogue.ts';
import { adminCourseTests } from '../../../../admin/tests.ts';
import { CourseAdmin } from './course-admin.tsx';

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
      <div className="pageHead">
        <div>
          <h1>{course.title}</h1>
          <p className="facts">
            <span>{ru.languages[course.language] ?? course.language}</span>
            <span>{course.level}</span>
            <span>{ru.admin.graderModel(course.graderModel)}</span>
          </p>
        </div>
        <p className="actions">
          {/* Reached from the Course rather than from the dashboard: what it
              changes is this Course, and an Admin who wants it is already
              looking at one. */}
          <a className="button" href={`/admin/courses/${course.id}/settings`}>{ru.admin.settingsLink}</a>
          {/* Plain link rather than a control: the response is a file, and the
              browser already knows what to do with one. */}
          <a href={`/api/admin/courses/${course.id}/export`}>{ru.transfer.exportCourse}</a>
        </p>
      </div>

      <CourseAdmin
        courseId={course.id}
        initialLessons={lessons.map(({ lesson, exerciseCount, publication }) => ({
          id: lesson.id,
          title: lesson.title,
          exerciseCount,
          publication,
        }))}
        initialTests={adminCourseTests(db, course.id).map(({ test, exerciseCount }) => ({
          id: test.id,
          title: test.title,
          exerciseCount,
          published: test.publishedAt !== null,
        }))}
        initialRoster={courseRoster(db, course.id).map(({ student, enrolled }) => ({
          id: student.id,
          username: student.username,
          enrolled,
        }))}
      />

      <p className="muted">{ru.transfer.exportHint}</p>
    </main>
  );
}
