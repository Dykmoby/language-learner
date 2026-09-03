// A Course's settings — issue #75.
//
// Before this screen a Course was created once and then fixed: a mistyped title
// stayed mistyped, and an Admin who wanted a different Grader model after seeing
// how a Course grades had nowhere to say so.
//
// Two of the four facts a Course carries are shown and not offered. The Language
// and the CEFR level are baked into every Lesson already written and into every
// Generation that produced one; changing the Language would leave a Course whose
// content is in one language and whose Grader judges another, and that surfaces
// as a stream of meaningless Verdicts rather than as an error. They are on the
// screen because an Admin came here to look at what this Course is.

import { notFound } from 'next/navigation';
import { ru } from '../../../../../ru.ts';
import { requireAdmin } from '../../../../../admin/guard.ts';
import { getDatabase } from '../../../../../db/index.ts';
import { adminCourse } from '../../../../../admin/catalogue.ts';
import { CourseSettingsForm } from './settings-form.tsx';

export const dynamic = 'force-dynamic';

export default async function CourseSettingsPage({ params }: { params: Promise<{ courseId: string }> }) {
  await requireAdmin();

  const courseId = Number((await params).courseId);
  const { db } = getDatabase();
  const found = Number.isInteger(courseId) ? adminCourse(db, courseId) : null;
  if (!found) notFound();

  const { course } = found;

  return (
    <main>
      <div className="pageHead">
        <div>
          <p className="muted">
            <a href={`/admin/courses/${course.id}`}>{course.title}</a>
          </p>
          <h1>{ru.admin.settingsTitle}</h1>
        </div>
      </div>

      <CourseSettingsForm
        courseId={course.id}
        initialTitle={course.title}
        initialGraderModel={course.graderModel}
        initialGraderEffort={course.graderEffort}
        initialGraderInstruction={course.graderInstruction}
        language={ru.languages[course.language] ?? course.language}
        level={course.level}
      />

    </main>
  );
}
