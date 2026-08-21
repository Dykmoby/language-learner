// The Admin narrowing, in one place.
//
// The middleware has already turned away anyone without a session; this is the
// second, narrower check on top of it. Refusing with a 404 rather than a
// "forbidden" screen is the choice the health check already made, and it holds
// for the whole Admin section: a 404 says nothing about what is behind it, and
// a Student who is not an Admin should not learn that an authoring surface
// exists at all.

import { notFound } from 'next/navigation';
import { NextResponse } from 'next/server';
import { currentStudent } from '../auth/current-student.ts';
import type { StudentRow } from '../db/schema.ts';

/** For a page: a non-Admin is answered with a 404 by the framework. */
export async function requireAdmin(): Promise<StudentRow> {
  const student = await currentStudent();
  if (!student?.isAdmin) notFound();
  return student;
}

/**
 * For an endpoint, where `notFound()` is not available: the same narrowing, as a
 * value the route returns instead of throwing.
 *
 * The middleware has already turned away anyone without a session, so the 401
 * here is all but unreachable. All but: a session can expire between the two
 * checks, and an endpoint that relied on another layer having looked is an
 * endpoint anyone can call.
 */
export async function adminOrRefusal(): Promise<
  { student: StudentRow; refusal?: undefined } | { student?: undefined; refusal: NextResponse }
> {
  const student = await currentStudent();
  if (!student) {
    return { refusal: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  }
  if (!student.isAdmin) {
    return { refusal: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { student };
}

/** A path parameter that must name a row. Not a number is not found. */
export function idFromParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}
