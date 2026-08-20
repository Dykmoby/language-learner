// The read side of content, and the rules about who may read it.
//
// Everything a screen needs about a Course, a Lesson and a Student's place in it
// comes from here, so the guard and the query are never separated: there is no
// way to fetch a Lesson without also having been told whether this Student may
// have it. A guard that only hides a link is not a guard.

import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, lessons, exerciseSets, exercises, enrollments, submissions, students,
  type CourseRow, type LessonRow, type ExerciseRow, type SubmissionRow,
} from '../db/schema.ts';
import { practiceProgress, type ExerciseProgress, type PracticeProgress } from './progress.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type LessonOutline = {
  lesson: LessonRow;
  /** Every Exercise in the Practice is complete, revealed ones included. */
  complete: boolean;
  /** Sequential unlocking: the first Lesson, or the one after a complete Lesson. */
  unlocked: boolean;
  progress: PracticeProgress;
};

export function enrolledCourses(db: Db, studentId: number): CourseRow[] {
  return db.select({ course: courses })
    .from(enrollments)
    .innerJoin(courses, eq(courses.id, enrollments.courseId))
    .where(eq(enrollments.studentId, studentId))
    .orderBy(asc(courses.id))
    .all()
    .map((row) => row.course);
}

export function isEnrolled(db: Db, studentId: number, courseId: number): boolean {
  return db.select({ id: enrollments.id }).from(enrollments)
    .where(and(eq(enrollments.studentId, studentId), eq(enrollments.courseId, courseId)))
    .get() !== undefined;
}

/**
 * Records the Course as the one this Student is working in, so signing in next
 * time lands them back here rather than on a menu.
 */
export function rememberCurrentCourse(db: Db, studentId: number, courseId: number): void {
  db.update(students).set({ currentCourseId: courseId }).where(eq(students.id, studentId)).run();
}

/** Every Lesson in a Course with this Student's progress and unlock state. */
export function courseOutline(db: Db, studentId: number, courseId: number): LessonOutline[] {
  const courseLessons = db.select().from(lessons)
    .where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position)).all();
  if (courseLessons.length === 0) return [];

  const sets = db.select().from(exerciseSets)
    .where(inArray(exerciseSets.lessonId, courseLessons.map((l) => l.id))).all();

  const setIds = sets.map((s) => s.id);
  const allExercises = setIds.length === 0 ? [] : db.select().from(exercises)
    .where(inArray(exercises.exerciseSetId, setIds)).orderBy(asc(exercises.position)).all();

  const exerciseIds = allExercises.map((e) => e.id);
  const rows = exerciseIds.length === 0 ? [] : db.select().from(submissions)
    .where(and(eq(submissions.studentId, studentId), inArray(submissions.exerciseId, exerciseIds)))
    .all();

  const setByLesson = new Map(sets.filter((s) => s.lessonId !== null).map((s) => [s.lessonId!, s.id]));
  const exercisesBySet = new Map<number, ExerciseRow[]>();
  for (const exercise of allExercises) {
    const list = exercisesBySet.get(exercise.exerciseSetId);
    if (list) list.push(exercise);
    else exercisesBySet.set(exercise.exerciseSetId, [exercise]);
  }

  const submissionsByExercise = new Map<number, SubmissionRow[]>();
  for (const row of rows) {
    const list = submissionsByExercise.get(row.exerciseId);
    if (list) list.push(row);
    else submissionsByExercise.set(row.exerciseId, [row]);
  }

  let previousComplete = true; // the first Lesson in a Course is unlocked on enrollment
  return courseLessons.map((lesson) => {
    const setId = setByLesson.get(lesson.id);
    const own = setId === undefined ? [] : exercisesBySet.get(setId) ?? [];
    const progress = practiceProgress(
      own,
      own.flatMap((exercise) => submissionsByExercise.get(exercise.id) ?? []),
    );

    const outline: LessonOutline = {
      lesson,
      complete: progress.complete,
      unlocked: previousComplete,
      progress,
    };
    previousComplete = progress.complete;
    return outline;
  });
}

export type OpenLesson = {
  course: CourseRow;
  lesson: LessonRow;
  exerciseSetId: number;
  /** In the Exercise Set's order — the ordering is the Exercise Set's job. */
  exercises: ExerciseRow[];
  progress: PracticeProgress;
  outline: LessonOutline[];
};

// Refused for three distinguishable reasons, because the screens answer them
// differently: a Lesson that does not exist is a 404, one in a Course the Student
// is not enrolled in is also a 404 (its existence is not theirs to learn), and a
// locked one is a refusal that names itself, since the Student can see it listed.
export type LessonRefusal = { ok: false; reason: 'not_found' | 'locked' };

export function openLesson(
  db: Db,
  studentId: number,
  lessonId: number,
): ({ ok: true } & OpenLesson) | LessonRefusal {
  const found = db.select({ lesson: lessons, course: courses })
    .from(lessons)
    .innerJoin(courses, eq(courses.id, lessons.courseId))
    .where(eq(lessons.id, lessonId))
    .get();

  if (!found) return { ok: false, reason: 'not_found' };
  if (!isEnrolled(db, studentId, found.course.id)) return { ok: false, reason: 'not_found' };

  const outline = courseOutline(db, studentId, found.course.id);
  const entry = outline.find((o) => o.lesson.id === lessonId);
  if (!entry) return { ok: false, reason: 'not_found' };
  if (!entry.unlocked) return { ok: false, reason: 'locked' };

  const set = db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lessonId)).get();
  const own = set === undefined ? [] : db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all();

  return {
    ok: true,
    course: found.course,
    lesson: found.lesson,
    exerciseSetId: set?.id ?? 0,
    exercises: own,
    progress: entry.progress,
    outline,
  };
}

export type OpenExercise = OpenLesson & {
  exercise: ExerciseRow;
  exerciseProgress: ExerciseProgress;
};

/**
 * One Exercise, with everything the Student's right to answer it depends on.
 * Nothing here branches on whether the Exercise Set belongs to a Lesson's
 * Practice or a Test — that is the whole reason the Exercise Set exists. Only
 * the ownership lookup does, and only because Tests arrive in step 6.
 */
export function openExercise(
  db: Db,
  studentId: number,
  exerciseId: number,
): ({ ok: true } & OpenExercise) | LessonRefusal {
  const found = db.select({ exercise: exercises, set: exerciseSets })
    .from(exercises)
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    .where(eq(exercises.id, exerciseId))
    .get();

  if (!found || found.set.lessonId === null) return { ok: false, reason: 'not_found' };

  const lesson = openLesson(db, studentId, found.set.lessonId);
  if (!lesson.ok) return lesson;

  const exerciseProgress = lesson.progress.exercises.find((p) => p.exerciseId === exerciseId);
  if (!exerciseProgress) return { ok: false, reason: 'not_found' };

  return { ...lesson, exercise: found.exercise, exerciseProgress };
}

/** The next Lesson by position, whatever owns it — used after a Lesson completes. */
export function nextLesson(outline: LessonOutline[], lessonId: number): LessonRow | null {
  const index = outline.findIndex((o) => o.lesson.id === lessonId);
  return index === -1 ? null : outline[index + 1]?.lesson ?? null;
}

/** Every Submission this Student has made against one Exercise, oldest first. */
export function submissionsFor(db: Db, studentId: number, exerciseId: number): SubmissionRow[] {
  return db.select().from(submissions)
    .where(and(eq(submissions.studentId, studentId), eq(submissions.exerciseId, exerciseId)))
    .orderBy(asc(submissions.attempt))
    .all();
}
