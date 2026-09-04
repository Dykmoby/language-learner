// The Admin's read side of content.
//
// Deliberately separate from the Student's. That one binds the query to the
// guard on purpose — there is no way to fetch a Lesson from it without having
// been told whether this Student may have it — and an Admin needs the opposite:
// every Course whether or not they are enrolled in it, every Lesson whether or
// not it is unlocked. Adding a flag to the Student's read side to skip its own
// guard would leave a guard with an escape hatch, which is not a guard.
//
// Nothing here checks who is asking. The Admin narrowing happens once, at the
// page, the same way the health check does it.

import { asc, count, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, lessons, exerciseSets, exercises, submissions, enrollments, students,
  type CourseRow, type LessonRow, type StudentRow,
} from '../db/schema.ts';
import { lessonsWithUnpublishedChanges } from './drafts.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type CourseSummary = {
  course: CourseRow;
  lessonCount: number;
};

/**
 * Every Course in the system, whoever is enrolled in it — including one nobody
 * is, which is exactly the state a Course is in between being created and being
 * given its first Enrollment.
 */
export function everyCourse(db: Db): CourseSummary[] {
  const all = db.select().from(courses).orderBy(asc(courses.id)).all();
  if (all.length === 0) return [];

  const counts = new Map<number, number>();
  for (const lesson of db.select({ courseId: lessons.courseId }).from(lessons)
    .where(inArray(lessons.courseId, all.map((c) => c.id))).all()) {
    counts.set(lesson.courseId, (counts.get(lesson.courseId) ?? 0) + 1);
  }

  return all.map((course) => ({ course, lessonCount: counts.get(course.id) ?? 0 }));
}

/**
 * What a Lesson's content currently is, from an author's point of view.
 *
 * `published` means what a Student reads is the newest thing there is;
 * `unpublished_changes` means a Draft has moved ahead of it and nobody has
 * pressed Publish. The distinction is the whole reason saving and publishing are
 * separate acts.
 *
 * `draft` is the third and narrowest state: a Lesson that has never been
 * published at all. It is not a stronger form of `unpublished_changes` — no
 * Student has ever seen this Lesson, so there is nothing for a Draft to be ahead
 * of, and the Course they read does not contain it.
 */
export type LessonPublication = 'published' | 'unpublished_changes' | 'draft';

export type AdminLesson = {
  lesson: LessonRow;
  exerciseCount: number;
  publication: LessonPublication;
  /**
   * How many Submissions a Student has made against this Lesson's Exercises.
   *
   * Read for one reason: the screen offers to delete a Lesson, and deleting one
   * takes every Submission in it with no way back. The confirmation has to be
   * able to name the cost before the act rather than report it after, so the
   * number travels with the list.
   */
  submissionCount: number;
};

export type AdminCourse = {
  course: CourseRow;
  lessons: AdminLesson[];
};

/** One Course and its Lessons in position order, or null if there is no such Course. */
export function adminCourse(db: Db, courseId: number): AdminCourse | null {
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  const own = db.select().from(lessons)
    .where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position)).all();
  if (own.length === 0) return { course, lessons: [] };

  const sets = db.select().from(exerciseSets)
    .where(inArray(exerciseSets.lessonId, own.map((l) => l.id))).all();

  const counts = new Map<number, number>();
  const submitted = new Map<number, number>();
  if (sets.length > 0) {
    const lessonBySet = new Map(sets.filter((s) => s.lessonId !== null).map((s) => [s.id, s.lessonId!]));
    const lessonByExercise = new Map<number, number>();
    for (const row of db.select({ id: exercises.id, setId: exercises.exerciseSetId }).from(exercises)
      .where(inArray(exercises.exerciseSetId, [...lessonBySet.keys()])).all()) {
      const lessonId = lessonBySet.get(row.setId);
      if (lessonId === undefined) continue;
      counts.set(lessonId, (counts.get(lessonId) ?? 0) + 1);
      lessonByExercise.set(row.id, lessonId);
    }

    // Grouped in the database rather than counted here: this asks for one row
    // per Exercise, which is bounded by the Lesson, where selecting the
    // Submissions themselves would be one row per answer every Student ever gave.
    if (lessonByExercise.size > 0) {
      for (const row of db
        .select({ exerciseId: submissions.exerciseId, made: count() })
        .from(submissions)
        .where(inArray(submissions.exerciseId, [...lessonByExercise.keys()]))
        .groupBy(submissions.exerciseId)
        .all()) {
        const lessonId = lessonByExercise.get(row.exerciseId);
        if (lessonId !== undefined) submitted.set(lessonId, (submitted.get(lessonId) ?? 0) + row.made);
      }
    }
  }

  const ahead = lessonsWithUnpublishedChanges(db, own.map((l) => l.id));

  return {
    course,
    lessons: own.map((lesson) => ({
      lesson,
      exerciseCount: counts.get(lesson.id) ?? 0,
      submissionCount: submitted.get(lesson.id) ?? 0,
      publication: lesson.publishedAt === null
        ? 'draft'
        : ahead.has(lesson.id) ? 'unpublished_changes' : 'published',
    })),
  };
}

export type RosterEntry = {
  student: StudentRow;
  enrolled: boolean;
};

/**
 * Every Student, and whether they are enrolled in this Course.
 *
 * Everyone rather than only those enrolled, because the screen this feeds is
 * where an Admin enrolls someone — a list of the already-enrolled would be a
 * list with no way to add to it. With two accounts there is no paging question
 * to answer, and if there ever is, it is a question about this function.
 */
export function courseRoster(db: Db, courseId: number): RosterEntry[] {
  const everyone = db.select().from(students).orderBy(asc(students.id)).all();
  if (everyone.length === 0) return [];

  const enrolled = new Set(
    db.select({ studentId: enrollments.studentId }).from(enrollments)
      .where(eq(enrollments.courseId, courseId)).all().map((row) => row.studentId),
  );

  return everyone.map((student) => ({ student, enrolled: enrolled.has(student.id) }));
}

export type AccountEntry = {
  student: StudentRow;
  /** How many Courses this Student can reach. Zero is a real and visible state. */
  enrollmentCount: number;
};

/**
 * Every account, in the order they were made, each with the number of Courses it
 * reaches.
 *
 * The count is here rather than on the screen because it is the one number that
 * makes the delete button safe to press: an account with no Enrollments has
 * nothing behind it, and an account with three is somebody who has been studying.
 * A list of names alone gives an Admin no way to tell those apart.
 *
 * Every account rather than every non-Admin one. An Admin cannot be deleted from
 * these screens, and hiding the row that says so would leave a list that quietly
 * disagrees with the sign-in screen about who exists.
 */
export function everyStudent(db: Db): AccountEntry[] {
  const everyone = db.select().from(students).orderBy(asc(students.id)).all();
  if (everyone.length === 0) return [];

  const counts = new Map<number, number>();
  for (const row of db.select({ studentId: enrollments.studentId }).from(enrollments).all()) {
    counts.set(row.studentId, (counts.get(row.studentId) ?? 0) + 1);
  }

  return everyone.map((student) => ({ student, enrollmentCount: counts.get(student.id) ?? 0 }));
}
