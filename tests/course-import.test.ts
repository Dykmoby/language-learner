// Reading a file back — the half that makes the export a restore format rather
// than an archive nobody can open.
//
// Two rules carry this feature, and both are tested by trying to break them:
// an import always creates a **new** Course and never touches an existing one,
// and an incoherent file is refused **before anything is written**, through the
// validity rules the authoring screens already use.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { acceptedVariants, courses, exercises, exerciseSets, lessons } from '../src/db/schema.ts';
import { createTest, saveTest, publishTest } from '../src/admin/tests.ts';
import { assembleCourseExport, COURSE_EXPORT_VERSION, type CourseExport } from '../src/admin/course-export.ts';
import { importCourse } from '../src/admin/course-import.ts';
import { imageUrl, isStoredImageName } from '../src/content/uploads.ts';
import { DEFAULT_GRADER_MODEL } from '../src/content/course-options.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const IMAGE_NAME = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.png';
const LIMITS = { maxImageBytes: 2 * 1024 * 1024 };

function box(seeded: boolean) {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'igor', password: 'correct horse battery', isAdmin: true }]);
  if (seeded) seedCourseContent(handle.db, DETERMINISTIC_COURSE);

  const uploadDir = mkdtempSync(join(tmpdir(), 'language-learner-import-'));
  return {
    db: handle.db,
    uploadDir,
    cleanup: () => { handle.close(); cleanup(); rmSync(uploadDir, { recursive: true, force: true }); },
  };
}

type Db = ReturnType<typeof box>['db'];

/** A source box with everything a Course can hold: a Test, variants, an image. */
function sourceFile(): { file: CourseExport; text: string } {
  const source = box(true);
  try {
    const course = source.db.select().from(courses)
      .where(eq(courses.title, DETERMINISTIC_COURSE.title)).get()!;

    const created = createTest(source.db, { courseId: course.id, title: 'Контрольная 1', passThreshold: 65 });
    assert.ok(created.ok);
    assert.ok(saveTest(source.db, created.test.id, {
      title: 'Контрольная 1', passThreshold: 65,
      exercises: [{
        kind: 'fill_gap', prompt: 'Вставьте артикль: ___ apple', referenceAnswer: 'an',
        acceptedAnswers: [['an']], caseSensitive: false, choices: [],
      }],
    }).ok);
    assert.ok(publishTest(source.db, created.test.id).ok);

    const firstLesson = source.db.select().from(lessons).orderBy(asc(lessons.position)).all()[0]!;
    const set = source.db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, firstLesson.id)).get()!;
    const own = source.db.select().from(exercises).where(eq(exercises.exerciseSetId, set.id))
      .orderBy(asc(exercises.position)).all();
    source.db.insert(acceptedVariants)
      .values({ exerciseId: own[0]!.id, value: 'the', createdAt: new Date() }).run();

    writeFileSync(join(source.uploadDir, IMAGE_NAME), PNG);
    source.db.update(lessons)
      .set({ theoryMarkdown: `## Урок\n\n![кошка](${imageUrl(IMAGE_NAME)})` })
      .where(eq(lessons.id, firstLesson.id)).run();

    const file = assembleCourseExport(source.db, course.id, source.uploadDir)!;
    return { file, text: JSON.stringify(file) };
  } finally {
    source.cleanup();
  }
}

const coursesIn = (db: Db) => db.select().from(courses).orderBy(asc(courses.id)).all();

test('round trip: a file exported on one box rebuilds the same Course on another', () => {
  const { file, text } = sourceFile();
  const target = box(false);
  try {
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, text);
    assert.ok(result.ok, `import refused: ${JSON.stringify(result.ok ? [] : result.faults)}`);

    const reexported = assembleCourseExport(target.db, result.course.id, target.uploadDir)!;

    assert.deepEqual(reexported.course, file.course, 'the Course itself is unchanged');
    assert.deepEqual(
      reexported.lessons.map((l) => l.document.exercises),
      file.lessons.map((l) => l.document.exercises),
      'every Exercise keeps its Kind, its answers and what it offers',
    );
    assert.deepEqual(
      reexported.lessons.map((l) => l.document.title),
      file.lessons.map((l) => l.document.title),
      'and the Lessons keep their order',
    );
    assert.deepEqual(
      reexported.lessons.map((l) => l.acceptedVariants),
      file.lessons.map((l) => l.acceptedVariants),
      'Accepted Variants come across — they are content, not progress',
    );
    assert.deepEqual(reexported.tests, file.tests, 'Tests keep their thresholds and Exercises');

    // The images are the same bytes under names this box generated.
    assert.deepEqual(Object.values(reexported.images), Object.values(file.images));
    assert.equal(Object.keys(reexported.images).length, 1);
  } finally {
    target.cleanup();
  }
});

