// Seam 2 — the batch, either side of the call nobody can make hermetically.
//
// What goes out: every free-form answer of one attempt, in one request, with the
// Reference Answers and Accepted Variants that judge them — and nothing that is
// judged in code, because spending a model call on a string comparison is
// spending it for nothing.
//
// What comes back: judgements written onto the answers their Exercise ids name.
// A live model cannot be made to return an incoherent Verdict or an invented
// Error Type on demand, so those are put in by hand here.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { acceptedVariants, students, submissions, submissionErrors } from '../src/db/schema.ts';
import { createTest, publishTest, saveTest } from '../src/admin/tests.ts';
import { submitAttempt, openAttempt } from '../src/tests/taking.ts';
import { batchRequestFor, markBatchFailed, recordBatch, reopenFailedGrading } from '../src/tests/grading.ts';
import { judgeBatch, type BatchJudgement } from '../src/grader/batch-contract.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { eq } from 'drizzle-orm';

let handle: DatabaseHandle;
let cleanup: () => void;
let studentId: number;
let testId: number;
let exerciseIds: number[];

const EXERCISES = [
  {
    kind: 'fill_gap' as const,
    prompt: 'Вставьте артикль: I have ___ cat.',
    referenceAnswer: 'a',
    acceptedAnswers: [['a']],
    choices: [],
    caseSensitive: false,
  },
  {
    kind: 'translation' as const,
    prompt: 'Переведите: У меня есть кот.',
    referenceAnswer: 'I have a cat.',
    acceptedAnswers: [],
    choices: [],
    caseSensitive: false,
  },
  {
    kind: 'composition' as const,
    prompt: 'Напишите два предложения о себе.',
    referenceAnswer: 'I am a student. I like tea.',
    acceptedAnswers: [],
    choices: [],
    caseSensitive: false,
  },
];

before(() => {
  const temp = tempDatabasePath();
  cleanup = temp.cleanup;
  handle = openDatabase(temp.path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'student', password: 'staple monkey trombone', isAdmin: false }]);
  const seeded = seedCourseContent(handle.db, DETERMINISTIC_COURSE);

  studentId = handle.db.select().from(students).all()[0]!.id;

  const created = createTest(handle.db, { courseId: seeded.courseId, title: 'Работа' });
  assert.ok(created.ok);
  testId = created.test.id;

  const saved = saveTest(handle.db, testId, {
    title: 'Работа', passThreshold: 80, exercises: EXERCISES,
  });
  assert.ok(saved.ok);
  exerciseIds = saved.document.exercises.map((exercise) => exercise.id!);

  assert.ok(publishTest(handle.db, testId).ok);

  // Teacher-confirmed, the way a resolved Dispute will add them in step 7.
  handle.db.insert(acceptedVariants).values({
    exerciseId: exerciseIds[1]!, value: 'I have got a cat.', createdAt: new Date(),
  }).run();
});

after(() => {
  handle?.close();
  cleanup?.();
});

function submit(answers: readonly string[]): number {
  const result = submitAttempt(handle.db, studentId, testId, exerciseIds.map((exerciseId, index) => ({
    exerciseId, answer: answers[index] ?? '',
  })));
  assert.ok(result.ok);
  return result.attemptId;
}

function judgement(exerciseId: number, over: Partial<BatchJudgement> = {}): BatchJudgement {
  return {
    exerciseId,
    feedback_ru: 'Хорошо.',
    corrected: 'I have a cat.',
    errors: [],
    verdict: 'correct',
    ...over,
  };
}

test('one request carries every free-form answer of the attempt, and nothing judged in code', () => {
  const attemptId = submit(['a', 'I have cat.', 'I am student.']);

  const request = batchRequestFor(handle.db, attemptId);
  assert.notEqual(request, null);
  assert.deepEqual(
    request!.context.exercises.map((exercise) => exercise.exerciseId),
    [exerciseIds[1], exerciseIds[2]],
    'the fill-gap was settled in code and never reaches the model',
  );
  assert.equal(request!.context.exercises.length, 2, 'and both free-form answers are in the same call');

  const translation = request!.context.exercises[0]!;
  assert.equal(translation.answer, 'I have cat.');
  assert.equal(translation.referenceAnswer, 'I have a cat.');
  assert.deepEqual(translation.acceptedVariants, ['I have got a cat.'], 'teacher-confirmed answers travel too');
  assert.equal(request!.model, DETERMINISTIC_COURSE.graderModel, 'per Course, per ADR 0002');
  assert.equal(request!.context.language, 'en');
});

test('an attempt with nothing free-form asks for no call at all', () => {
  const attemptId = submit(['a', '', '']);
  assert.equal(batchRequestFor(handle.db, attemptId), null, 'blank free-form answers are settled in code');
});

