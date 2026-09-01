// The fixture the vertical slice is built on, seeded into a throwaway database
// and read back through the same modules the application reads it with — not
// through a query written for the test, which could pass while the screens see
// nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { ENGLISH_A1, type CourseFixture } from '../src/content/english-a1.ts';
import { courses, lessons, exercises, exerciseSets, students, submissions, isDeterministic } from '../src/db/schema.ts';
import { enrolledCourses, openLesson, courseOutline } from '../src/practice/lessons.ts';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'student', password: 'staple monkey trombone', isAdmin: false }]);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

function theStudent(db: ReturnType<typeof freshDatabase>['db']) {
  return db.select().from(students).where(eq(students.username, 'student')).get()!;
}

test('the fixture seeds one Course with its Lessons, and the Lesson is reachable through the application\'s own modules', () => {
  const dbh = freshDatabase();
  try {
    const result = seedCourseContent(dbh.db);
    assert.equal(result.courseAction, 'created');

    const student = theStudent(dbh.db);
    const held = enrolledCourses(dbh.db, student.id);
    assert.equal(held.length, 1, 'the seeded Student is enrolled — nothing else enrolls anyone yet');
    assert.equal(held[0]!.title, ENGLISH_A1.title);
    assert.equal(held[0]!.graderModel, 'claude-sonnet-5', 'ADR 0002 — English grades on Sonnet');

    const outline = courseOutline(dbh.db, student.id, held[0]!.id);
    assert.equal(outline.length, ENGLISH_A1.lessons.length);

    const opened = openLesson(dbh.db, student.id, outline[0]!.lesson.id);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    assert.equal(opened.lesson.title, ENGLISH_A1.lessons[0]!.title);
    assert.deepEqual(
      opened.exercises.map((e) => e.position),
      ENGLISH_A1.lessons[0]!.practice.map((_, i) => i + 1),
      'Exercises come back in the Exercise Set\'s order',
    );
    assert.deepEqual(
      opened.exercises.map((e) => e.kind),
      ENGLISH_A1.lessons[0]!.practice.map((e) => e.kind),
    );
  } finally { dbh.cleanup(); }
});

test('running the seed twice leaves one Lesson, not two', () => {
  const dbh = freshDatabase();
  try {
    seedCourseContent(dbh.db);
    const again = seedCourseContent(dbh.db);
    assert.equal(again.courseAction, 'updated');

    assert.equal(dbh.db.select().from(courses).all().length, 1, 'one Course');
    assert.equal(dbh.db.select().from(lessons).all().length, ENGLISH_A1.lessons.length, 'and its Lessons, once each');
    assert.equal(
      dbh.db.select().from(exercises).all().length,
      ENGLISH_A1.lessons.reduce((n, l) => n + l.practice.length, 0),
      'and one copy of each Exercise',
    );

    const student = theStudent(dbh.db);
    assert.equal(enrolledCourses(dbh.db, student.id).length, 1, 'and one Enrollment');
  } finally { dbh.cleanup(); }
});

test('re-seeding an edited fixture updates the Lesson in place and keeps the Student\'s work', () => {
  // Re-seeding is how a typo in a Reference Answer gets fixed. Deleting and
  // re-inserting the Exercise would cascade to every Submission made against it.
  const dbh = freshDatabase();
  try {
    seedCourseContent(dbh.db);
    const student = theStudent(dbh.db);
    const first = dbh.db.select().from(exercises).where(eq(exercises.position, 1)).all()[0]!;

    dbh.db.insert(submissions).values({
      studentId: student.id, exerciseId: first.id, attempt: 1, answer: 'a',
      status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
      feedbackRu: null, corrected: null, createdAt: new Date(),
    }).run();

    const edited = structuredClone(ENGLISH_A1);
    edited.lessons[0]!.practice[0]!.prompt = 'Вставьте артикль: I have ___ orange.';
    seedCourseContent(dbh.db, edited);

    const after = dbh.db.select().from(exercises).where(eq(exercises.id, first.id)).get();
    assert.equal(after?.prompt, 'Вставьте артикль: I have ___ orange.', 'the edit landed');
    assert.equal(
      dbh.db.select().from(submissions).all().length, 1,
      'and the Submission survived — the Exercise was updated, not replaced',
    );
  } finally { dbh.cleanup(); }
});

