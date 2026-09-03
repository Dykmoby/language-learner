// The Admin section: the spine everything authoring hangs off.
//
// Every Course in the system, not merely the ones this Admin is enrolled in —
// which is the whole reason this reads through its own module rather than the
// Student's — and the form that creates another one.

import { ru } from '../../ru.ts';
import { requireAdmin } from '../../admin/guard.ts';
import { getDatabase } from '../../db/index.ts';
import { everyCourse } from '../../admin/catalogue.ts';
import { currentHealthStanding } from '../../ops/health-history.ts';
import { NewCourseForm } from './new-course.tsx';
import { ImportCourseForm } from './import-course.tsx';
import { HealthBanner } from './health-banner.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireAdmin();

  const { db } = getDatabase();
  const catalogue = everyCourse(db);
  // Read, never run: rendering the dashboard must not spend a Grader call, which
  // is the whole reason the result is recorded rather than produced on demand.
  const health = currentHealthStanding(db);

  return (
    <main>
      <div className="pageHead">
        <div><h1>{ru.admin.coursesTitle}</h1></div>
      </div>

      <HealthBanner standing={health} />

      {catalogue.length === 0 ? (
        <p className="muted">{ru.admin.noCourses}</p>
      ) : (
        <ul className="cardGrid">
          {catalogue.map(({ course, lessonCount }) => (
            <li key={course.id}>
              <a className="title" href={`/admin/courses/${course.id}`}>{course.title}</a>
              <p className="facts">
                <span>{ru.languages[course.language] ?? course.language}</span>
                <span>{course.level}</span>
                <span>{ru.courses.lessonCount(lessonCount)}</span>
              </p>
              <span className="foot muted">{ru.admin.graderModel(course.graderModel)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The four section links this screen used to end with are in the
          navigation column now, where they are reachable from inside a Lesson
          rather than only from here. */}
      <div className="sideBySide">
        <div className="main panel">
          <h2>{ru.admin.newCourseTitle}</h2>
          <NewCourseForm />
        </div>
        <div className="side panel">
          <h2>{ru.transfer.importTitle}</h2>
          <ImportCourseForm />
        </div>
      </div>
    </main>
  );
}