test('an import never touches an existing Course: the same file twice is two Courses', () => {
  const { text } = sourceFile();
  const target = box(true);
  try {
    const before = coursesIn(target.db);

    const first = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, text);
    const second = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, text);
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.course.id, second.course.id);

    const after = coursesIn(target.db);
    assert.equal(after.length, before.length + 2);
    // The Course that was already here is byte-for-byte what it was: a merge
    // could silently orphan the Submissions made against Exercises it thought it
    // was replacing, so the safe operation is the only one on offer.
    assert.deepEqual(after.slice(0, before.length), before);

    const firstLessons = target.db.select().from(lessons).where(eq(lessons.courseId, first.course.id)).all();
    const secondLessons = target.db.select().from(lessons).where(eq(lessons.courseId, second.course.id)).all();
    assert.equal(firstLessons.length, secondLessons.length);
    assert.notDeepEqual(firstLessons.map((l) => l.id), secondLessons.map((l) => l.id));
  } finally {
    target.cleanup();
  }
});

test('imported Lessons and Tests arrive published, in order, and readable', () => {
  const { text } = sourceFile();
  const target = box(false);
  try {
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, text);
    assert.ok(result.ok);

    const arrived = target.db.select().from(lessons)
      .where(eq(lessons.courseId, result.course.id)).orderBy(asc(lessons.position)).all();

    assert.deepEqual(arrived.map((l) => l.position), [1, 2]);
    assert.ok(arrived.every((l) => l.publishedAt !== null),
      'a restored Course a Student cannot see is not a restored Course');
    assert.equal(result.lessons, 2);
    assert.equal(result.tests, 1);
    assert.equal(result.images, 1);
  } finally {
    target.cleanup();
  }
});

test('the application names every stored image, and rewrites the Theory to match', () => {
  const { text } = sourceFile();
  const target = box(false);
  try {
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, text);
    assert.ok(result.ok);

    const stored = readdirSync(target.uploadDir);
    assert.equal(stored.length, 1);
    assert.ok(isStoredImageName(stored[0]!), 'a name this application generated');
    assert.notEqual(stored[0], IMAGE_NAME, 'and never the one the file suggested');
    assert.deepEqual(readFileSync(join(target.uploadDir, stored[0]!)), PNG);

    const theory = target.db.select().from(lessons)
      .where(eq(lessons.courseId, result.course.id)).orderBy(asc(lessons.position)).all()[0]!.theoryMarkdown;
    assert.ok(theory.includes(imageUrl(stored[0]!)), 'the Theory points at the stored name');
    assert.ok(!theory.includes(IMAGE_NAME), 'and no longer at the one in the file');
  } finally {
    target.cleanup();
  }
});

test('a name in the file can never become part of a path', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const hostile = {
      ...file,
      lessons: file.lessons.map((lesson, index) => index !== 0 ? lesson : {
        ...lesson,
        document: {
          ...lesson.document,
          theoryMarkdown: `![](${imageUrl('../../../../etc/passwd')})\n![](/api/uploads/x.png)`,
        },
      }),
      images: { '../../../../etc/passwd': PNG.toString('base64'), 'x.png': PNG.toString('base64') },
    };

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, JSON.stringify(hostile));
    assert.ok(result.ok, 'the Course still imports — the names are simply not usable');

    for (const name of readdirSync(target.uploadDir)) {
      assert.ok(isStoredImageName(name), `${name} is not a name this application generated`);
    }
  } finally {
    target.cleanup();
  }
});

