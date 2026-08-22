// The Course: its Lessons in order, each showing whether it is open, in
// progress or finished. Working here records the Course as the Current Course,
// which is what makes the next sign-in land straight back in it.

import { notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { getDatabase } from '../../../db/index.ts';
import { courseOutline, enrolledCourses, rememberCurrentCourse } from '../../../practice/lessons.ts';
import { courseTests } from '../../../tests/taking.ts';
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
  // Published Tests only, and listed apart from the Lessons: a Test gates
  // nothing, so it does not belong in a list whose order is what unlocks what.
  const tests = courseTests(db, student.id, course.id);

  return (
    <main>
      <h1>{course.title}</h1>
      <p className="muted">{course.level} · {ru.courses.lessonCount(outline.length)}</p>

      <h2>{ru.course.lessonsTitle}</h2>
      <ol className="lessons">
        {outline.map(({ lesson, unlocked, complete, progress }) => (
          <li key={lesson.id} className={unlocked ? undefined : 'locked'}>
            {unlocked ? (
              <a href={`/lessons/${lesson.id}`}>{lesson.title}</a>
            ) : (
              <span>{lesson.title}</span>
            )}
            <span className="muted">
              {' — '}
              {!unlocked
                ? ru.course.locked
                : complete
                  ? ru.course.complete
                  : `${ru.course.inProgress}: ${progress.counts.completed + progress.counts.completedWithHelp}/${progress.counts.total}`}
            </span>
          </li>
        ))}
      </ol>

      <h2>{ru.test.sectionTitle}</h2>
      <CourseTests
        tests={tests.map(({ test, exerciseCount, attempts }) => ({
          id: test.id,
          title: test.title,
          exerciseCount,
          attempts,
        }))}
      />

      <p><a href="/">{ru.course.back}</a></p>
    </main>
  );
}
