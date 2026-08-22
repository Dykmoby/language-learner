// Seam 2 — what a Student gets wrong, counted, against a throwaway database.
//
// The claim that carries the most weight here is the grouping one: the stable
// enum value is what is counted, never the Russian label. `plural_form` and
// `plural_form_tj` are both «Множественное число», and a histogram that merged
// them would be adding up two different mistakes and calling the total a fact.
//
// The second is ADR 0005's: a Test's answers are Submissions, so its Errors are
// in the same count as a Practice's. A Test is where a Student writes at greatest
// length with no Progressive Hint to lean on, so those are the most informative
// Errors there are, and a histogram that quietly omitted them would be the wrong
// answer to the only question this screen exists for.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import {
  exercises, exerciseSets, students, submissionErrors, submissions,
} from '../src/db/schema.ts';
import { errorHistogram, errorsByLesson } from '../src/progress/errors.ts';
import { createTest, saveTest, publishTest } from '../src/admin/tests.ts';
import { submitAttempt } from '../src/tests/taking.ts';
import { ru, errorTypeLabel } from '../src/ru.ts';

let handle: DatabaseHandle;
let cleanup: (() => void) | undefined;
let studentId: number;
let otherStudentId: number;
let courseId: number;
/** Two Lessons' worth, in order: [lesson one's three, lesson two's one]. */
let lessonExerciseIds: number[][] = [];

before(() => {
  const temp = tempDatabasePath();
  cleanup = temp.cleanup;
  handle = openDatabase(temp.path);
  runMigrations(handle);
  seedStudents(handle.db, [
    { username: 'student', password: 'staple monkey trombone', isAdmin: false },
    { username: 'nobody', password: 'staple monkey trombone', isAdmin: false },
  ]);
  const seeded = seedCourseContent(handle.db, DETERMINISTIC_COURSE);
  courseId = seeded.courseId;

  const accounts = handle.db.select().from(students).all();
  studentId = accounts[0]!.id;
  otherStudentId = accounts[1]!.id;

  lessonExerciseIds = handle.db.select().from(exerciseSets).all()
    .filter((set) => set.lessonId !== null)
    .sort((a, b) => a.lessonId! - b.lessonId!)
    .map((set) => handle.db.select().from(exercises)
      .where(eq(exercises.exerciseSetId, set.id)).all()
      .sort((a, b) => a.position - b.position)
      .map((row) => row.id));
});

after(() => {
  handle?.close();
  cleanup?.();
});

let attempts = 0;

/** One judged Submission carrying the named Errors. */
function errorsOn(exerciseId: number, types: readonly string[], whose = studentId): void {
  attempts += 1;
  const submission = handle.db.insert(submissions).values({
    studentId: whose,
    exerciseId,
    attempt: attempts,
    answer: 'что-то не то',
    testAttemptId: null,
    status: 'graded',
    failureReason: null,
    proposedVerdict: 'incorrect',
    guardedVerdict: 'incorrect',
    feedbackRu: 'Есть ошибки.',
    corrected: null,
    createdAt: new Date(),
  }).returning().get();

  types.forEach((type, index) => {
    handle.db.insert(submissionErrors).values({
      submissionId: submission.id,
      position: index + 1,
      type,
      span: 'фрагмент',
      explanationRu: 'Объяснение.',
    }).run();
  });
}

function histogram(whose = studentId) {
  return errorHistogram(handle.db, whose, courseId, 'en');
}

test('a Course with no Errors yet counts nothing rather than failing', () => {
  assert.deepEqual(histogram(), []);
  assert.deepEqual(histogram(otherStudentId), []);
});

test('Errors are counted by Error Type, largest count first', () => {
  const [first] = lessonExerciseIds;
  errorsOn(first![0]!, ['article', 'article', 'tense']);
  errorsOn(first![1]!, ['article', 'spelling']);

  assert.deepEqual(
    histogram().map((entry) => [entry.type, entry.count]),
    [['article', 3], ['spelling', 1], ['tense', 1]],
    'the question this answers is what to work on next',
  );
});

test('every row carries the Course’s Language, so two enums can never be added together', () => {
  // The two enums share Russian words for different grammar. Grouping on the
  // stable value is what keeps them apart, and the Language on the row is what
  // makes a caller keep them apart if it ever merges two Courses.
  assert.ok(histogram().every((entry) => entry.language === 'en'));

  assert.equal(
    errorTypeLabel('plural_form'), errorTypeLabel('plural_form_tj'),
    'the two labels really are the same Russian word — this is not a hypothetical',
  );
  assert.notEqual('plural_form', 'plural_form_tj', 'and the stable values really do differ');
});

