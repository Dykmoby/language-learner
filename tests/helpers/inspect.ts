// Reading the booted application's database from the outside.
//
// Used only where the claim under test is about what was *persisted* — a
// Submission row, its attempt number, its Errors. Everything else is asserted
// through HTTP, because that is what an actor outside the module can see.

import { and, asc, eq } from 'drizzle-orm';
import { openDatabase } from '../../src/db/client.ts';
import {
  courses, lessons, exerciseSets, exercises, enrollments, students, submissions, submissionErrors,
  tests, testAttempts,
  type ExerciseRow, type LessonRow, type SubmissionRow, type SubmissionErrorRow,
  type TestRow, type TestAttemptRow,
} from '../../src/db/schema.ts';

export function withDatabase<T>(path: string, fn: (db: ReturnType<typeof openDatabase>['db']) => T): T {
  const handle = openDatabase(path);
  try {
    return fn(handle.db);
  } finally {
    handle.close();
  }
}

export type SeededLesson = { lesson: LessonRow; exercises: ExerciseRow[] };

/** The Lessons of a Course, by title, each with its Practice in order. */
export function lessonsOf(path: string, courseTitle: string): SeededLesson[] {
  return withDatabase(path, (db) => {
    const course = db.select().from(courses).where(eq(courses.title, courseTitle)).get();
    if (!course) throw new Error(`no Course titled ${JSON.stringify(courseTitle)} was seeded`);

    return db.select().from(lessons)
      .where(eq(lessons.courseId, course.id)).orderBy(asc(lessons.position)).all()
      .map((lesson) => {
        const set = db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lesson.id)).get();
        return {
          lesson,
          exercises: set === undefined ? [] : db.select().from(exercises)
            .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all(),
        };
      });
  });
}

export function studentIdFor(path: string, username: string): number {
  return withDatabase(path, (db) => {
    const student = db.select().from(students).where(eq(students.username, username)).get();
    if (!student) throw new Error(`no Student named ${JSON.stringify(username)}`);
    return student.id;
  });
}

export function submissionsOf(path: string, username: string, exerciseId: number): SubmissionRow[] {
  const studentId = studentIdFor(path, username);
  return withDatabase(path, (db) => db.select().from(submissions)
    .where(and(eq(submissions.studentId, studentId), eq(submissions.exerciseId, exerciseId)))
    .orderBy(asc(submissions.attempt)).all());
}

export function errorsOf(path: string, submissionId: number): SubmissionErrorRow[] {
  return withDatabase(path, (db) => db.select().from(submissionErrors)
    .where(eq(submissionErrors.submissionId, submissionId))
    .orderBy(asc(submissionErrors.position)).all());
}

export function courseIdFor(path: string, courseTitle: string): number {
  return withDatabase(path, (db) => {
    const course = db.select().from(courses).where(eq(courses.title, courseTitle)).get();
    if (!course) throw new Error(`no Course titled ${JSON.stringify(courseTitle)} was seeded`);
    return course.id;
  });
}

export type SeededTest = { test: TestRow; exercises: ExerciseRow[] };

/** The Tests of a Course, by title, each with its Exercise Set in order. */
export function testsOf(path: string, courseTitle: string): SeededTest[] {
  const courseId = courseIdFor(path, courseTitle);
  return withDatabase(path, (db) =>
    db.select().from(tests).where(eq(tests.courseId, courseId)).orderBy(asc(tests.id)).all()
      .map((test) => {
        const set = db.select().from(exerciseSets).where(eq(exerciseSets.testId, test.id)).get();
        return {
          test,
          exercises: set === undefined ? [] : db.select().from(exercises)
            .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all(),
        };
      }));
}

/** One Student's attempts at one Test, oldest first, with the answers of each. */
export function attemptsOf(path: string, username: string, testId: number): Array<{
  attempt: TestAttemptRow;
  submissions: SubmissionRow[];
}> {
  const studentId = studentIdFor(path, username);
  return withDatabase(path, (db) =>
    db.select().from(testAttempts)
      .where(and(eq(testAttempts.studentId, studentId), eq(testAttempts.testId, testId)))
      .orderBy(asc(testAttempts.attempt)).all()
      .map((attempt) => ({
        attempt,
        submissions: db.select().from(submissions)
          .where(eq(submissions.testAttemptId, attempt.id))
          .orderBy(asc(submissions.id)).all(),
      })));
}

/** Drops one Student's Enrollment, so a Course exists that is not theirs. */
export function unenroll(path: string, username: string, courseTitle: string): void {
  const studentId = studentIdFor(path, username);
  withDatabase(path, (db) => {
    const course = db.select().from(courses).where(eq(courses.title, courseTitle)).get();
    if (!course) throw new Error(`no Course titled ${JSON.stringify(courseTitle)}`);
    db.delete(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.courseId, course.id)))
      .run();
  });
}
