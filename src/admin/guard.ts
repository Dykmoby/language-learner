// The Admin narrowing, in one place.
//
// The middleware has already turned away anyone without a session; this is the
// second, narrower check on top of it. Refusing with a 404 rather than a
// "forbidden" screen is the choice the health check already made, and it holds
// for the whole Admin section: a 404 says nothing about what is behind it, and
// a Student who is not an Admin should not learn that an authoring surface
// exists at all.

import { notFound } from 'next/navigation';
import { currentStudent } from '../auth/current-student.ts';
import type { StudentRow } from '../db/schema.ts';

export async function requireAdmin(): Promise<StudentRow> {
  const student = await currentStudent();
  if (!student?.isAdmin) notFound();
  return student;
}
