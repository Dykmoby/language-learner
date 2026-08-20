import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import {
  students, courses, lessons, exerciseSets, exercises,
  enrollments, submissions, submissionErrors,
} from '../src/db/schema.ts';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

function scenario(db: ReturnType<typeof freshDatabase>['db']) {
  seedStudents(db, [{ username: 'igor', password: 'correct horse battery', isAdmin: true }]);
  const student = db.select().from(students).where(eq(students.username, 'igor')).get()!;
  const english = db.insert(courses).values({
    language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'English A1', createdAt: new Date(),
  }).returning().get();
  const tajik = db.insert(courses).values({
    language: 'tj', level: 'A1', graderModel: 'claude-opus-5', title: 'Тоҷикӣ A1', createdAt: new Date(),
  }).returning().get();
  const lesson = db.insert(lessons).values({
    courseId: english.id, position: 1, title: 'Урок 1', theoryMarkdown: '', grammarFocus: 'Articles',
  }).returning().get();
  const set = db.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();
  const exercise = db.insert(exercises).values({
    exerciseSetId: set.id, position: 1, kind: 'translation',
    prompt: 'Переведите: У меня есть кошка.', referenceAnswer: 'I have a cat.',
    acceptedAnswers: [], caseSensitive: false,
  }).returning().get();
  return { student, english, tajik, exercise };
}

test('a Student can hold several Enrollments at once, across both Languages', () => {
  const dbh = freshDatabase();
  try {
    const { student, english, tajik } = scenario(dbh.db);
    dbh.db.insert(enrollments).values([
      { studentId: student.id, courseId: english.id, createdAt: new Date() },
      { studentId: student.id, courseId: tajik.id, createdAt: new Date() },
    ]).run();

    const held = dbh.db.select().from(enrollments).where(eq(enrollments.studentId, student.id)).all();
    assert.equal(held.length, 2);
  } finally { dbh.cleanup(); }
});

test('the same Student cannot be enrolled in one Course twice', () => {
  const dbh = freshDatabase();
  try {
    const { student, english } = scenario(dbh.db);
    dbh.db.insert(enrollments).values({ studentId: student.id, courseId: english.id, createdAt: new Date() }).run();
    assert.throws(
      () => dbh.db.insert(enrollments).values({ studentId: student.id, courseId: english.id, createdAt: new Date() }).run(),
      /UNIQUE|constraint/i,
    );
  } finally { dbh.cleanup(); }
});

test('Current Course is recorded per Student and restored on the next visit', () => {
  const dbh = freshDatabase();
  try {
    const { student, tajik } = scenario(dbh.db);
    assert.equal(student.currentCourseId, null, 'a new Student has not worked anywhere yet');

    dbh.db.update(students).set({ currentCourseId: tajik.id }).where(eq(students.id, student.id)).run();
    const returning = dbh.db.select().from(students).where(eq(students.id, student.id)).get()!;
    assert.equal(returning.currentCourseId, tajik.id);
  } finally { dbh.cleanup(); }
});

test('a Submission records the Student, the Exercise and the attempt number it was', () => {
  // ADR 0004 — the attempt number is what lets the Grader be handed the earlier
  // attempts later and sharpen its hints. Progressive Hints need no session state.
  const dbh = freshDatabase();
  try {
    const { student, exercise } = scenario(dbh.db);
    dbh.db.insert(submissions).values([
      { studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'I have cat.',
        status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
        feedbackRu: 'Нужен артикль.', corrected: 'I have a cat.', createdAt: new Date() },
      { studentId: student.id, exerciseId: exercise.id, attempt: 2, answer: 'I have a cat.',
        status: 'graded', proposedVerdict: 'correct', guardedVerdict: 'correct',
        feedbackRu: 'Верно!', corrected: 'I have a cat.', createdAt: new Date() },
    ]).run();

    const attempts = dbh.db.select().from(submissions).orderBy(submissions.attempt).all();
    assert.deepEqual(attempts.map((s) => s.attempt), [1, 2]);
    assert.deepEqual(attempts.map((s) => s.answer), ['I have cat.', 'I have a cat.']);
  } finally { dbh.cleanup(); }
});

