// Reading a Course back out of a file — on this box or on another one.
//
// **An import always creates a new Course.** It never merges into an existing
// one and never updates one in place. A merge would have to decide which
// Exercise in the file is which Exercise in the database, and getting that wrong
// silently orphans or clobbers the Submissions made against the ones it thought
// it was replacing. The safe operation is the one worth having first: the same
// file imported twice is two independent Courses, and nothing that was already
// here is touched.
//
// **An incoherent file is refused before anything is written.** Not partially
// imported and rolled back — refused, with nothing having been attempted, so a
// failed import cannot leave a half-Course behind for somebody to find later.
// Everything is judged first: the Course fields through `courseFaults`, the
// Lessons through `documentFaults`, the Tests through `testPublishFaults`, and
// the images through the same sniff and the same cap an upload goes through.
// Same rules, same stable codes, same Russian the authoring screens already use
// on an Admin's own work and on Claude's.
//
// **No name from the file ever becomes part of a path.** `content/uploads.ts` is
// built so that the application names every stored file; an import is exactly
// the moment that guarantee would otherwise be given away, since the file
// arrives full of names somebody else chose. Every image is stored under a
// freshly generated name and the Theory is rewritten to point at it. The names
// in the file are used for one thing only: matching an image to the reference in
// the markdown, after both have been held to `isStoredImageName`.

import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  acceptedVariants, courses, exercises, exerciseSets, lessons, tests, type CourseRow,
} from '../db/schema.ts';
import { documentFaults, type LessonDocument } from '../content/lesson-document.ts';
import { testPublishFaults, type TestDocument } from '../content/test-document.ts';
import {
  imageUrl, referencedImageNames, sniffImageType, storeImage,
} from '../content/uploads.ts';
import { courseFaults, resolvedGraderModel, resolvedGraderEffort } from './authoring.ts';
import {
  READABLE_EXPORT_VERSIONS, parseCourseExport, versionOf,
  type CourseExport, type ExportedLesson, type ExportedTest,
} from './course-export.ts';

type Db = BetterSQLite3Database<typeof schema>;
// The handle inside a transaction, taken from the type of `transaction` itself
// rather than cast to a `Db`: a cast here would silently accept the outer
// connection, and writing a Course through that would be a Course that no
// failure could roll back.
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Why a file was refused.
 *
 * Structural rather than one union, for the reason `FaultList` is: a fault code
 * means the same thing whichever act produced it, and the codes here are mostly
 * not this module's — they come from the validity rules the authoring screens
 * report. The positions are what an import adds, because "the Theory is empty"
 * is not actionable without "in the second Lesson".
 */
export type ImportFault = {
  code: string;
  /** 1-based, on a fault about one of the file's Lessons. */
  lessonPosition?: number;
  /** 1-based, on a fault about one of the file's Tests. */
  testPosition?: number;
  exercisePosition?: number;
  offending?: string;
};

export type ImportResult =
  | {
      ok: true;
      course: CourseRow;
      lessons: number;
      tests: number;
      images: number;
      /**
       * References a Theory makes to images the file does not carry.
       *
       * Not a refusal. An export leaves out an image the upload folder has lost,
       * and refusing the whole Course over one broken illustration would make a
       * Course with a missing file impossible to restore at all. Reported so the
       * Admin knows to put it back rather than discovering it in a Lesson.
       */
      missingImages: number;
    }
  | { ok: false; faults: ImportFault[] };

export type ImportOptions = {
  uploadDir: string;
  /** The per-image cap. An import is an upload, and is held to the upload's rules. */
  maxImageBytes: number;
};

function refuse(...faults: ImportFault[]): ImportResult {
  return { ok: false, faults };
}

/**
 * A Course from the text of an exported file.
 *
 * Takes the text rather than a parsed value on purpose: a truncated file is one
 * of the things this has to refuse, and that is a fact about the text.
 */
export function importCourse(db: Db, options: ImportOptions, text: string): ImportResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Malformed or truncated — the same answer either way, because there is
    // nothing to tell them apart by and nothing either could be imported from.
    return refuse({ code: 'not_json' });
  }

  // Before the shape, so a file from a later build is refused as being from a
  // later build rather than reported as a pile of shape faults. Every format
  // this build understands is read, not only the one it writes: an export is a
  // restore, and a Course exported last year has to come back.
  const version = versionOf(value);
  if (version !== null && !READABLE_EXPORT_VERSIONS.includes(version)) {
    return refuse({ code: 'version_unknown', offending: String(version) });
  }

  const file = parseCourseExport(value);
  if (file === null) return refuse({ code: 'not_an_export' });

  const faults = fileFaults(file, options);
  if (faults.length > 0) return { ok: false, faults };

  return write(db, options, file);
}

