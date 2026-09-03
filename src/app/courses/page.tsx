// Every Course this Student is enrolled in.
//
// This is where `/` sends somebody who has nowhere in particular to be, and it
// is what the navigation column's application name points at. It has to be a
// screen in its own right rather than a branch of the home screen: the home
// screen redirects a Student who has a Current Course straight into that Course,
// which is the whole point of a Current Course — so a "back to my Courses" link
// aimed at `/` would land on the Course it was trying to leave.

import { redirect } from 'next/navigation';
import { ru } from '../../ru.ts';
import { currentStudent } from '../../auth/current-student.ts';
import { getDatabase } from '../../db/index.ts';
import { enrolledCourses } from '../../practice/lessons.ts';
import { courseProgress } from '../../progress/report.ts';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session; this is the
  // narrowing, not a second gate.
  if (!student) redirect('/login');

  const { db } = getDatabase();
  const courses = enrolledCourses(db, student.id);
  // A card says how far along the Course is, which is the one thing that decides
  // which of two Courses to open. Read per Course rather than for all of them at
  // once because a Student holds two or three, not two hundred.
  const standing = courses.map((course) => ({
    course,
    progress: courseProgress(db, student.id, course.id),
  }));

  return (
    <main>
      <div className="pageHead">
        <div>
          <h1>{ru.courses.title}</h1>
          <p className="muted">
            {ru.home.signedInAs(student.username)}
            {student.isAdmin ? <> <strong>{ru.home.adminBadge}</strong></> : null}
          </p>
        </div>
      </div>

      {courses.length === 0 ? (
        <p className="muted">{ru.courses.none}</p>
      ) : (
        <ul className="cardGrid">
          {standing.map(({ course, progress }) => (
            <li key={course.id}>
              <a className="title" href={`/courses/${course.id}`}>{course.title}</a>
              <p className="facts">
                <span>{ru.languages[course.language] ?? course.language}</span>
                <span>{course.level}</span>
                <span>{ru.courses.lessonCount(progress.lessons.length)}</span>
              </p>
              <div className="foot">
                {/* The Course's own bar, one segment per Lesson rather than per
                    Exercise: at a card's width a Lesson is the unit that can
                    still be told apart. */}
                <ol className="progress" aria-label={ru.progress.title}>
                  {progress.lessons.map((lesson) => (
                    <li
                      key={lesson.lessonId}
                      className={lesson.percent === 100 ? 'segment state-correct' : 'segment'}
                      aria-label={`${lesson.title} — ${ru.progress.percent(lesson.percent)}`}
                      title={`${lesson.title} — ${ru.progress.percent(lesson.percent)}`}
                    />
                  ))}
                </ol>
                <span className="muted">{ru.progress.percent(progress.course.percent)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
