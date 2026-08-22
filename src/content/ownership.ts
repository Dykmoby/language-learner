// Which Course an Exercise Set belongs to.
//
// An Exercise Set is owned by exactly one of a Lesson's Practice and a Test —
// never both, never neither, and the check constraint on `exercise_sets` is what
// makes that true rather than a hope. So a query that starts anywhere below an
// Exercise reaches a Course through one of two columns, and every such query
// walks the same two joins and asks the same two-branch question.
//
// It lives here, once, because the alternative is what it replaced: the identical
// join and the identical comment written out in each module that needed it, free
// to drift apart one edit at a time.

import { or, eq, type SQL } from 'drizzle-orm';
import { lessons, tests } from '../db/schema.ts';

/**
 * The predicate for "this Exercise Set belongs to that Course", for a query that
 * has already left-joined both `lessons` and `tests` onto the Set.
 *
 * Both branches are needed and neither is redundant: dropping the Test branch is
 * how a Test's rows come to be quietly omitted from a Student's record.
 */
export function ownedByCourse(courseId: number): SQL | undefined {
  return or(eq(lessons.courseId, courseId), eq(tests.courseId, courseId));
}

/**
 * The Course id from the two nullable columns those joins produce.
 *
 * Exactly one is present, so the fallback is unreachable — it is here because a
 * number has to be returned and inventing a zero silently is worse than
 * returning one that no Course will ever match.
 */
export function courseIdOf(lessonCourseId: number | null, testCourseId: number | null): number {
  return lessonCourseId ?? testCourseId ?? 0;
}
