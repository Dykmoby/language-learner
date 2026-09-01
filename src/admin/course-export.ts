// A Course as one file, so content is portable off the Pi.
//
// design.md § Operations names per-Course JSON export as *"the human-readable,
// restore-anywhere format"*, alongside the binary backup rather than instead of
// it. The backup restores this box; this restores a Course anywhere, and can be
// read by a person in a text editor on the way.
//
// **What it carries.** The Course, its published Lessons in order with Theory
// and Exercises, its published Tests with their thresholds, and the Accepted
// Variants those Exercises have earned — those are content, and they are the
// product of the only closed feedback loop in the system (design.md § Disputes).
//
// **What it does not.** No Submissions, no Students, no Enrollments, no Drafts.
// Progress belongs to the person who made it rather than to the Course, and a
// Draft's SDK session id is meaningless on another box. Unpublished Lessons and
// Tests stay behind for the same reason a Draft does: nobody has read them, and
// an import that produced half-published content on the far side would be a
// worse restore than one that produced none.
//
// **How it is shaped.** Out of `LessonDocument` and `TestDocument` — the values
// the authoring screens already validate — rather than a parallel definition
// that would have to be kept in step with them. The documents travel whole and
// unmodified, so #56's import can hand them straight to `documentFaults` and
// `testFaults` and refuse a bad file through the rules that already exist.
//
// Row ids are stripped. They name rows in *this* database and mean nothing in
// another one; carrying them would invite an import to reach for a row that
// belongs to somebody else's Course.

import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { courses, lessons, tests } from '../db/schema.ts';
import type { Language } from '../grader/contract.ts';
import {
  parseLessonDocument, type LessonDocument, type DocumentExercise,
} from '../content/lesson-document.ts';
import { parseTestDocument, type TestDocument } from '../content/test-document.ts';
import { variantsOf } from '../content/accepted.ts';
import { readImage, referencedImageNames } from '../content/uploads.ts';
import { publishedDocument } from './drafts.ts';
import { adminTest } from './tests.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * The format's version.
 *
 * Bumped whenever a file written by this build could be misread by an older one.
 * Its whole job is to let an import refuse a file it does not understand rather
 * than guess at it — a guess here is content silently arriving wrong.
 *
 * 2 is where an Exercise's accepted answers became a list per gap. A version 1
 * file holds one flat list of whole answers, and reads back through
 * `perGapAcceptedAnswers` below.
 */
export const COURSE_EXPORT_VERSION = 2;

/**
 * Every version this build can read back.
 *
 * A file from an older build must keep importing forever — that is what makes an
 * export a restore rather than a snapshot with a shelf life — and a file from a
 * later one is refused as such rather than guessed at.
 */
export const READABLE_EXPORT_VERSIONS: readonly number[] = [1, COURSE_EXPORT_VERSION];

export type ExportedCourse = {
  language: Language;
  level: string;
  graderModel: string;
  title: string;
};

/**
 * A Lesson or a Test as it travels: the document the authoring screens validate,
 * plus the Accepted Variants of each of its Exercises.
 *
 * The variants sit beside the document rather than inside its Exercises so that
 * the document stays exactly a `LessonDocument` — parseable and checkable by the
 * existing rules, with nothing to strip first. One entry per Exercise, in the
 * same order, and an import that finds the two lengths disagreeing refuses the
 * file rather than guessing which Exercise earned what.
 */
export type ExportedLesson = {
  document: LessonDocument;
  acceptedVariants: string[][];
};

export type ExportedTest = {
  document: TestDocument;
  acceptedVariants: string[][];
};

export type CourseExport = {
  version: number;
  course: ExportedCourse;
  lessons: ExportedLesson[];
  tests: ExportedTest[];
  /**
   * Theory images, base64, keyed by the stored name the markdown points at.
   *
   * In their own section at the end rather than inline in the Theory: one file
   * restores anywhere, and the Lessons stay readable by a person scrolling
   * through them instead of being interrupted by a megabyte of base64.
   */
  images: Record<string, string>;
};

