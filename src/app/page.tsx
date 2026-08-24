// Where signing in lands, and nothing else.
//
// It renders no screen of its own. A Student who was working somewhere is put
// back there — that is what a Current Course is for — and a Student who was not
// is sent to their Courses. Both are redirects, so there is exactly one screen
// that lists Courses rather than two that have to be kept saying the same thing.
//
// This is also why the header points at `/courses` and never at `/`: a way back
// that redirects into the Course you were trying to leave is not a way back.

import { redirect } from 'next/navigation';
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
  // A Course they are no longer enrolled in is ignored rather than 404ing them
  // on their own home page.
  const current = enrolledCourses(db, student.id)
    .find((course) => course.id === student.currentCourseId);

  redirect(current ? `/courses/${current.id}` : '/courses');
}
