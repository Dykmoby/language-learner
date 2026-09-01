// The Admin's write side of content: creating a Course, creating and ordering
// its Lessons, and enrolling a Student in it.
//
// Until this module existed, every Course and every Lesson in the system was
// created by a command-line seed script, and an Admin could improve content but
// could not add any. The seed script stays — it is how the checked-in fixture
// reaches a fresh database — but it is no longer the only way content comes into
// being.
//
// Refusals are reported as **stable codes**, the same split the validity rules
// make: the Russian wording is resolved from the central dictionary at display
// time, and every reason is reported at once rather than one per attempt,
// because an author fixes a form rather than a field.
//
// Nothing here checks who is asking. The Admin narrowing happens once, at the
// page or the endpoint, the same way the rest of the section does it.

import { and, asc, eq, max } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, lessons, lessonDrafts, enrollments, students,
  type CourseRow, type LessonRow, type LessonDraftRow,
} from '../db/schema.ts';
import { LANGUAGES, type Language } from '../grader/contract.ts';
import { isBlank } from '../content/exercise-validity.ts';
// The offerable choices and the Haiku rule live in a module the browser can
// import: the form that offers them runs there, and a constant shared with this
// module would drag SQLite into the bundle with it.
import { DEFAULT_GRADER_MODEL, graderModelFault, isCefrLevel } from '../content/course-options.ts';

type Db = BetterSQLite3Database<typeof schema>;

export const AUTHORING_FAULTS = [
  'course_title_empty',
  'language_unknown',
  'level_unknown',
  'grader_model_forbidden',
  'grader_model_unknown',
  'lesson_title_empty',
  'course_not_found',
  'student_not_found',
  'order_mismatch',
] as const;
export type AuthoringFaultCode = (typeof AUTHORING_FAULTS)[number];

type Refused = { ok: false; faults: AuthoringFaultCode[] };

function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}

// --- Creating a Course -------------------------------------------------------

export type CourseInput = {
  language: string;
  level: string;
  /**
   * Left out to take the Language's default — ADR 0002's Sonnet 5 for English
   * and Opus 5 for Tajik. The default lives on this side rather than only in the
   * form, so a Course created by anything but that form still gets the model the
   * ADR says it should have.
   */
  graderModel?: string;
  title: string;
};

export type CreateCourseResult = { ok: true; course: CourseRow } | Refused;

/**
 * The model a Course would actually be created with.
 *
 * Defaulted only where the Language is known — there is nothing to default from
 * otherwise, and `language_unknown` is already the answer.
 */
export function resolvedGraderModel(input: CourseInput): string {
  return isBlank(input.graderModel ?? '') && isLanguage(input.language)
    ? DEFAULT_GRADER_MODEL[input.language]
    : input.graderModel ?? '';
}

/**
 * Every reason these Course fields cannot become a Course, or an empty array.
 *
 * Pure, and apart from `createCourse`, because a Course now arrives by two
 * routes: the New Course form and an imported file. An import has to know
 * whether the fields are good *before* it writes anything at all — it refuses a
 * bad file with nothing written — and a second copy of these rules would be a
 * second place for them to drift.
 */
export function courseFaults(input: CourseInput): AuthoringFaultCode[] {
  const faults: AuthoringFaultCode[] = [];

  if (isBlank(input.title)) faults.push('course_title_empty');
  if (!isLanguage(input.language)) faults.push('language_unknown');
  if (!isCefrLevel(input.level)) faults.push('level_unknown');

  const modelFault = graderModelFault(resolvedGraderModel(input));
  if (modelFault !== null) faults.push(modelFault);

  return faults;
}

export function createCourse(db: Db, input: CourseInput): CreateCourseResult {
  const faults = courseFaults(input);
  if (faults.length > 0) return { ok: false, faults };

  const course = db.insert(courses).values({
    language: input.language as Language,
    level: input.level,
    graderModel: resolvedGraderModel(input),
    title: input.title.trim(),
    createdAt: new Date(),
  }).returning().get();

  return { ok: true, course };
}

// --- Creating a Lesson -------------------------------------------------------

export type CreateLessonResult =
  | { ok: true; lesson: LessonRow; draft: LessonDraftRow }
  | Refused;

/**
 * A new Lesson at the end of its Course, unpublished, with its first Draft.
 *
 * Unpublished is the whole point: an empty published Lesson would appear in a
 * Student's Course as something they can open and cannot do, and would sit in
 * the middle of sequential unlocking. Publishing it is the same deliberate act
 * as publishing any other change.
 *
 * The Draft is written here rather than on the first save so that "starts as an
 * unpublished Draft" is literally true — the history then has a first version
 * instead of a Lesson that exists with no version at all.
 */
export function createLesson(
  db: Db,
  input: { courseId: number; title: string; studentId: number },
): CreateLessonResult {
  const faults: AuthoringFaultCode[] = [];
  if (isBlank(input.title)) faults.push('lesson_title_empty');

  const course = db.select().from(courses).where(eq(courses.id, input.courseId)).get();
  if (!course) faults.push('course_not_found');

  if (faults.length > 0) return { ok: false, faults };

  const title = input.title.trim();

  return db.transaction((tx) => {
    const highest = tx.select({ position: max(lessons.position) }).from(lessons)
      .where(eq(lessons.courseId, input.courseId)).get()?.position ?? 0;

    const lesson = tx.insert(lessons).values({
      courseId: input.courseId,
      position: highest + 1,
      title,
      // Empty, and refused by the publish rules until an Admin fills them in.
      // A placeholder would be worse: the grammar focus reaches the Grader on
      // every call, so a plausible-looking default is context that is quietly
      // wrong rather than obviously missing.
      theoryMarkdown: '',
      grammarFocus: '',
      publishedAt: null,
    }).returning().get();

    const draft = tx.insert(lessonDrafts).values({
      lessonId: lesson.id,
      document: { title, grammarFocus: '', theoryMarkdown: '', exercises: [] },
      origin: 'manual',
      publishedAt: null,
      createdBy: input.studentId,
      createdAt: new Date(),
    }).returning().get();

    return { ok: true, lesson, draft } as const;
  });
}

