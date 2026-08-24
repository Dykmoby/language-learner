// Which Course the screen being rendered is about.
//
// The header needs this and cannot be given it: it wraps every signed-in screen
// from the root layout, which receives no route parameters. So it reads the path
// the request was made for — set on the request by the middleware, which is the
// one place that certainly knows it — and resolves the Course from there.
//
// The Current Course would have been the easy answer and the wrong one. It is
// written by the Course screen while that screen renders, and a layout is not
// guaranteed to see that write; a Student moving from one Course to another
// would have been shown the name of the one they just left, on exactly the
// navigation the header exists to make possible. It is kept only as the fallback
// for screens that are about no Course at all.
//
// The path arrives from a header, so it is treated as a claim rather than as a
// fact: whatever it names, enrolment is checked before a title is shown.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../../db/schema.ts';
import { lessons, tests, type CourseRow, type StudentRow } from '../../db/schema.ts';
import { enrolledCourses } from '../../practice/lessons.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** The header the middleware puts the request path in. */
export const PATHNAME_HEADER = 'x-pathname';

function idFrom(pathname: string, segment: string): number | null {
  const match = new RegExp(`^/${segment}/(\\d+)(?:/|$)`).exec(pathname);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/** The Course a path is inside, before enrolment is considered. */
function claimedCourseId(db: Db, pathname: string, student: StudentRow): number | null {
  const courseId = idFrom(pathname, 'courses');
  if (courseId !== null) return courseId;

  const lessonId = idFrom(pathname, 'lessons');
  if (lessonId !== null) {
    return db.select({ courseId: lessons.courseId }).from(lessons)
      .where(eq(lessons.id, lessonId)).get()?.courseId ?? null;
  }

  const testId = idFrom(pathname, 'tests');
  if (testId !== null) {
    return db.select({ courseId: tests.courseId }).from(tests)
      .where(eq(tests.id, testId)).get()?.courseId ?? null;
  }

  // Nothing in the path names a Course — the Courses list, the Admin section,
  // a 404. Fall back to where the Student was last working, which is the honest
  // answer to "which Course is open" when the screen is about none of them.
  return student.currentCourseId;
}

/**
 * The Course to name in the header, or null where there is none to name.
 *
 * Enrolment is the last word. An Admin browsing the authoring screens for a
 * Course they are not enrolled in is not working in it, and a path naming
 * somebody else's Course names nothing.
 */
export function openCourse(db: Db, student: StudentRow, pathname: string): CourseRow | null {
  const claimed = claimedCourseId(db, pathname, student);
  if (claimed === null) return null;
  return enrolledCourses(db, student.id).find((course) => course.id === claimed) ?? null;
}
