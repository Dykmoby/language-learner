import { redirect } from 'next/navigation';
import { ru } from '../ru.ts';
import { currentStudent } from '../auth/current-student.ts';
import { getDatabase } from '../db/index.ts';
import { enrolledCourses } from '../practice/lessons.ts';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session; this is the
  // narrowing, not a second gate.
  if (!student) redirect('/login');

  const { db } = getDatabase();
  const courses = enrolledCourses(db, student.id);

  // Signing in lands the Student where they were working, not on a menu they
  // have to cross every visit. A Course they are no longer enrolled in is
  // ignored rather than 404ing them on their own home page.
  const current = courses.find((course) => course.id === student.currentCourseId);
  if (current) redirect(`/courses/${current.id}`);

  return (
    <main>
      <h1>{ru.appName}</h1>
      <p>
        {ru.home.signedInAs(student.username)}
        {student.isAdmin ? <> <strong>{ru.home.adminBadge}</strong></> : null}
      </p>

      <h2>{ru.courses.title}</h2>
      {courses.length === 0 ? (
        <p className="muted">{ru.courses.none}</p>
      ) : (
        <ul className="cards">
          {courses.map((course) => (
            <li key={course.id}>
              <a href={`/courses/${course.id}`}>{course.title}</a>
              <span className="muted"> — {course.level}</span>
            </li>
          ))}
        </ul>
      )}

      {student.isAdmin ? <p><a href="/admin">{ru.home.adminLink}</a></p> : null}
      <form method="post" action="/api/logout">
        <button type="submit">{ru.common.signOut}</button>
      </form>
    </main>
  );
}
