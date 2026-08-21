// The Admin section: the spine everything authoring hangs off.
//
// Every Course in the system, not merely the ones this Admin is enrolled in —
// which is the whole reason this reads through its own module rather than the
// Student's — and the form that creates another one.

import { ru } from '../../ru.ts';
import { requireAdmin } from '../../admin/guard.ts';
import { getDatabase } from '../../db/index.ts';
import { everyCourse } from '../../admin/catalogue.ts';
import { NewCourseForm } from './new-course.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireAdmin();

  const { db } = getDatabase();
  const catalogue = everyCourse(db);

  return (
    <main>
      <h1>{ru.admin.title}</h1>

      <h2>{ru.admin.coursesTitle}</h2>
      {catalogue.length === 0 ? (
        <p className="muted">{ru.admin.noCourses}</p>
      ) : (
        <ul className="cards">
          {catalogue.map(({ course, lessonCount }) => (
            <li key={course.id}>
              <a href={`/admin/courses/${course.id}`}>{course.title}</a>
              <span className="muted">
                {' — '}
                {ru.languages[course.language] ?? course.language}
                {' · '}{course.level}
                {' · '}{ru.courses.lessonCount(lessonCount)}
              </span>
              <br />
              <span className="muted">{ru.admin.graderModel(course.graderModel)}</span>
            </li>
          ))}
        </ul>
      )}

      <h2>{ru.admin.newCourseTitle}</h2>
      <NewCourseForm />

      <p className="actions">
        <a href="/admin/health">{ru.admin.healthLink}</a>
      </p>
      <p><a href="/">{ru.admin.home}</a></p>
    </main>
  );
}
