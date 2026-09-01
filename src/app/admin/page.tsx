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
      <h1>{ru.admin.title}</h1>

      <HealthBanner standing={health} />

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

      <h2>{ru.transfer.importTitle}</h2>
      <ImportCourseForm />

      <p className="actions">
        <a href="/admin/students">{ru.admin.accountsLink}</a>
      </p>
      <p className="actions">
        <a href="/admin/disputes">{ru.disputeReview.link}</a>
      </p>
      <p className="actions">
        <a href="/admin/health">{ru.admin.healthLink}</a>
      </p>
    </main>
  );
}
