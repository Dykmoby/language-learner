import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import {
  courses, lessons, tests as courseTests, exerciseSets, exercises, acceptedVariants,
  EXERCISE_KINDS,
} from '../src/db/schema.ts';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

function aCourse(db: ReturnType<typeof freshDatabase>['db']) {
  return db.insert(courses).values({
    language: 'en', level: 'A1', graderModel: 'claude-sonnet-5',
    title: 'English A1', createdAt: new Date(),
  }).returning().get();
}

test('a Course records its Language, its CEFR level and its Grader model', () => {
  // ADR 0002 — English and Tajik are graded by different models, and either can
  // be overridden per Course without a code change.
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    assert.equal(course.language, 'en');
    assert.equal(course.level, 'A1');
    assert.equal(course.graderModel, 'claude-sonnet-5');

    const tajik = dbh.db.insert(courses).values({
      language: 'tj', level: 'A1', graderModel: 'claude-opus-5',
      title: 'Тоҷикӣ A1', createdAt: new Date(),
    }).returning().get();
    assert.equal(tajik.graderModel, 'claude-opus-5', 'the model is per-Course data, not a code branch');
  } finally { dbh.cleanup(); }
});

test('Lessons are ordered within a Course and carry Theory markdown and a grammar focus', () => {
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    dbh.db.insert(lessons).values([
      { courseId: course.id, position: 2, title: 'Второй', theoryMarkdown: '## Второй', grammarFocus: 'Past Simple' },
      { courseId: course.id, position: 1, title: 'Первый', theoryMarkdown: '## Первый', grammarFocus: 'Present Simple' },
    ]).run();

    const ordered = dbh.db.select().from(lessons).orderBy(lessons.position).all();
    assert.deepEqual(ordered.map((l) => l.title), ['Первый', 'Второй'],
      'sequential unlocking needs a defined sequence to follow');
    assert.equal(ordered[0]?.grammarFocus, 'Present Simple',
      'the grammar focus is handed to the Grader as context on every call');
  } finally { dbh.cleanup(); }
});

test('two Lessons in one Course cannot claim the same position', () => {
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    dbh.db.insert(lessons).values({ courseId: course.id, position: 1, title: 'A', theoryMarkdown: '', grammarFocus: '' }).run();
    assert.throws(
      () => dbh.db.insert(lessons).values({ courseId: course.id, position: 1, title: 'B', theoryMarkdown: '', grammarFocus: '' }).run(),
      /UNIQUE|constraint/i,
    );
  } finally { dbh.cleanup(); }
});

test('SQLite rejects an Exercise Set owned by both a Practice and a Test', () => {
  // The invariant belongs to the database, not to application code, so nobody
  // has to remember it.
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    const lesson = dbh.db.insert(lessons).values({
      courseId: course.id, position: 1, title: 'Урок', theoryMarkdown: '', grammarFocus: '',
    }).returning().get();
    const courseTest = dbh.db.insert(courseTests).values({
      courseId: course.id, title: 'Тест', passThreshold: 80,
    }).returning().get();

    assert.throws(
      () => dbh.db.insert(exerciseSets).values({ lessonId: lesson.id, testId: courseTest.id }).run(),
      /CHECK|constraint/i,
    );
  } finally { dbh.cleanup(); }
});

test('SQLite rejects an Exercise Set owned by neither', () => {
  const dbh = freshDatabase();
  try {
    assert.throws(
      () => dbh.db.insert(exerciseSets).values({ lessonId: null, testId: null }).run(),
      /CHECK|constraint/i,
    );
  } finally { dbh.cleanup(); }
});

test('an Exercise Set owned by exactly one owner is accepted, either way round', () => {
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    const lesson = dbh.db.insert(lessons).values({
      courseId: course.id, position: 1, title: 'Урок', theoryMarkdown: '', grammarFocus: '',
    }).returning().get();
    const courseTest = dbh.db.insert(courseTests).values({
      courseId: course.id, title: 'Тест', passThreshold: 80,
    }).returning().get();

    const practiceSet = dbh.db.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();
    const testSet = dbh.db.insert(exerciseSets).values({ lessonId: null, testId: courseTest.id }).returning().get();

    assert.ok(practiceSet.id);
    assert.ok(testSet.id);
    assert.notEqual(practiceSet.id, testSet.id);
  } finally { dbh.cleanup(); }
});