test('a file written before accepted answers became per-gap still imports', () => {
  // The one tolerance in the codebase for the flat shape, and it is permanent:
  // an export is a restore format, so a version 1 file has to keep reading after
  // every later change to what an Exercise holds.
  const { file } = sourceFile();
  const target = box(false);
  try {
    const asVersionOne = JSON.stringify({
      ...file,
      version: 1,
      lessons: file.lessons.map((lesson) => ({
        ...lesson,
        document: {
          ...lesson.document,
          exercises: lesson.document.exercises.map((exercise) => ({
            ...exercise,
            acceptedAnswers: (exercise.acceptedAnswers ?? []).flat(),
          })),
        },
      })),
      tests: file.tests.map((entry) => ({
        ...entry,
        document: {
          ...entry.document,
          exercises: entry.document.exercises.map((exercise) => ({
            ...exercise,
            acceptedAnswers: (exercise.acceptedAnswers ?? []).flat(),
          })),
        },
      })),
    });

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, asVersionOne);
    assert.ok(result.ok, `import refused: ${JSON.stringify(result.ok ? [] : result.faults)}`);

    const reexported = assembleCourseExport(target.db, result.course.id, target.uploadDir)!;
    assert.equal(reexported.version, COURSE_EXPORT_VERSION, 'and it comes back out in the current format');
    assert.deepEqual(
      reexported.lessons.map((l) => l.document.exercises),
      file.lessons.map((l) => l.document.exercises),
      'every flat list arrived as the single position it always was',
    );
    assert.deepEqual(reexported.tests, file.tests, 'a Test\'s Exercises the same way');
  } finally {
    target.cleanup();
  }
});

test('a file this build does not understand is refused rather than guessed at', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const fromTheFuture = JSON.stringify({ ...file, version: file.version + 1 });
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, fromTheFuture);

    assert.ok(!result.ok);
    assert.deepEqual(result.faults.map((f) => f.code), ['version_unknown']);
    assert.equal(coursesIn(target.db).length, 0, 'and nothing was written');
  } finally {
    target.cleanup();
  }
});

test('a truncated file is refused rather than partially imported', () => {
  const { text } = sourceFile();
  const target = box(false);
  try {
    const truncated = text.slice(0, Math.floor(text.length * 0.6));
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, truncated);

    assert.ok(!result.ok);
    assert.deepEqual(result.faults.map((f) => f.code), ['not_json']);
    assert.equal(coursesIn(target.db).length, 0);
    assert.deepEqual(readdirSync(target.uploadDir), [], 'not even an image');
  } finally {
    target.cleanup();
  }
});

test('a file that fails the validity rules is refused by name, with nothing written', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const broken = {
      ...file,
      lessons: file.lessons.map((lesson, index) => index !== 1 ? lesson : {
        ...lesson,
        document: { ...lesson.document, theoryMarkdown: '   ', grammarFocus: '' },
      }),
    };

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, JSON.stringify(broken));
    assert.ok(!result.ok);

    const codes = result.faults.map((f) => f.code);
    assert.ok(codes.includes('theory_empty'), 'the rules are the ones the authoring screens use');
    assert.ok(codes.includes('grammar_focus_empty'));
    assert.ok(result.faults.every((f) => f.lessonPosition === 2), 'and they say which Lesson');
    assert.equal(coursesIn(target.db).length, 0);
    assert.deepEqual(readdirSync(target.uploadDir), []);
  } finally {
    target.cleanup();
  }
});

test('an image in the file is sniffed and capped exactly as an upload is', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const notAnImage = {
      ...file,
      images: { [IMAGE_NAME]: Buffer.from('<svg onload=alert(1)>').toString('base64') },
    };
    const refused = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, JSON.stringify(notAnImage));
    assert.ok(!refused.ok);
    assert.deepEqual(refused.faults.map((f) => f.code), ['image_not_an_image']);

    const tooLarge = importCourse(
      target.db,
      { uploadDir: target.uploadDir, maxImageBytes: 4 },
      JSON.stringify(file),
    );
    assert.ok(!tooLarge.ok);
    assert.deepEqual(tooLarge.faults.map((f) => f.code), ['image_too_large']);

    assert.equal(coursesIn(target.db).length, 0);
    assert.deepEqual(readdirSync(target.uploadDir), []);
  } finally {
    target.cleanup();
  }
});

