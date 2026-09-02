// What one file has to carry for a Course to be rebuilt somewhere else — and,
// just as load-bearing, what it must not carry off the box with it.
//
// design.md § Operations calls this "the human-readable, restore-anywhere
// format", so the shape is asserted rather than snapshotted: somebody will read
// this file in a text editor at some point, and #56 will read it back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, asc } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import {
  acceptedVariants, courses, exercises, exerciseSets, lessons, students, submissions,
} from '../src/db/schema.ts';
import { createTest, saveTest, publishTest } from '../src/admin/tests.ts';
import { createLesson } from '../src/admin/authoring.ts';
import { assembleCourseExport, COURSE_EXPORT_VERSION } from '../src/admin/course-export.ts';
import { imageUrl } from '../src/content/uploads.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const IMAGE_NAME = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.png';

function fresh() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'igor', password: 'correct horse battery', isAdmin: true }]);
  seedCourseContent(handle.db, DETERMINISTIC_COURSE);

  const uploadDir = mkdtempSync(join(tmpdir(), 'language-learner-export-'));
  return {
    db: handle.db,
    uploadDir,
    cleanup: () => { handle.close(); cleanup(); rmSync(uploadDir, { recursive: true, force: true }); },
  };
}

type Db = ReturnType<typeof fresh>['db'];

const theCourse = (db: Db) => db.select().from(courses)
  .where(eq(courses.title, DETERMINISTIC_COURSE.title)).get()!;

function exercisesOfFirstLesson(db: Db) {
  const lesson = db.select().from(lessons).orderBy(asc(lessons.position)).all()[0]!;
  const set = db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lesson.id)).get()!;
  return db.select().from(exercises).where(eq(exercises.exerciseSetId, set.id))
    .orderBy(asc(exercises.position)).all();
}

test('the file carries the Course, its published Lessons in order, and its Tests', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const course = theCourse(db);

    const created = createTest(db, { courseId: course.id, title: 'Контрольная 1', passThreshold: 70 });
    assert.ok(created.ok);
    const saved = saveTest(db, created.test.id, {
      title: 'Контрольная 1',
      passThreshold: 70,
      exercises: [{
        kind: 'fill_gap', prompt: 'Вставьте артикль: ___ apple', referenceAnswer: 'an',
        acceptedAnswers: [['an']], caseSensitive: false, choices: [],
      }],
    });
    assert.ok(saved.ok);
    assert.ok(publishTest(db, created.test.id).ok);

    // A second Test, created and never published. Nobody has sat it, and it does
    // not leave the box — the rule an unpublished Lesson already follows.
    assert.ok(createTest(db, { courseId: course.id, title: 'Черновик работы' }).ok);

    const file = assembleCourseExport(db, course.id, uploadDir);
    assert.ok(file !== null);

    assert.equal(file.version, COURSE_EXPORT_VERSION, 'the format says which one it is');
    assert.deepEqual(file.course, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5',
      // Issue #76 — the Effort travels with the Course, so a restored Course
      // grades the way the exported one did.
      graderEffort: 'low',
      // Issue #80 — and the Course's own instruction, empty on one that has none.
      graderInstruction: '',
      title: DETERMINISTIC_COURSE.title,
    });

    assert.deepEqual(
      file.lessons.map((entry) => entry.document.title),
      ['Первый урок', 'Второй урок'],
      'Lessons keep the order they are worked through in',
    );
    assert.equal(file.lessons[0]!.document.exercises.length, 3);
    assert.deepEqual(
      file.lessons[0]!.document.exercises[1],
      {
        kind: 'multiple_choice',
        prompt: 'Выберите вариант: I have ___ apple.',
        referenceAnswer: 'an',
        acceptedAnswers: [['an']],
        caseSensitive: false,
        choices: ['a', 'an', 'the'],
      },
      'an Exercise travels with its Kind, its answers and what it offers — and with no row id',
    );

    assert.equal(file.tests.length, 1, 'the unpublished one stays behind, as an unpublished Lesson does');
    assert.equal(file.tests[0]!.document.passThreshold, 70, 'a Test carries the threshold it is read against');
    assert.equal(file.tests[0]!.document.exercises.length, 1);
  } finally {
    cleanup();
  }
});