test('a Test is owned by a Course and carries a pass threshold', () => {
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    const courseTest = dbh.db.insert(courseTests).values({
      courseId: course.id, title: 'Итоговый тест', passThreshold: 80,
    }).returning().get();
    assert.equal(courseTest.courseId, course.id);
    assert.equal(courseTest.passThreshold, 80, 'design.md § Tests: default 80%');
  } finally { dbh.cleanup(); }
});

test('the Exercise Kinds are exactly the six in design.md § Exercise Kinds', () => {
  // Read back out of design.md rather than restated, so the two cannot drift.
  const doc = readFileSync(new URL('../docs/design.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('### Exercise Kinds'), doc.indexOf('### Deterministic Check normalisation'));
  const documented = [...section.matchAll(/^\| ([A-Z][a-z-]*(?: [a-z-]+)*) \|/gm)]
    .map((m) => m[1]!.trim().toLowerCase().replace(/[ -]/g, '_'))
    .filter((k) => k !== 'kind');

  assert.equal(documented.length, 6, 'design.md documents six Kinds');
  assert.deepEqual([...EXERCISE_KINDS].sort(), documented.sort());
});

test('a Deterministic Check Exercise stores an array of accepted answers and a case-sensitivity flag', () => {
  // design.md § Deterministic Check normalisation — the array plus the flag is
  // what makes "put the word in the correct form" able to demand capitalisation
  // while ordinary Exercises ignore it.
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    const lesson = dbh.db.insert(lessons).values({
      courseId: course.id, position: 1, title: 'Урок', theoryMarkdown: '', grammarFocus: '',
    }).returning().get();
    const set = dbh.db.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();

    const exercise = dbh.db.insert(exercises).values({
      exerciseSetId: set.id, position: 1, kind: 'fill_gap',
      prompt: 'Вставьте артикль: I have __ cat.',
      referenceAnswer: 'a',
      acceptedAnswers: ['a', 'one'],
      caseSensitive: true,
    }).returning().get();

    assert.deepEqual(exercise.acceptedAnswers, ['a', 'one'], 'an array, not a single string');
    assert.equal(exercise.caseSensitive, true);
  } finally { dbh.cleanup(); }
});

test('every Exercise belongs to an Exercise Set', () => {
  // Ordering, rendering and grading never branch on "am I in a Lesson or a Test".
  const dbh = freshDatabase();
  try {
    assert.throws(
      () => dbh.db.insert(exercises).values({
        exerciseSetId: 9999, position: 1, kind: 'translation',
        prompt: 'x', referenceAnswer: 'y', acceptedAnswers: [], caseSensitive: false,
      }).run(),
      /FOREIGN KEY|constraint/i,
    );
  } finally { dbh.cleanup(); }
});

test('Accepted Variants are stored separately from the Reference Answer', () => {
  // Resolving a Dispute later grows the accepted set without rewriting the
  // author's canonical answer.
  const dbh = freshDatabase();
  try {
    const course = aCourse(dbh.db);
    const lesson = dbh.db.insert(lessons).values({
      courseId: course.id, position: 1, title: 'Урок', theoryMarkdown: '', grammarFocus: '',
    }).returning().get();
    const set = dbh.db.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();
    const exercise = dbh.db.insert(exercises).values({
      exerciseSetId: set.id, position: 1, kind: 'translation',
      prompt: 'Переведите: У меня есть кошка.', referenceAnswer: 'I have a cat.',
      acceptedAnswers: [], caseSensitive: false,
    }).returning().get();

    dbh.db.insert(acceptedVariants).values({
      exerciseId: exercise.id, value: 'I have got a cat.', createdAt: new Date(),
    }).run();

    const unchanged = dbh.db.select().from(exercises).where(eq(exercises.id, exercise.id)).get()!;
    assert.equal(unchanged.referenceAnswer, 'I have a cat.', "the author's canonical answer is untouched");

    const variants = dbh.db.select().from(acceptedVariants).where(eq(acceptedVariants.exerciseId, exercise.id)).all();
    assert.deepEqual(variants.map((v) => v.value), ['I have got a cat.']);
  } finally { dbh.cleanup(); }
});