test('Accepted Variants that do not line up with the Exercises are refused', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const misaligned = {
      ...file,
      lessons: file.lessons.map((lesson, index) => index !== 0 ? lesson : {
        ...lesson, acceptedVariants: [['the']],
      }),
    };

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, JSON.stringify(misaligned));
    assert.ok(!result.ok);
    assert.deepEqual(result.faults.map((f) => f.code), ['variants_misaligned']);
    assert.equal(coursesIn(target.db).length, 0);
  } finally {
    target.cleanup();
  }
});

test('a file naming no Grader model gets the Language default, not a Course that cannot grade', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    // Hand-edited, or written by something other than the export: the format is
    // the human-readable one, so this is a file somebody will actually produce.
    // The validity rules pass it — a blank model takes ADR 0002's default for
    // the Language — and the Course has to be created with the model it was
    // judged on, or every Submission in it reaches the Grader as `{ model: '' }`
    // and is refused.
    const blank = { ...file, course: { ...file.course, graderModel: '' } };

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, JSON.stringify(blank));
    assert.ok(result.ok);
    assert.equal(result.course.graderModel, DEFAULT_GRADER_MODEL[file.course.language]);
  } finally {
    target.cleanup();
  }
});

test('something that is not an export at all is refused as such', () => {
  const target = box(false);
  try {
    for (const notAnExport of ['{}', '[]', '"a string"', 'null', '{"version":1}']) {
      const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, notAnExport);
      assert.ok(!result.ok, `${notAnExport} was accepted`);
      assert.deepEqual(result.faults.map((f) => f.code), ['not_an_export'], notAnExport);
    }
    assert.equal(coursesIn(target.db).length, 0);
  } finally {
    target.cleanup();
  }
});

test('a file written before Courses carried an Effort imports as low, not as the default', () => {
  // The same permanence the per-gap tolerance has, and the same reason: an
  // export is a restore format. A version 2 file describes a Course that was
  // grading at `low`, so that is what it has to come back as — reading it as
  // «По умолчанию» would restore a Course that grades differently from the one
  // somebody exported.
  const { file } = sourceFile();
  const target = box(false);
  try {
    const { graderEffort: _dropped, ...course } = file.course;
    const asVersionTwo = JSON.stringify({ ...file, version: 2, course });

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, asVersionTwo);
    assert.ok(result.ok, `import refused: ${JSON.stringify(result.ok ? [] : result.faults)}`);
    assert.equal(result.course.graderEffort, 'low');
  } finally {
    target.cleanup();
  }
});

test('«По умолчанию» survives the round trip as itself', () => {
  // Null is a real answer — the parameter is not sent to the model at all — so
  // it travels as null rather than as an absent key. An absent key means "written
  // before Courses had an Effort", and the two are different Courses.
  const { file } = sourceFile();
  const target = box(false);
  try {
    const asDefault = JSON.stringify({ ...file, course: { ...file.course, graderEffort: null } });

    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, asDefault);
    assert.ok(result.ok, `import refused: ${JSON.stringify(result.ok ? [] : result.faults)}`);
    assert.equal(result.course.graderEffort, null);

    const reexported = assembleCourseExport(target.db, result.course.id, target.uploadDir)!;
    assert.equal(reexported.course.graderEffort, null);
  } finally {
    target.cleanup();
  }
});

test('a file claiming the current version with an Effort that is not one is refused', () => {
  const { file } = sourceFile();
  const target = box(false);
  try {
    const broken = JSON.stringify({ ...file, course: { ...file.course, graderEffort: 'enormous' } });
    const result = importCourse(target.db, { uploadDir: target.uploadDir, ...LIMITS }, broken);
    assert.ok(!result.ok);
    assert.deepEqual(result.faults.map((fault) => fault.code), ['not_an_export'],
      'a file that claims 3 and holds something that is not an Effort is broken, not old');
  } finally {
    target.cleanup();
  }
});
