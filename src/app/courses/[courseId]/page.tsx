// The Course: its Lessons in order, each showing whether it is untouched, in
// progress or finished. Every one of them is open — sequential unlocking left in
// issue #98. Working here records the Course as the Current Course, which is
// what makes the next sign-in land straight back in it.
//
// Both lists are drawn by client components rather than here, because both carry
// a toggle whose state lives in the browser (issue #99). What stays on the
// server is the reading: what a Student may see is decided where the query is.

import { notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { getDatabase } from '../../../db/index.ts';
import { courseOutline, enrolledCourses, rememberCurrentCourse } from '../../../practice/lessons.ts';
import { courseTests } from '../../../tests/taking.ts';
import { courseProgress } from '../../../progress/report.ts';
import { CourseLessons } from './lessons.tsx';
import { CourseTests } from './tests.tsx';

export const dynamic = 'force-dynamic';

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const courseId = Number((await params).courseId);
  const { db } = getDatabase();

  // A Course the Student is not enrolled in does not exist as far as they are
  // concerned — the same answer as one that really does not.
  const course = enrolledCourses(db, student.id).find((c) => c.id === courseId);
  if (!course) notFound();

  rememberCurrentCourse(db, student.id, course.id);
  const outline = courseOutline(db, student.id, course.id);
  const report = courseProgress(db, student.id, course.id);
  // Published Tests only, and listed apart from the Lessons: a Test is owned by
  // the Course rather than by any Lesson, and a list of Lessons is not where a
  // Student goes looking for one.
  const tests = courseTests(db, student.id, course.id);

  return (
    <main>
      <div className="pageHead">
        <div>
          <h1>{course.title}</h1>
          <p className="facts">
            <span>{course.level}</span>
            <span>{ru.courses.lessonCount(outline.length)}</span>
          </p>
        </div>
        {/* The one number that answers "how is this going", beside a way to the
            screen that answers it properly. The way there is drawn as a control
            rather than as a run of underlined text: it is the only thing on this
            card that does anything, and a word that has to be aimed at is not
            how anything else in this application offers an action. Quiet rather
            than filled, because the number is what this card is for. */}
        <div className="figure">
          <span>
            <span className="big">{ru.progress.percent(report.course.percent)}</span>
            <span className="under">{ru.progress.courseTotal}</span>
          </span>
          <a className="button secondary" href={`/courses/${course.id}/progress`}>{ru.progress.link}</a>
        </div>
      </div>

      {/* One section, one frame: the Lessons and the Tests are two lists about
          two different things, and a heading between them was the only thing
          saying where one stopped. */}
      <div className="sections">
      <section className="panel">
        <CourseLessons
          lessons={outline.map(({ lesson, complete, progress }, index) => ({
            id: lesson.id,
            number: index + 1,
            title: lesson.title,
            complete,
            counts: progress.counts,
          }))}
        />
      </section>

      <section className="panel">
        <CourseTests
          tests={tests.map(({ test, exerciseCount, attempts }) => ({
            id: test.id,
            title: test.title,
            exerciseCount,
            attempts,
          }))}
        />
      </section>
      </div>
      {/* No back-link. The navigation column carries the way out, and this one
          pointed at the home screen — which redirects to the Current Course, and
          working in a Course is what makes it the Current Course, so it led
          back here. */}
    </main>
  );
}
