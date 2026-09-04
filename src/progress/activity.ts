// When a Student was working, Lesson by Lesson.
//
// A different question from `report.ts`'s — that one answers *how far*, this one
// answers *when* — and it exists because the span pickers on the progress screen
// grew a calendar. «Покажи ошибки за ту неделю в сентябре» is a question about
// dates, and nothing in the progress data could answer it: a Lesson knew how
// many of its Exercises were behind the Student and not one moment at which any
// of that happened.
//
// Read off `submissions.created_at`, which is the only timestamp there is on the
// Student's side of a Lesson. A Reveal writes a Submission too, so a Lesson
// finished entirely with help still has dates — which matters, because that is
// exactly the stretch a person goes back to look at.
//
// A Lesson with no Submissions is absent rather than present with nulls. The
// caller is a filter; "not in the list" and "no dates" are the same answer, and
// only one of them can be got wrong.

import { and, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { exercises, exerciseSets, lessons, submissions } from '../db/schema.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** The first and last moment a Student answered anything in one Lesson. */
export type LessonActivity = {
  lessonId: number;
  /** Epoch milliseconds, so the browser can compare them without parsing. */
  firstAt: number;
  lastAt: number;
};

/**
 * Every Lesson of the Course this Student has answered anything in, with the
 * span of moments they did it over.
 *
 * Test answers are excluded by the join rather than by a filter: this walks
 * `lessons` inwards, and a Test's Exercise Set is owned by the Test, so its rows
 * have nowhere to arrive from. That is the same line `errorsByLesson` draws, and
 * for the same reason — a span of Lessons is a span of Lessons. It is why this
 * one query does not go through `ownedByCourse`, which exists for the queries
 * that want both halves.
 */
export function lessonActivity(db: Db, studentId: number, courseId: number): LessonActivity[] {
  return db.select({
    lessonId: lessons.id,
    // Read as raw integers rather than through the column's `timestamp_ms`
    // mapping: an aggregate is not the column, and the browser wants a number to
    // compare against a chosen day either way.
    firstAt: sql<number>`min(${submissions.createdAt})`,
    lastAt: sql<number>`max(${submissions.createdAt})`,
  })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    .innerJoin(lessons, eq(lessons.id, exerciseSets.lessonId))
    .where(and(eq(submissions.studentId, studentId), eq(lessons.courseId, courseId)))
    .groupBy(lessons.id)
    .all()
    // A group with rows always has both aggregates, so this drops nothing in
    // practice — it is here because a number has to be returned and a null
    // coerced to a date is 1970, which is a date the calendar would draw.
    .filter((row) => row.firstAt !== null && row.lastAt !== null);
}