/**
 * Every reason this file cannot become a Course, or an empty array.
 *
 * Pure, and complete: the whole file is judged before any of it is written, so a
 * refusal always means the database and the upload folder are exactly as they
 * were. Everything is reported at once rather than the first thing found — a
 * file with three problems should take one round trip to fix, not three.
 */
function fileFaults(file: CourseExport, options: ImportOptions): ImportFault[] {
  const faults: ImportFault[] = [];

  for (const code of courseFaults(file.course)) faults.push({ code });

  file.lessons.forEach((lesson, index) => {
    faults.push(...documentFaults(lesson.document).map((fault) => ({ ...fault, lessonPosition: index + 1 })));
    faults.push(...misalignedVariants(lesson, index + 1, 'lessonPosition'));
  });

  file.tests.forEach((test, index) => {
    // The publish rules rather than the save rules: an imported Test arrives
    // published, and an empty published Test is a Student opening something they
    // cannot do.
    faults.push(...testPublishFaults(test.document).map((fault) => ({ ...fault, testPosition: index + 1 })));
    faults.push(...misalignedVariants(test, index + 1, 'testPosition'));
  });

  faults.push(...imageFaults(file, options.maxImageBytes));

  return faults;
}

function misalignedVariants(
  entry: ExportedLesson | ExportedTest,
  position: number,
  key: 'lessonPosition' | 'testPosition',
): ImportFault[] {
  // One list of variants per Exercise, in the same order. A file where the two
  // disagree is a file nobody can say which Exercise earned what from, and
  // guessing would attach a teacher-confirmed answer to the wrong Exercise —
  // which then goes to the Grader as context on every call.
  if (entry.acceptedVariants.length === entry.document.exercises.length) return [];
  return [{ code: 'variants_misaligned', [key]: position }];
}

/** The decoded bytes of every image the Theories actually point at. */
function decodedImages(file: CourseExport): Map<string, Buffer> {
  const decoded = new Map<string, Buffer>();
  for (const name of referencedNames(file)) {
    const encoded = file.images[name];
    if (encoded === undefined) continue;
    decoded.set(name, Buffer.from(encoded, 'base64'));
  }
  return decoded;
}

/**
 * The stored names the exported Theories point at.
 *
 * Held to `isStoredImageName` on the way out of the markdown, so a Theory
 * pointing at `/api/uploads/../../etc/passwd` yields nothing to look up and
 * nothing to write. An entry in `images` that nothing points at is never
 * touched — an import is not a way to write arbitrary files into the upload
 * folder.
 */
function referencedNames(file: CourseExport): string[] {
  const names = new Set<string>();
  for (const lesson of file.lessons) {
    for (const name of referencedImageNames(lesson.document.theoryMarkdown)) names.add(name);
  }
  return [...names];
}

/**
 * An import is an upload, and is held to an upload's two rules.
 *
 * The cap first, then the bytes themselves — never the name and never anything
 * else the file claims about them. `content/uploads.ts` says why each of those
 * is a construction rather than a check that could be forgotten; the only thing
 * different here is that the bytes arrived base64 in a JSON document rather than
 * in a multipart body.
 */
function imageFaults(file: CourseExport, maxImageBytes: number): ImportFault[] {
  const faults: ImportFault[] = [];
  for (const [name, bytes] of decodedImages(file)) {
    if (bytes.byteLength > maxImageBytes) {
      faults.push({ code: 'image_too_large', offending: name });
      continue;
    }
    if (sniffImageType(bytes) === null) faults.push({ code: 'image_not_an_image', offending: name });
  }
  return faults;
}

// --- Writing -----------------------------------------------------------------

