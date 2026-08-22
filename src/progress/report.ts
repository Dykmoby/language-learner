// Where a Student stands in a Course, on one screen.
//
// Derived at read time, never stored — the rule the Practice's progress and a
// Test's score already follow, for the same reason: a completion figure written
// down beside the rows is a second source of truth, and the two disagree the
// first time anything writes one without the other.
//
// And nothing here re-decides what a state means. Whatever `practiceProgress`
// reports is what this counts, the Dispute's `disputed` included. A second copy
// of "what counts as complete" living in a statistics screen is how a Course
// comes to be 90% finished on one page and 80% on another.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import type { ExerciseState } from '../practice/progress.ts';
import { courseOutline } from '../practice/lessons.ts';
import { courseTests } from '../tests/taking.ts';
import type { AttemptSummary } from '../tests/wire.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * The three ways an Exercise can be behind a Student, kept apart.
 *
 * Completed With Help is its own segment rather than folded in with unaided
 * completions — design.md insists on that split twice, and this is the screen
 * where it earns its keep. A Student who revealed their way through half a
 * Course should be able to see that they did, and so should the person teaching
 * them. `disputed` is here for the same reason and not for the same one: it is
 * neither a pass nor a fail, and adding it to either would say something nobody
 * has established.
 */
export type Tally = {
  completed: number;
  completedWithHelp: number;
  disputed: number;
  total: number;
};

export type LessonProgress = {
  lessonId: number;
  position: number;
  title: string;
  unlocked: boolean;
  tally: Tally;
  /**
   * Completion as a percentage: everything the Student finished, unaided or with
   * help.
   *
   * A disputed Exercise is deliberately not in it, and that holds after a ruling
   * as well as before one. Awaiting a decision, counting it either way would
   * claim something nobody has decided. Rejected, the decision was that the
   * Verdict stood — so the Exercise was never passed, and a Lesson holding one
   * settles below 100%. That is the honest number: the Student moved past it
   * without getting it right, which is exactly what a rejected objection means.
   * Only an upheld Dispute completes an Exercise, and that one arrives here as
   * `completed` rather than as `disputed`.
   */
  percent: number;
  /** The per-Exercise states, in order, so a bar can be drawn from them. */
  states: ExerciseState[];
};

export type CourseProgress = {
  lessons: LessonProgress[];
  /** The Course as a whole, on exactly the same terms as one Lesson. */
  course: Tally & { percent: number };
  /** Every attempt at every Test of the Course, most recent first. */
  attempts: Array<AttemptSummary & { testId: number; testTitle: string }>;
};

/**
 * A percentage of a whole that may be zero.
 *
 * An empty Practice is 0% rather than NaN or 100%: a Lesson with no Exercises has
 * not been finished by anybody, and both of the other answers would say it had.
 */
function percentOf(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function finished(tally: Tally): number {
  return tally.completed + tally.completedWithHelp;
}

export function courseProgress(db: Db, studentId: number, courseId: number): CourseProgress {
  const outline = courseOutline(db, studentId, courseId);

  const lessons: LessonProgress[] = outline.map(({ lesson, unlocked, progress }) => {
    const tally: Tally = {
      completed: progress.counts.completed,
      completedWithHelp: progress.counts.completedWithHelp,
      disputed: progress.counts.disputed,
      total: progress.counts.total,
    };
    return {
      lessonId: lesson.id,
      position: lesson.position,
      title: lesson.title,
      unlocked,
      tally,
      percent: percentOf(finished(tally), tally.total),
      states: progress.exercises.map((exercise) => exercise.state),
    };
  });

  // Summed from the same tallies rather than re-derived from the rows: two
  // additions of one set of numbers cannot disagree, and two derivations can.
  const course = lessons.reduce<Tally>((sum, lesson) => ({
    completed: sum.completed + lesson.tally.completed,
    completedWithHelp: sum.completedWithHelp + lesson.tally.completedWithHelp,
    disputed: sum.disputed + lesson.tally.disputed,
    total: sum.total + lesson.tally.total,
  }), { completed: 0, completedWithHelp: 0, disputed: 0, total: 0 });

  const attempts = courseTests(db, studentId, courseId)
    .flatMap(({ test, attempts: runs }) => runs.map((attempt) => ({
      ...attempt,
      testId: test.id,
      testTitle: test.title,
    })))
    // Most recent first: the last attempt is the one that says where the Student
    // is now, and the earlier ones are what it is a change from.
    .sort((a, b) => b.submittedAt - a.submittedAt);

  return {
    lessons,
    course: { ...course, percent: percentOf(finished(course), course.total) },
    attempts,
  };
}