test('Accepted Variants travel with the Exercise that earned them, and with their Gaps', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const course = theCourse(db);
    const [first, second] = exercisesOfFirstLesson(db);
    db.insert(acceptedVariants).values([
      { exerciseId: second!.id, value: 'an ', gap: null, createdAt: new Date() },
      { exerciseId: second!.id, value: 'AN', gap: 0, createdAt: new Date() },
    ]).run();

    const file = assembleCourseExport(db, course.id, uploadDir)!;
    const variants = file.lessons[0]!.acceptedVariants;

    assert.equal(variants.length, file.lessons[0]!.document.exercises.length,
      'one entry per Exercise, in the same order — nothing to misalign');
    assert.deepEqual(variants[0], [], 'an Exercise nobody disputed carries an empty list');
    // #85 — the position travels with the value. A restored Course whose
    // variants lost their Gaps would start accepting each of them everywhere.
    assert.deepEqual(variants[1], [
      { value: 'an ', gap: null },
      { value: 'AN', gap: 0 },
    ]);
    assert.ok(first);
  } finally {
    cleanup();
  }
});

test('Theory images travel inlined, keyed by the name the Theory points at', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const course = theCourse(db);
    writeFileSync(join(uploadDir, IMAGE_NAME), PNG);

    const lesson = db.select().from(lessons).orderBy(asc(lessons.position)).all()[0]!;
    db.update(lessons).set({
      theoryMarkdown: `## Урок\n\n![кошка](${imageUrl(IMAGE_NAME)})\n\nи ещё раз ![](${imageUrl(IMAGE_NAME)})`,
    }).where(eq(lessons.id, lesson.id)).run();

    const file = assembleCourseExport(db, course.id, uploadDir)!;

    assert.deepEqual(Object.keys(file.images), [IMAGE_NAME], 'once, however many times it is used');
    assert.equal(file.images[IMAGE_NAME], PNG.toString('base64'));
    assert.ok(file.lessons[0]!.document.theoryMarkdown.includes(imageUrl(IMAGE_NAME)),
      'and the Theory still points at it by name');
  } finally {
    cleanup();
  }
});

test('an image the Theory points at and the folder has lost is left out rather than fatal', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const course = theCourse(db);
    const lesson = db.select().from(lessons).orderBy(asc(lessons.position)).all()[0]!;
    db.update(lessons).set({ theoryMarkdown: `![](${imageUrl(IMAGE_NAME)})` })
      .where(eq(lessons.id, lesson.id)).run();

    const file = assembleCourseExport(db, course.id, uploadDir)!;
    assert.deepEqual(file.images, {}, 'an export is not the place to discover a missing file');
  } finally {
    cleanup();
  }
});

test('nothing of a Student travels with the content', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const course = theCourse(db);
    const student = db.select().from(students).get()!;
    const [exercise] = exercisesOfFirstLesson(db);

    db.insert(submissions).values({
      studentId: student.id, exerciseId: exercise!.id, attempt: 1,
      answer: 'ЭТОТ-ОТВЕТ-НЕ-ДОЛЖЕН-УЕХАТЬ', status: 'graded',
      proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
      feedbackRu: 'нет', corrected: null, createdAt: new Date(),
    }).run();

    const serialised = JSON.stringify(assembleCourseExport(db, course.id, uploadDir));

    assert.ok(!serialised.includes('ЭТОТ-ОТВЕТ-НЕ-ДОЛЖЕН-УЕХАТЬ'), 'no Submissions');
    assert.ok(!serialised.includes(student.username), 'no Students');
    assert.ok(!serialised.includes('enrollment'), 'no Enrollments');
    assert.ok(!serialised.includes('draft'), 'no Drafts');
  } finally {
    cleanup();
  }
});

test('a Course with nothing in it yet exports without special-casing', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    const admin = db.select().from(students).get()!;
    const bare = db.insert(courses).values({
      language: 'tj', level: 'B1', graderModel: 'claude-opus-5',
      title: 'Пустой курс', createdAt: new Date(),
    }).returning().get();

    // One Lesson, created through the authoring screens and never published: it
    // is a Draft nobody has read, and it does not leave the box.
    assert.ok(createLesson(db, { courseId: bare.id, title: 'Черновик', studentId: admin.id }).ok);

    const file = assembleCourseExport(db, bare.id, uploadDir)!;

    assert.deepEqual(file.lessons, []);
    assert.deepEqual(file.tests, []);
    assert.deepEqual(file.images, {});
    assert.equal(file.course.title, 'Пустой курс');
  } finally {
    cleanup();
  }
});

test('there is no file for a Course that does not exist', () => {
  const { db, uploadDir, cleanup } = fresh();
  try {
    assert.equal(assembleCourseExport(db, 9999, uploadDir), null);
  } finally {
    cleanup();
  }
});