// --- Reordering --------------------------------------------------------------

export type ReorderResult = { ok: true; lessons: LessonRow[] } | Refused;

/**
 * Puts a Course's Lessons in the given order, in one transaction.
 *
 * Positions are unique within a Course, so a reorder cannot be a sequence of
 * writes: swapping the first two Lessons collides on the first write. Every
 * Lesson moves out of the way first, into negative positions that can never
 * collide with the 1..n about to be written — the same shape publishing uses for
 * Exercises, for the same reason.
 *
 * The order must name exactly this Course's Lessons, each once. Anything else is
 * a stale tab or a tampered request, and a partial reorder is worse than none.
 */
export function reorderLessons(db: Db, courseId: number, orderedLessonIds: readonly number[]): ReorderResult {
  const own = db.select().from(lessons)
    .where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position)).all();

  const named = new Set(orderedLessonIds);
  const mismatched = named.size !== orderedLessonIds.length
    || named.size !== own.length
    || own.some((lesson) => !named.has(lesson.id));
  if (mismatched) return { ok: false, faults: ['order_mismatch'] };

  return db.transaction((tx) => {
    for (const id of orderedLessonIds) {
      tx.update(lessons).set({ position: -id }).where(eq(lessons.id, id)).run();
    }
    orderedLessonIds.forEach((id, index) => {
      tx.update(lessons).set({ position: index + 1 }).where(eq(lessons.id, id)).run();
    });

    return {
      ok: true,
      lessons: tx.select().from(lessons)
        .where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position)).all(),
    } as const;
  });
}

// --- Enrollment --------------------------------------------------------------

export type EnrollResult = { ok: true; created: boolean } | Refused;

/**
 * Enrolls a Student in a Course, or reports that they already were.
 *
 * This is the missing half of everything above: a Course nobody is enrolled in
 * is unreachable by construction, because a Student cannot reach a Lesson in a
 * Course they are not enrolled in. Without it, a Course authored through these
 * screens would be invisible to everyone including its author.
 *
 * Enrolling twice is ignored rather than duplicated — the schema already refuses
 * the second row, and an Enrollment is a fact rather than an event.
 */
export function enrollStudent(db: Db, input: { courseId: number; studentId: number }): EnrollResult {
  const faults: AuthoringFaultCode[] = [];
  if (!db.select().from(courses).where(eq(courses.id, input.courseId)).get()) {
    faults.push('course_not_found');
  }
  if (!db.select().from(students).where(eq(students.id, input.studentId)).get()) {
    faults.push('student_not_found');
  }
  if (faults.length > 0) return { ok: false, faults };

  const existing = db.select().from(enrollments).where(and(
    eq(enrollments.courseId, input.courseId),
    eq(enrollments.studentId, input.studentId),
  )).get();
  if (existing) return { ok: true, created: false };

  db.insert(enrollments).values({
    studentId: input.studentId,
    courseId: input.courseId,
    createdAt: new Date(),
  }).run();

  return { ok: true, created: true };
}

export type WithdrawResult = { ok: true; removed: boolean };

/**
 * Drops a Student's Enrollment in one Course.
 *
 * The other half of enrolling, which existed on its own for long enough that a
 * Student put on the wrong Course kept it: the screen could add access and had
 * no way to take it back.
 *
 * It removes **access and nothing else**. Their Submissions in that Course stay
 * exactly where they are, so enrolling them again puts them back where they
 * stopped rather than at the beginning. Deleting the work is what deleting the
 * Student does, and the two acts are deliberately not the same size.
 *
 * Withdrawing someone who was not enrolled is reported rather than refused —
 * the mirror of enrolling someone who already was, and for the same reason: an
 * Enrollment is a fact rather than an event, and both calls leave the same fact
 * behind. Which is also why this refuses nothing at all and has no fault codes:
 * an unknown Course and an unknown Student are both simply an Enrollment that is
 * not there.
 */
export function withdrawStudent(
  db: Db,
  input: { courseId: number; studentId: number },
): WithdrawResult {
  const existing = db.select().from(enrollments).where(and(
    eq(enrollments.courseId, input.courseId),
    eq(enrollments.studentId, input.studentId),
  )).get();
  if (!existing) return { ok: true, removed: false };

  db.transaction((tx) => {
    tx.delete(enrollments).where(eq(enrollments.id, existing.id)).run();
    // The Current Course is where a Student is put back on their next visit, and
    // a Course they can no longer reach is not somewhere to be put back to. The
    // home screen already tolerates a stale value by ignoring it, so this is not
    // a correctness fix — it is the difference between landing where they left
    // off and landing on the Courses list for no stated reason.
    tx.update(students)
      .set({ currentCourseId: null })
      .where(and(eq(students.id, input.studentId), eq(students.currentCourseId, input.courseId)))
      .run();
  });

  return { ok: true, removed: true };
}
