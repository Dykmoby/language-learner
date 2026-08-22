// Who may look at whose progress. Settled once, here, and nowhere else.
//
// The three statistics screens — where a Student stands, what they get wrong,
// and whether that is improving — show more and more of the same data. If each
// answered this question for itself they would eventually answer it differently,
// and the one that got it wrong would be the one nobody looked at.
//
// The rule: a Student sees their own. An Admin sees any Student's, because the
// Admin is the teacher, and a teacher who cannot see where a Student is stuck is
// being asked to teach blind.
//
// Everything else is a 404. Not a "forbidden": a Course a Student is not enrolled
// in is not theirs to learn the existence of, and neither is another Student's
// record — the same answer the rest of the application gives.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, enrollments, students, type CourseRow, type StudentRow,
} from '../db/schema.ts';
import { isEnrolled } from '../practice/lessons.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type ProgressView = {
  /** Whose record this is. Not necessarily the viewer. */
  student: StudentRow;
  course: CourseRow;
  /** True where an Admin is looking at somebody else's — the screen must say so. */
  onBehalf: boolean;
};

/**
 * Resolves whose progress is being asked for, and whether this viewer may have it.
 *
 * `requested` is the Student named in the address, or null for "my own". A
 * Student naming themselves is the same as naming nobody; a Student naming
 * anyone else is refused whether or not that Student exists, so the refusal
 * leaks nothing.
 */
export function resolveProgressView(
  db: Db,
  viewer: StudentRow,
  courseId: number,
  requested: number | null,
): ProgressView | null {
  const targetId = requested ?? viewer.id;

  // Checked before the row is read, so a non-Admin cannot learn whether an
  // account exists by the shape of the refusal.
  if (targetId !== viewer.id && !viewer.isAdmin) return null;

  const student = targetId === viewer.id
    ? viewer
    : db.select().from(students).where(eq(students.id, targetId)).get();
  if (!student) return null;

  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  // The *viewed* Student's Enrollment, never the viewer's: an Admin is not
  // necessarily enrolled in the Course they are teaching, and a record of a
  // Course nobody is enrolled in is a record of nothing.
  if (!isEnrolled(db, student.id, courseId)) return null;

  return { student, course, onBehalf: student.id !== viewer.id };
}

/**
 * Every Student an Admin can open a record for *in this Course*.
 *
 * Enrolled Students only, and that is the same rule the resolver above applies:
 * offering a name whose record is a 404 is offering a dead end, and an Admin
 * clicking one would reasonably read the refusal as a fault rather than as the
 * Student not being in the Course.
 */
export function studentsInCourse(db: Db, courseId: number): StudentRow[] {
  return db.select({ student: students })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.courseId, courseId))
    .orderBy(students.username)
    .all()
    .map((row) => row.student);
}
