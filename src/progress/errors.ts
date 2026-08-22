// What a Student gets wrong, counted. «Артикли — 14 ошибок».
//
// A query, not a deserialisation loop. Errors have been rows with an indexed
// Error Type since the progress schema landed, precisely so this could be a
// `group by`.
//
// Across every Submission the Student has made in the Course — a Lesson's
// Practice and a Test alike. The second half is true only because ADR 0005 put a
// Test's answers in the same table, and it is the half that matters most: a Test
// is where a Student writes at greatest length with no Progressive Hint to lean
// on, so its Errors are the most informative there are.
//
// **Grouped by the stable enum value within a Language, never by label.** The two
// enums share Russian words for different grammar — `plural_form` and
// `plural_form_tj` are both «Множественное число» — and a histogram that merged
// them would be adding up two different mistakes and calling the total a fact.
// The Russian label is resolved at display time, as it is everywhere else, which
// is why nothing here imports the dictionary.

import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  exercises, exerciseSets, lessons, submissionErrors, submissions, tests,
} from '../db/schema.ts';
import type { Language } from '../grader/contract.ts';
import { ownedByCourse } from '../content/ownership.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type ErrorCount = {
  /**
   * The stable enum string, exactly as it was stored. An Error Type outside the
   * enum is here as it came rather than dropped: the Grader is contractually
   * forbidden from inventing one and it is logged when it happens, but hiding it
   * would hide a real fault from the only person who could fix it.
   */
  type: string;
  /**
   * The Course's Language. Carried on every row so that a caller which ever
   * merges two Courses' histograms has to keep them apart to do it, rather than
   * having to remember to.
   */
  language: Language;
  count: number;
};

/** One Lesson's worth of Errors, for the chart over a span of Lessons. */
export type LessonErrorCounts = {
  lessonId: number;
  position: number;
  title: string;
  counts: ErrorCount[];
};

// The whole of the join, once: an Error belongs to a Submission, which answers an
// Exercise, which sits in an Exercise Set — and the Set names a Course through
// ../content/ownership.ts. Written here rather than in each query so the
// histogram and the per-Lesson counts cannot come to disagree about which Errors
// belong to a Course.
function errorsOfCourse(db: Db, studentId: number, courseId: number) {
  return db.select({
    type: submissionErrors.type,
    lessonId: exerciseSets.lessonId,
    testId: exerciseSets.testId,
  })
    .from(submissionErrors)
    .innerJoin(submissions, eq(submissions.id, submissionErrors.submissionId))
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    .leftJoin(lessons, eq(lessons.id, exerciseSets.lessonId))
    .leftJoin(tests, eq(tests.id, exerciseSets.testId))
    .where(and(eq(submissions.studentId, studentId), ownedByCourse(courseId)))
    .all();
}

/**
 * The order every list of Error Types is put in: largest count first, because the
 * question they all answer is what to work on next.
 *
 * Ties break on the stable enum value, so two reads of the same data come out in
 * the same order — a list that reshuffles on every reload is a list nobody
 * trusts, and a chart that does it is worse.
 *
 * Exported because the chart's span totals must be ordered the same way as the
 * histogram's, and two copies of a comparator is how two screens come to
 * disagree about which Error Type is the Student's worst.
 */
export function byCountThenType(a: ErrorCount, b: ErrorCount): number {
  return b.count - a.count || a.type.localeCompare(b.type);
}

/** Tallies rows by their stable Error Type, in that order. */
function tally(types: readonly string[], language: Language): ErrorCount[] {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);

  return [...counts]
    .map(([type, count]) => ({ type, language, count }))
    .sort(byCountThenType);
}

/**
 * Every Error this Student has collected in this Course, counted by Error Type.
 *
 * Scoped to a Course, which is what makes the Language single-valued: a Course
 * sits in one Language for its whole duration, so no row here can be added to a
 * row from the other enum.
 */
export function errorHistogram(
  db: Db,
  studentId: number,
  courseId: number,
  language: Language,
): ErrorCount[] {
  return tally(errorsOfCourse(db, studentId, courseId).map((row) => row.type), language);
}

/**
 * The same counts, split by the Lesson they were made in.
 *
 * Errors made in a Test belong to no Lesson and are absent here by construction —
 * a span of Lessons is a span of Lessons. They are counted in the histogram
 * above, which is the screen that claims to cover everything.
 */
export function errorsByLesson(
  db: Db,
  studentId: number,
  courseId: number,
  language: Language,
): LessonErrorCounts[] {
  const rows = errorsOfCourse(db, studentId, courseId)
    .filter((row) => row.lessonId !== null);

  const byLesson = new Map<number, string[]>();
  for (const row of rows) {
    const list = byLesson.get(row.lessonId!);
    if (list) list.push(row.type);
    else byLesson.set(row.lessonId!, [row.type]);
  }

  // Every published Lesson of the Course, in order — including the ones with no
  // Errors at all. A chart that dropped them would compress the gaps and draw a
  // line that says the Student improved in weeks they did not study.
  return db.select().from(lessons)
    .where(eq(lessons.courseId, courseId))
    .orderBy(asc(lessons.position)).all()
    .filter((lesson) => lesson.publishedAt !== null)
    .map((lesson) => ({
      lessonId: lesson.id,
      position: lesson.position,
      title: lesson.title,
      counts: tally(byLesson.get(lesson.id) ?? [], language),
    }));
}
