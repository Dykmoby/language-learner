// Every Course this Student is enrolled in.
//
// This is where `/` sends somebody who has nowhere in particular to be, and it
// is what the header's way out points at. It has to be a screen in its own right
// rather than a branch of the home screen: the home screen redirects a Student
// who has a Current Course straight into that Course, which is the whole point
// of a Current Course — so a "back to my Courses" link aimed at `/` would land
// on the Course it was trying to leave.

import { redirect } from 'next/navigation';
import { ru } from '../../ru.ts';
import { currentStudent } from '../../auth/current-student.ts';
import { getDatabase } from '../../db/index.ts';
import { enrolledCourses } from '../../practice/lessons.ts';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session; this is the
  // narrowing, not a second gate.
  if (!student) redirect('/login');

  const { db } = getDatabase();
  const courses = enrolledCourses(db, student.id);

  return (
    <main>
      <h1>{ru.courses.title}</h1>
      <p className="muted">
        {ru.home.signedInAs(student.username)}
        {student.isAdmin ? <> <strong>{ru.home.adminBadge}</strong></> : null}
      </p>

      {courses.length === 0 ? (
        <p className="muted">{ru.courses.none}</p>
      ) : (
        <ul className="cards">
          {courses.map((course) => (
            <li key={course.id}>
              <a href={`/courses/${course.id}`}>{course.title}</a>
              <span className="muted"> — {ru.languages[course.language] ?? course.language} · {course.level}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