/** An Exercise as it travels — the same shape, without the id of a row elsewhere. */
function withoutRowId(exercise: DocumentExercise): DocumentExercise {
  const { id: _id, ...rest } = exercise;
  return rest;
}

function exportedExercises(document: { exercises: DocumentExercise[] }): {
  exercises: DocumentExercise[];
  ids: number[];
} {
  return {
    exercises: document.exercises.map(withoutRowId),
    // Kept only long enough to look the variants up. They do not travel.
    ids: document.exercises.map((exercise) => exercise.id).filter((id) => id !== undefined),
  };
}

/**
 * One Course as a file, or null where there is no such Course.
 *
 * Reads through the same modules the Admin screens read through —
 * `publishedDocument` for a Lesson, `adminTest` for a Test — so what is exported
 * is what an Admin was looking at, and there is no second assembly to drift.
 */
export function assembleCourseExport(
  db: Db,
  courseId: number,
  uploadDir: string,
): CourseExport | null {
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return null;

  const exportedLessons: ExportedLesson[] = [];
  const published = db.select().from(lessons)
    .where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position)).all()
    .filter((lesson) => lesson.publishedAt !== null);

  for (const lesson of published) {
    const document = publishedDocument(db, lesson.id);
    if (document === null) continue;
    const { exercises, ids } = exportedExercises(document);
    exportedLessons.push({
      document: { ...document, exercises },
      acceptedVariants: ids.map((id) => variantsOf(db, id)),
    });
  }

  const exportedTests: ExportedTest[] = [];
  const publishedTests = db.select().from(tests)
    .where(eq(tests.courseId, courseId)).orderBy(asc(tests.id)).all()
    .filter((test) => test.publishedAt !== null);

  for (const test of publishedTests) {
    const open = adminTest(db, test.id);
    if (open === null) continue;
    const { exercises, ids } = exportedExercises(open.document);
    exportedTests.push({
      document: { ...open.document, exercises },
      acceptedVariants: ids.map((id) => variantsOf(db, id)),
    });
  }

  return {
    version: COURSE_EXPORT_VERSION,
    course: {
      language: course.language,
      level: course.level,
      graderModel: course.graderModel,
      title: course.title,
    },
    lessons: exportedLessons,
    tests: exportedTests,
    images: inlinedImages(exportedLessons, uploadDir),
  };
}

/**
 * Every image the exported Theories point at, as base64.
 *
 * An image the folder has lost is left out rather than thrown over: an export is
 * not the moment to discover that a file went missing three deploys ago, and
 * refusing to export a whole Course over one broken illustration would be the
 * wrong trade. The Theory keeps pointing at it, and the import will say what it
 * could not find.
 */
function inlinedImages(exported: readonly ExportedLesson[], uploadDir: string): Record<string, string> {
  const images: Record<string, string> = {};
  for (const lesson of exported) {
    for (const name of referencedImageNames(lesson.document.theoryMarkdown)) {
      if (name in images) continue;
      const stored = readImage(uploadDir, name);
      if (stored === null) continue;
      images[name] = stored.bytes.toString('base64');
    }
  }
  return images;
}

// --- Reading one back --------------------------------------------------------
//
// The shaping half of the import, and it lives here rather than beside the
// writing so that the format has exactly one definition: what is written and
// what is understood are the same file, described in one place.
//
// Shaping, not judging — the split the Lesson document already makes. A file
// whose `lessons` is not an array is not a Course export at all and there is
// nothing to report about it; a Lesson with an empty Theory is a perfectly
// well-shaped file that the validity rules then refuse by name, in Russian.

/**
 * The version a file claims, or null where it does not claim one.
 *
 * Asked before anything else is looked at, so a file from a later build is
 * refused as such rather than reported as a hundred shape faults.
 */
export function versionOf(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).version;
  return typeof version === 'number' && Number.isInteger(version) ? version : null;
}