test('labels are resolved at display time and never read from storage', () => {
  const stored = handle.db.select().from(submissionErrors).all();
  assert.ok(stored.length > 0);

  for (const row of stored) {
    assert.match(row.type, /^[a-z_]+$/, 'what is stored is the stable enum value');
    assert.notEqual(row.type, errorTypeLabel(row.type), 'and the label is a different string');
  }
});

test('an Error Type outside the enum is shown as it came rather than dropped', () => {
  errorsOn(lessonExerciseIds[0]![2]!, ['совершенно_новый_тип']);

  const entry = histogram().find((row) => row.type === 'совершенно_новый_тип');
  assert.ok(entry, 'hiding it would hide a real fault from the only person who could fix it');
  assert.equal(entry.count, 1);
  assert.equal(errorTypeLabel('совершенно_новый_тип'), 'совершенно_новый_тип', 'shown as it came');
});

test('one Student’s Errors are never counted into another’s', () => {
  errorsOn(lessonExerciseIds[0]![0]!, ['preposition', 'preposition'], otherStudentId);

  assert.equal(histogram().find((row) => row.type === 'preposition'), undefined);
  assert.deepEqual(
    histogram(otherStudentId).map((entry) => [entry.type, entry.count]),
    [['preposition', 2]],
  );
});

test('Submissions made in a Test are counted alongside those made in a Practice', () => {
  const created = createTest(handle.db, { courseId, title: 'Контрольная' });
  assert.ok(created.ok);
  const saved = saveTest(handle.db, created.test.id, {
    title: 'Контрольная',
    passThreshold: 80,
    exercises: [{
      kind: 'translation',
      prompt: 'Переведите: У меня есть кот.',
      referenceAnswer: 'I have a cat.',
      acceptedAnswers: [],
      choices: [],
      caseSensitive: false,
    }],
  });
  assert.ok(saved.ok);
  assert.ok(publishTest(handle.db, created.test.id).ok);

  const exerciseId = saved.document.exercises[0]!.id!;
  const attempt = submitAttempt(handle.db, studentId, created.test.id, [
    { exerciseId, answer: 'I have cat.' },
  ]);
  assert.ok(attempt.ok);

  // The batch would write these; written directly because a hermetic suite
  // cannot make a live model produce a chosen Error.
  const answerRow = handle.db.select().from(submissions)
    .where(eq(submissions.testAttemptId, attempt.attemptId)).all()[0]!;
  handle.db.update(submissions).set({ status: 'graded', guardedVerdict: 'incorrect' })
    .where(eq(submissions.id, answerRow.id)).run();
  handle.db.insert(submissionErrors).values({
    submissionId: answerRow.id, position: 1,
    type: 'article', span: 'have cat', explanationRu: 'Пропущен артикль.',
  }).run();

  const article = histogram().find((row) => row.type === 'article');
  assert.equal(article?.count, 4, 'three from the Practice and one from the Test, in one count');
});

// --- Per Lesson, for the chart over a span ------------------------------------

test('the per-Lesson counts hold every published Lesson, including the empty ones', () => {
  const byLesson = errorsByLesson(handle.db, studentId, courseId, 'en');

  assert.equal(byLesson.length, DETERMINISTIC_COURSE.lessons.length);
  assert.deepEqual(
    byLesson.map((lesson) => lesson.title),
    DETERMINISTIC_COURSE.lessons.map((lesson) => lesson.title),
    'in the Course’s order',
  );
  // Dropping the empty ones would compress the gaps and draw a line that says the
  // Student improved in weeks they did not study.
  assert.deepEqual(byLesson[1]!.counts, [], 'the second Lesson has none, and says so');
});

test('a Test’s Errors belong to no Lesson and are absent from the per-Lesson counts', () => {
  const byLesson = errorsByLesson(handle.db, studentId, courseId, 'en');
  const inLessons = byLesson
    .flatMap((lesson) => lesson.counts)
    .filter((entry) => entry.type === 'article')
    .reduce((sum, entry) => sum + entry.count, 0);

  assert.equal(inLessons, 3, 'a span of Lessons is a span of Lessons');
  assert.equal(histogram().find((row) => row.type === 'article')?.count, 4,
    'while the histogram, which claims to cover everything, still does');
});

test('the counting hint and the empty message both live in the dictionary', () => {
  assert.ok(ru.errorStats.none.length > 0);
  assert.equal(ru.errorStats.count(1), '1 ошибка');
  assert.equal(ru.errorStats.count(3), '3 ошибки');
  assert.equal(ru.errorStats.count(14), '14 ошибок', '«артикли — 14 ошибок»');
});