test('a Submission whose grading failed is stored as a failure, never as a wrong answer', () => {
  // design.md § Failure behaviour: a failure must never be rendered as a wrong
  // answer. The status carries that distinction, and both Verdicts stay null.
  const dbh = freshDatabase();
  try {
    const { student, exercise } = scenario(dbh.db);
    dbh.db.insert(submissions).values({
      studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'I have a cat.',
      status: 'grading_failed', proposedVerdict: null, guardedVerdict: null,
      failureReason: 'ABORTED after 90000ms', createdAt: new Date(),
    }).run();

    const row = dbh.db.select().from(submissions).get()!;
    assert.equal(row.status, 'grading_failed');
    assert.equal(row.guardedVerdict, null, 'a failure carries no Verdict at all');
    assert.ok(row.failureReason);
  } finally { dbh.cleanup(); }
});

test('a Submission stores the proposed Verdict and the guarded Verdict as separate columns', () => {
  // ADR 0003 requires both. The spike found the Verdict unstable run-to-run
  // within one model — five identical calls returned partially_correct x3 and
  // incorrect x2 with an identical error list. Keeping only the guarded value
  // makes that impossible to measure later.
  const dbh = freshDatabase();
  try {
    const { student, exercise } = scenario(dbh.db);
    dbh.db.insert(submissions).values({
      studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'I have cat.',
      status: 'graded',
      proposedVerdict: 'correct',            // what the Grader said
      guardedVerdict: 'partially_correct',   // what the Coherence Guard made of it
      feedbackRu: 'Есть ошибка.', corrected: 'I have a cat.', createdAt: new Date(),
    }).run();

    const row = dbh.db.select().from(submissions).get()!;
    assert.equal(row.proposedVerdict, 'correct');
    assert.equal(row.guardedVerdict, 'partially_correct');
    assert.notEqual(row.proposedVerdict, row.guardedVerdict, 'the proposal survives the guard');
  } finally { dbh.cleanup(); }
});

test('Errors are rows on their own table, one per Error, not a JSON blob', () => {
  // design.md § Progress and statistics is entirely aggregation over Error Type.
  // That is a query, not a deserialisation loop.
  const dbh = freshDatabase();
  try {
    const { student, exercise } = scenario(dbh.db);
    const submission = dbh.db.insert(submissions).values({
      studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'I have cat. She like fish.',
      status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
      feedbackRu: 'Две ошибки.', corrected: 'I have a cat. She likes fish.', createdAt: new Date(),
    }).returning().get();

    dbh.db.insert(submissionErrors).values([
      { submissionId: submission.id, position: 1, type: 'article', span: 'have cat', explanationRu: 'Нужен артикль a.' },
      { submissionId: submission.id, position: 2, type: 'subject_verb_agreement', span: 'like', explanationRu: 'После she нужно likes.' },
    ]).run();

    const rows = dbh.db.select().from(submissionErrors).orderBy(submissionErrors.position).all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((e) => e.type), ['article', 'subject_verb_agreement']);
    assert.equal(rows[0]?.span, 'have cat', 'the offending fragment is kept');
    assert.equal(rows[1]?.explanationRu, 'После she нужно likes.', 'the Russian explanation is kept');
  } finally { dbh.cleanup(); }
});

test('Error Type is stored as its stable enum string, and no Russian label is persisted', () => {
  const dbh = freshDatabase();
  try {
    const { student, exercise } = scenario(dbh.db);
    const submission = dbh.db.insert(submissions).values({
      studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'I have cat.',
      status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
      feedbackRu: 'Ошибка.', corrected: 'I have a cat.', createdAt: new Date(),
    }).returning().get();
    dbh.db.insert(submissionErrors).values({
      submissionId: submission.id, position: 1, type: 'article', span: 'cat', explanationRu: 'Нужен артикль.',
    }).run();

    const row = dbh.db.select().from(submissionErrors).get()!;
    assert.equal(row.type, 'article', 'the stable enum string, not a translation');

    // The Russian label is resolved at display time from the interface
    // dictionary. Nothing in the table's shape may invite persisting one.
    const columns = dbh.sqlite.prepare('select name from pragma_table_info(?)').all('submission_errors') as { name: string }[];
    const labelish = columns.map((c) => c.name).filter((n) => /label|title|display/.test(n));
    assert.deepEqual(labelish, [], `no label column may exist; found ${labelish.join(', ')}`);
  } finally { dbh.cleanup(); }
});