function parseVariants(value: unknown, exerciseCount: number): string[][] | null {
  // Absent is the same as none — a file written by hand, or by a build that had
  // no Disputes yet, should not need an array of empty arrays in it.
  if (value === undefined) return Array.from({ length: exerciseCount }, () => []);
  if (!Array.isArray(value)) return null;

  const variants: string[][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === 'string')) return null;
    variants.push(entry as string[]);
  }
  return variants;
}

/**
 * One document from a file written before accepted answers became per-gap.
 *
 * The one place left in the codebase that understands a flat list of accepted
 * answers, and the one place that permanently must: a version 1 file has to keep
 * reading, and reading it means wrapping each Exercise's flat list into the
 * single position it always was.
 *
 * Applied to the raw value on the way in, before the document is parsed, so the
 * parser has exactly one shape to know about and nothing downstream branches.
 */
function perGapAcceptedAnswers(document: unknown): unknown {
  if (typeof document !== 'object' || document === null) return document;
  const body = document as Record<string, unknown>;
  if (!Array.isArray(body.exercises)) return document;

  return {
    ...body,
    exercises: body.exercises.map((entry) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const exercise = entry as Record<string, unknown>;
      const accepted = exercise.acceptedAnswers;
      // Nothing accepted is no positions in either format, and anything that is
      // not a list at all is left for the parser to turn down by shape.
      if (!Array.isArray(accepted) || accepted.length === 0) return entry;
      return { ...exercise, acceptedAnswers: [accepted] };
    }),
  };
}

function parseImages(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const images: Record<string, string> = {};
  for (const [name, encoded] of Object.entries(value as Record<string, unknown>)) {
    if (typeof encoded !== 'string') return null;
    images[name] = encoded;
  }
  return images;
}

/** A Course export as it arrives, or null where the value is not that shape at all. */
export function parseCourseExport(value: unknown): CourseExport | null {
  const version = versionOf(value);
  if (version === null) return null;

  const body = value as Record<string, unknown>;
  const course = body.course;
  if (typeof course !== 'object' || course === null || Array.isArray(course)) return null;
  const fields = course as Record<string, unknown>;
  if (typeof fields.language !== 'string' || typeof fields.level !== 'string'
    || typeof fields.graderModel !== 'string' || typeof fields.title !== 'string') return null;

  if (body.lessons !== undefined && !Array.isArray(body.lessons)) return null;
  if (body.tests !== undefined && !Array.isArray(body.tests)) return null;

  // Only a version 1 file can hold flat lists, so the wrapping is asked for by
  // version rather than guessed at from the values — a file that claims 2 and
  // holds a flat list is a broken file, not an old one.
  const asWritten = (value: unknown) => (version < 2 ? perGapAcceptedAnswers(value) : value);

  const lessons: ExportedLesson[] = [];
  for (const entry of (body.lessons ?? []) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const document = parseLessonDocument(asWritten((entry as Record<string, unknown>).document));
    if (document === null) return null;
    const acceptedVariants = parseVariants(
      (entry as Record<string, unknown>).acceptedVariants, document.exercises.length,
    );
    if (acceptedVariants === null) return null;
    lessons.push({ document, acceptedVariants });
  }

  const tests: ExportedTest[] = [];
  for (const entry of (body.tests ?? []) as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return null;
    const document = parseTestDocument(asWritten((entry as Record<string, unknown>).document));
    if (document === null) return null;
    const acceptedVariants = parseVariants(
      (entry as Record<string, unknown>).acceptedVariants, document.exercises.length,
    );
    if (acceptedVariants === null) return null;
    tests.push({ document, acceptedVariants });
  }

  const images = parseImages(body.images);
  if (images === null) return null;

  return {
    version,
    course: {
      // Held to `isLanguage` by the validity rules rather than here, so a file
      // naming a language nobody teaches is refused by name in Russian instead
      // of as an unreadable file.
      language: fields.language as Language,
      level: fields.level,
      graderModel: fields.graderModel,
      title: fields.title,
    },
    lessons,
    tests,
    images,
  };
}