test('the Lesson carries real Theory and a real grammar focus, not a placeholder', () => {
  // The grammar focus is handed to the Grader as context on every call, so a
  // placeholder here would quietly degrade every Verdict in the slice.
  for (const lesson of ENGLISH_A1.lessons) {
    assert.ok(lesson.theoryMarkdown.length > 200, `${lesson.title}: Theory is substantial`);
    assert.match(lesson.theoryMarkdown, /^##? /m, 'Theory is markdown, with structure');
    assert.ok(lesson.grammarFocus.length > 30, `${lesson.title}: the grammar focus says something`);
    assert.ok(
      !/TODO|placeholder|заглушка|lorem/i.test(lesson.theoryMarkdown + lesson.grammarFocus),
      `${lesson.title}: nothing left to fill in`,
    );
  }
});

test('the Practice contains Exercises of both judgement classes', () => {
  const practice = ENGLISH_A1.lessons[0]!.practice;
  assert.ok(practice.some((e) => isDeterministic(e.kind)), 'at least one Deterministic Check Exercise');
  assert.ok(practice.some((e) => !isDeterministic(e.kind)), 'at least one Grader-judged Exercise');

  // Every Kind renders its own input (#17), so the fixture exercises all six.
  const kinds = new Set(ENGLISH_A1.lessons.flatMap((l) => l.practice.map((e) => e.kind)));
  for (const kind of ['fill_gap', 'multiple_choice', 'word_order', 'translation', 'composition', 'open_writing']) {
    assert.ok(kinds.has(kind as never), `the fixture covers ${kind}`);
  }
});

test('the Deterministic Check Exercises carry what a Deterministic Check needs', () => {
  const deterministic = ENGLISH_A1.lessons.flatMap((l) => l.practice).filter((e) => isDeterministic(e.kind));

  for (const exercise of deterministic) {
    assert.ok(
      (exercise.acceptedAnswers ?? []).flat().length > 0,
      `${exercise.prompt}: an Exercise judged in code needs something to compare against`,
    );
  }

  assert.ok(
    deterministic.some((e) => (e.acceptedAnswers ?? []).flat().length > 1),
    'at least one stores several accepted answers at its one gap',
  );
  assert.ok(
    deterministic.some((e) => e.caseSensitive === true),
    'at least one is the Exercise where capitalisation is the point',
  );

  for (const exercise of deterministic.filter((e) => e.kind !== 'fill_gap')) {
    assert.ok(
      (exercise.choices ?? []).length > 1,
      `${exercise.prompt}: multiple choice needs its options and word order its fragments`,
    );
  }

  // A multiple choice whose correct answer is not among the options is unanswerable.
  for (const exercise of deterministic.filter((e) => e.kind === 'multiple_choice')) {
    for (const accepted of (exercise.acceptedAnswers ?? []).flat()) {
      assert.ok(
        (exercise.choices ?? []).includes(accepted),
        `${exercise.prompt}: the accepted answer ${JSON.stringify(accepted)} is one of the options`,
      );
    }
  }
});

test('every seeded Exercise Set is owned by a Lesson\'s Practice and never by a Test', () => {
  const dbh = freshDatabase();
  try {
    seedCourseContent(dbh.db);
    const sets = dbh.db.select().from(exerciseSets).all();
    assert.ok(sets.length > 0);
    for (const set of sets) {
      assert.notEqual(set.lessonId, null, 'owned by a Lesson');
      assert.equal(set.testId, null, 'and by nothing else — the database enforces it, the fixture satisfies it');
    }
  } finally { dbh.cleanup(); }
});

test('a second Lesson exists, so sequential unlocking has something to unlock', () => {
  const dbh = freshDatabase();
  try {
    seedCourseContent(dbh.db);
    const student = theStudent(dbh.db);
    const course = enrolledCourses(dbh.db, student.id)[0]!;
    const outline = courseOutline(dbh.db, student.id, course.id);

    assert.ok(outline.length >= 2, 'there is a next Lesson');
    assert.equal(outline[0]!.unlocked, true, 'the first Lesson is unlocked on enrollment');
    assert.equal(outline[1]!.unlocked, false, 'and the second is not, until the first is finished');
  } finally { dbh.cleanup(); }
});

test('the content seed is separate from the account seed and enrols whoever exists', () => {
  const dbh = freshDatabase();
  try {
    // No content has been seeded yet: the accounts exist and have nowhere to go.
    const student = theStudent(dbh.db);
    assert.equal(enrolledCourses(dbh.db, student.id).length, 0);

    const result = seedCourseContent(dbh.db);
    assert.deepEqual(result.enrolled, ['student']);
    assert.deepEqual(seedCourseContent(dbh.db).enrolled, [], 'and does not enrol twice');
  } finally { dbh.cleanup(); }
});

// --- the validity rules, at the seam where content actually enters the system --

// design.md § Exercise Kinds. The rules themselves are covered exhaustively as a
// pure table in exercise-validity.test.ts; what is asserted here is only that the
// seed consults them, and that it does so before it writes anything.

function fixtureWithABrokenExercise(): CourseFixture {
  const copy = structuredClone(ENGLISH_A1) as CourseFixture;
  const lesson = copy.lessons[1]!;
  // A multiple choice whose Reference Answer is not among the options it offers.
  // Seeded, it would show the Student four options and, on Reveal, a fifth.
  const exercise = lesson.practice.find((e) => e.kind === 'multiple_choice')!;
  exercise.referenceAnswer = 'never offered';
  return copy;
}

test('a fixture with an incoherent Exercise is refused, naming the Lesson and the position', () => {
  const handle = freshDatabase();
  try {
    const broken = fixtureWithABrokenExercise();
    const lesson = broken.lessons[1]!;
    const position = lesson.practice.findIndex((e) => e.kind === 'multiple_choice') + 1;

    assert.throws(
      () => seedCourseContent(handle.db, broken),
      (error: Error) => {
        assert.match(error.message, /reference_answer_not_a_choice/, 'names the rule broken');
        assert.match(error.message, new RegExp(`lesson 2 `), 'names the Lesson by position');
        assert.match(error.message, new RegExp(escapeForRegExp(lesson.title)), 'names the Lesson by title');
        assert.match(error.message, new RegExp(`exercise ${position}\\b`), 'names the Exercise position');
        assert.match(error.message, /never offered/, 'names the offending value');
        return true;
      },
    );
  } finally {
    handle.cleanup();
  }
});

test('a fixture that is wrong anywhere writes nothing at all', () => {
  const handle = freshDatabase();
  try {
    // The broken Exercise is in the second Lesson, so a seed that validated as it
    // went would already have written the first one by the time it noticed.
    assert.throws(() => seedCourseContent(handle.db, fixtureWithABrokenExercise()));

    assert.deepEqual(handle.db.select().from(courses).all(), [], 'no Course');
    assert.deepEqual(handle.db.select().from(lessons).all(), [], 'no Lesson');
    assert.deepEqual(handle.db.select().from(exercises).all(), [], 'no Exercise');
  } finally {
    handle.cleanup();
  }
});

test('re-seeding an already seeded Course is still refused before it overwrites anything', () => {
  const handle = freshDatabase();
  try {
    seedCourseContent(handle.db, ENGLISH_A1);
    const before = handle.db.select().from(exercises).all();

    assert.throws(() => seedCourseContent(handle.db, fixtureWithABrokenExercise()));

    assert.deepEqual(
      handle.db.select().from(exercises).all(),
      before,
      'the Exercises already seeded are untouched',
    );
  } finally {
    handle.cleanup();
  }
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