function write(db: Db, options: ImportOptions, file: CourseExport): ImportResult {
  const decoded = decodedImages(file);

  // Stored before the rows, because storing is the part that can leave something
  // behind: a file written and then not referenced is an orphan blob, while a
  // row pointing at a file that was never written is a broken Lesson.
  const stored = new Map<string, string>();
  const written: string[] = [];
  try {
    for (const [name, bytes] of decoded) {
      const type = sniffImageType(bytes);
      // Already refused above; this is the type narrowing, not a second rule.
      if (type === null) continue;
      const image = storeImage(options.uploadDir, bytes, type);
      stored.set(name, image.name);
      written.push(image.name);
    }

    const course = db.transaction((tx) => writeContent(tx, file, stored));

    return {
      ok: true,
      course,
      lessons: file.lessons.length,
      tests: file.tests.length,
      images: stored.size,
      missingImages: referencedNames(file).filter((name) => !decoded.has(name)).length,
    };
  } catch (error) {
    // The rows are inside a transaction and are gone; the files are not, so they
    // are removed by hand. An import that fails leaves nothing behind.
    for (const name of written) {
      try {
        unlinkSync(join(options.uploadDir, name));
      } catch {
        // Already gone, or never landed. Either way there is nothing to undo.
      }
    }
    throw error;
  }
}

function writeContent(tx: Tx, file: CourseExport, stored: Map<string, string>): CourseRow {
  const course = tx.insert(courses).values({
    language: file.course.language,
    level: file.course.level,
    // The model the file was *judged* on, not the string it happened to carry.
    // `courseFaults` checks the resolved value — a blank one takes the
    // Language's default per ADR 0002 — so writing the raw string here would
    // create a Course that passed validation and can never grade: every
    // Submission in it would reach the Grader as `{ model: '' }` and be refused.
    graderModel: resolvedGraderModel(file.course),
    // Explicit rather than left to the column: the file's `null` is «По
    // умолчанию» and has to survive the trip, and `resolvedGraderEffort` is the
    // one place that knows an absent Effort means `low` rather than that.
    graderEffort: resolvedGraderEffort(file.course),
    // Carried as written. It is a prompt, not a title: trimming it would edit an
    // instruction somebody wrote, and it is refused for length before this runs.
    graderInstruction: file.course.graderInstruction,
    title: file.course.title.trim(),
    createdAt: new Date(),
  }).returning().get();

  const now = new Date();

  file.lessons.forEach((entry, index) => {
    const document = entry.document;
    const lesson = tx.insert(lessons).values({
      courseId: course.id,
      position: index + 1,
      title: document.title,
      // Rewritten to point at the names this application generated. The old
      // names stay only where the file carried no image for them, so the Lesson
      // reads the same as it did on the box it came from — including what it was
      // already missing there.
      theoryMarkdown: rewriteTheory(document, stored),
      grammarFocus: document.grammarFocus,
      // Published on arrival: the file only ever carries published Lessons, and
      // a restored Course no Student can see is not a restored Course.
      publishedAt: now,
    }).returning().get();

    const set = tx.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();
    writeExercises(tx, set.id, document, entry.acceptedVariants, now);
  });

  file.tests.forEach((entry) => {
    const test = tx.insert(tests).values({
      courseId: course.id,
      title: entry.document.title,
      passThreshold: entry.document.passThreshold,
      publishedAt: now,
    }).returning().get();

    const set = tx.insert(exerciseSets).values({ lessonId: null, testId: test.id }).returning().get();
    writeExercises(tx, set.id, entry.document, entry.acceptedVariants, now);
  });

  return course;
}

function writeExercises(
  tx: Tx,
  exerciseSetId: number,
  document: LessonDocument | TestDocument,
  variants: readonly string[][],
  now: Date,
): void {
  document.exercises.forEach((exercise, index) => {
    // Any `id` the file carries is ignored rather than honoured. It named a row
    // in the database this file came from, and reaching for it here would write
    // into somebody else's Course.
    const row = tx.insert(exercises).values({
      exerciseSetId,
      position: index + 1,
      kind: exercise.kind,
      prompt: exercise.prompt,
      referenceAnswer: exercise.referenceAnswer,
      acceptedAnswers: (exercise.acceptedAnswers ?? []).map((values) => [...values]),
      caseSensitive: exercise.caseSensitive ?? false,
      choices: [...(exercise.choices ?? [])],
    }).returning().get();

    const earned = variants[index] ?? [];
    if (earned.length === 0) return;
    tx.insert(acceptedVariants)
      .values(earned.map((value) => ({ exerciseId: row.id, value, createdAt: now })))
      .run();
  });
}

function rewriteTheory(document: LessonDocument, stored: Map<string, string>): string {
  let markdown = document.theoryMarkdown;
  for (const [was, is] of stored) {
    markdown = markdown.replaceAll(imageUrl(was), imageUrl(is));
  }
  return markdown;
}