test('each judgement lands on its own Exercise, with both Verdicts and its Errors as rows', () => {
  const attemptId = submit(['a', 'I have cat.', 'I am student.']);
  const request = batchRequestFor(handle.db, attemptId)!;

  // Deliberately in the opposite order to the one they were asked in.
  const judged = judgeBatch([
    judgement(exerciseIds[2]!, {
      feedback_ru: 'Пропущен артикль.',
      corrected: 'I am a student.',
      errors: [{ type: 'article', span: 'am student', explanation_ru: 'Нужен артикль a.' }],
      // Errors present and called correct: ADR 0003 forbids it.
      verdict: 'correct',
    }),
    judgement(exerciseIds[1]!, { feedback_ru: 'Верно.', corrected: 'I have a cat.' }),
  ], request.context);

  recordBatch(handle.db, judged, request.submissionByExercise);

  const opened = openAttempt(handle.db, studentId, attemptId);
  assert.ok(opened.ok);

  const composition = opened.view.exercises.find((e) => e.exerciseId === exerciseIds[2])!;
  assert.equal(composition.feedbackRu, 'Пропущен артикль.', 'the judgement went to the Exercise it named');
  assert.equal(composition.corrected, 'I am a student.');
  assert.equal(composition.verdict, 'partially_correct', 'the Coherence Guard held');
  assert.equal(composition.errors.length, 1);
  assert.equal(composition.errors[0]!.type, 'article');

  const translation = opened.view.exercises.find((e) => e.exerciseId === exerciseIds[1])!;
  assert.equal(translation.correct, true);
  assert.deepEqual(translation.errors, []);

  const stored = handle.db.select().from(submissions)
    .where(eq(submissions.testAttemptId, attemptId)).all();
  const compositionRow = stored.find((row) => row.exerciseId === exerciseIds[2])!;
  assert.equal(compositionRow.proposedVerdict, 'correct', 'what the Grader proposed survives (ADR 0003)');
  assert.equal(compositionRow.guardedVerdict, 'partially_correct', 'beside what the server allowed');

  assert.equal(opened.view.state, 'scored');
  assert.equal(opened.view.correct, 2, 'both judgement classes are counted together');
  assert.equal(opened.view.total, 3);
  assert.equal(opened.view.scorePercent, 67);
  assert.equal(opened.view.passed, false);
});

test('a judgement for an Exercise this attempt does not hold is written nowhere', () => {
  const attemptId = submit(['a', 'I have cat.', 'I am student.']);
  const request = batchRequestFor(handle.db, attemptId)!;

  recordBatch(handle.db, judgeBatch([judgement(999_999)], request.context), request.submissionByExercise);

  const opened = openAttempt(handle.db, studentId, attemptId);
  assert.ok(opened.ok);
  assert.equal(opened.view.state, 'grading', 'nothing was judged, so nothing changed');
  assert.equal(opened.view.scorePercent, null);
});

test('an invented Error Type is kept rather than dropped — it is a real fault either way', () => {
  const attemptId = submit(['a', 'I have cat.', 'I am student.']);
  const request = batchRequestFor(handle.db, attemptId)!;

  const judged = judgeBatch([
    judgement(exerciseIds[1]!, {
      errors: [{ type: 'izofat', span: 'have cat', explanation_ru: 'Не английский тип ошибки.' }],
      verdict: 'incorrect',
    }),
    judgement(exerciseIds[2]!),
  ], request.context);
  assert.deepEqual(judged[0]!.unknownErrorTypes, ['izofat'], 'and it is reported');

  recordBatch(handle.db, judged, request.submissionByExercise);

  const opened = openAttempt(handle.db, studentId, attemptId);
  assert.ok(opened.ok);
  const translation = opened.view.exercises.find((e) => e.exerciseId === exerciseIds[1])!;
  assert.equal(translation.errors[0]!.type, 'izofat');
});

test('grading again after a failure replaces the judgement rather than stacking on it', () => {
  const attemptId = submit(['a', 'I have cat.', 'I am student.']);
  const first = batchRequestFor(handle.db, attemptId)!;

  markBatchFailed(handle.db, [...first.submissionByExercise.values()], 'timeout: no answer in 300000ms');

  const failed = openAttempt(handle.db, studentId, attemptId);
  assert.ok(failed.ok);
  assert.equal(failed.view.state, 'grading_failed');
  assert.equal(failed.view.scorePercent, null, 'a failed batch is not a score of nought');

  assert.equal(reopenFailedGrading(handle.db, attemptId), 2, 'both answers go out again');

  const again = batchRequestFor(handle.db, attemptId);
  assert.notEqual(again, null, 'and they are the same answers, not new ones');
  assert.equal(again!.context.exercises.length, 2);

  recordBatch(handle.db, judgeBatch([
    judgement(exerciseIds[1]!, {
      errors: [{ type: 'article', span: 'have cat', explanation_ru: 'Нужен артикль.' }],
      verdict: 'partially_correct',
    }),
    judgement(exerciseIds[2]!),
  ], again!.context), again!.submissionByExercise);

  const settled = openAttempt(handle.db, studentId, attemptId);
  assert.ok(settled.ok);
  assert.equal(settled.view.state, 'scored');

  const translationRow = handle.db.select().from(submissions)
    .where(eq(submissions.testAttemptId, attemptId)).all()
    .find((row) => row.exerciseId === exerciseIds[1])!;
  assert.equal(translationRow.failureReason, null, 'the failure it recovered from is not left behind');

  const errorRows = handle.db.select().from(submissionErrors)
    .where(eq(submissionErrors.submissionId, translationRow.id)).all();
  assert.equal(errorRows.length, 1, 'and the Errors are this judgement’s, not two runs of them');
});
