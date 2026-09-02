// Seam 2 — resolving a Dispute, against a throwaway database and no HTTP.
//
// The claim this file exists for is the one design.md calls the only closed
// feedback loop in the system: upholding an objection promotes the Student's
// answer to an Accepted Variant, and that answer then reaches the next Grader
// call for the Exercise — in a Practice and in a Test's batch alike. Both halves
// are checked by building the request the Grader would be given, because what a
// live model does with it cannot be asserted and does not need to be.
//
// The other claim is the one ADR 0003 depends on: neither decision touches the
// Submission. A ruling that quietly rewrote a Verdict would destroy the one
// number that says whether the Grader is improving.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { DETERMINISTIC_COURSE, MULTI_GAP_COURSE } from './helpers/fixtures.ts';
import {
  acceptedVariants, students, submissions, submissionErrors, exercises, exerciseSets,
} from '../src/db/schema.ts';
import { disputeVerdict, MAX_COMMENT_LENGTH } from '../src/practice/disputes.ts';
import {
  openDispute, pendingDisputes, resolveDispute, resolvedDisputes,
} from '../src/admin/disputes.ts';
import { openExercise } from '../src/practice/lessons.ts';
import { acceptedAnswersFor } from '../src/content/accepted.ts';
import { judge } from '../src/practice/judgement.ts';
import { graderRequestFor } from '../src/practice/submit.ts';
import { createTest, saveTest, publishTest } from '../src/admin/tests.ts';
import { submitAttempt } from '../src/tests/taking.ts';
import { batchRequestFor } from '../src/tests/grading.ts';
import { practiceProgress } from '../src/practice/progress.ts';
import { disputesOn } from '../src/practice/disputes.ts';

let handle: DatabaseHandle;
let cleanup: (() => void) | undefined;
let studentId: number;
let upholderId: number;
let rejectedId: number;
let adminId: number;
let courseId: number;
let practiceExerciseIds: number[] = [];
/** The first Exercise of MULTI_GAP_COURSE: «___ have ___ apple and ___ cat.» */
let multiGapExerciseId: number;

// A Grader-judged Kind, so an Accepted Variant is something the Grader is told
// about rather than something a Deterministic Check compares against.
const TEST_EXERCISES = [
  {
    kind: 'translation' as const,
    prompt: 'Переведите: У меня есть кот.',
    referenceAnswer: 'I have a cat.',
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
  seedStudents(handle.db, [
    { username: 'student', password: 'staple monkey trombone', isAdmin: false },
    // Two more, so the tests that read a state back out of the derivation see
    // only the rows they wrote. The fixture's Exercises are shared, and a Course
    // accumulates history across a suite.
    { username: 'upholder', password: 'staple monkey trombone', isAdmin: false },
    { username: 'rejected', password: 'staple monkey trombone', isAdmin: false },
    { username: 'igor', password: 'correct horse battery', isAdmin: true },
  ]);
  const seeded = seedCourseContent(handle.db, DETERMINISTIC_COURSE);
  courseId = seeded.courseId;
  // A Course of its own, because a fill-gap with three places to answer is what
  // #85 is about and the fixture above has none.
  seedCourseContent(handle.db, MULTI_GAP_COURSE);

  const accounts = handle.db.select().from(students).all();
  const idOf = (username: string) => accounts.find((row) => row.username === username)!.id;
  studentId = idOf('student');
  upholderId = idOf('upholder');
  rejectedId = idOf('rejected');
  adminId = idOf('igor');

  const set = handle.db.select().from(exerciseSets).all()
    .find((row) => row.lessonId !== null)!;
  practiceExerciseIds = handle.db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, set.id)).all()
    .sort((a, b) => a.position - b.position)
    .map((row) => row.id);

  multiGapExerciseId = handle.db.select().from(exercises).all()
    .find((row) => row.prompt === MULTI_GAP_COURSE.lessons[0]!.practice[0]!.prompt)!.id;
});

after(() => {
  handle?.close();
  cleanup?.();
});

/** A wrong answer to a Practice Exercise, and an objection to it. */
function objectTo(
  answer: string,
  exerciseId = practiceExerciseIds[0]!,
  whose = studentId,
): number {
  const submission = handle.db.insert(submissions).values({
    studentId: whose,
    exerciseId,
    attempt: nextAttempt(exerciseId, whose),
    answer,
    testAttemptId: null,
    status: 'graded',
    failureReason: null,
    proposedVerdict: 'incorrect',
    guardedVerdict: 'incorrect',
    feedbackRu: 'Здесь нужен артикль.',
    corrected: 'a',
    createdAt: new Date(),
  }).returning().get();

  handle.db.insert(submissionErrors).values({
    submissionId: submission.id, position: 1,
    type: 'article', span: answer, explanationRu: 'Пропущен артикль.',
  }).run();

  const made = disputeVerdict(handle.db, whose, submission.id, 'Так тоже говорят.');
  assert.ok(made.ok, 'the objection was made');
  return made.dispute.id;
}

/** A wrong answer to the multi-gap Exercise, written gap by gap, and an objection. */
function objectToGaps(written: string[], whose = studentId): number {
  const submission = handle.db.insert(submissions).values({
    studentId: whose,
    exerciseId: multiGapExerciseId,
    attempt: nextAttempt(multiGapExerciseId, whose),
    // The sentence and the words, exactly as a Submission stores both.
    answer: `${written[0] ?? ''} have ${written[1] ?? ''} apple and ${written[2] ?? ''} cat.`,
    answerGaps: written,
    testAttemptId: null,
    status: 'graded',
    failureReason: null,
    proposedVerdict: 'partially_correct',
    guardedVerdict: 'partially_correct',
    feedbackRu: null,
    corrected: null,
    createdAt: new Date(),
  }).returning().get();

  const made = disputeVerdict(handle.db, whose, submission.id, 'Во втором пропуске так тоже можно.');
  assert.ok(made.ok, 'the objection was made');
  return made.dispute.id;
}

/** The next attempt number for this Student and this Exercise, as the app does it. */
function nextAttempt(exerciseId: number, whose: number): number {
  const rows = handle.db.select().from(submissions)
    .where(eq(submissions.exerciseId, exerciseId)).all()
    .filter((row) => row.studentId === whose);
  return rows.reduce((highest, row) => Math.max(highest, row.attempt), 0) + 1;
}

test('the queue holds every Dispute awaiting a decision, oldest first', () => {
  const first = objectTo('the');
  const second = objectTo('one');

  const queue = pendingDisputes(handle.db);
  const ours = queue.filter((entry) => [first, second].includes(entry.dispute.id));

  assert.deepEqual(ours.map((entry) => entry.dispute.id), [first, second]);
  assert.equal(ours[0]!.studentUsername, 'student', 'and says which Student it came from');
  assert.equal(ours[0]!.courseTitle, DETERMINISTIC_COURSE.title, 'and which Course');
});

test('one Dispute shows everything a judgement has to be reviewed against', () => {
  const disputeId = objectTo('the');
  const opened = openDispute(handle.db, disputeId);
  assert.ok(opened);

  assert.equal(opened.studentUsername, 'student');
  assert.equal(opened.submission.answer, 'the');
  assert.equal(opened.dispute.comment, 'Так тоже говорят.');
  assert.ok(opened.exercise.prompt.length > 0, 'the Exercise');
  assert.equal(opened.exercise.referenceAnswer, 'a', 'its Reference Answer');
  assert.deepEqual(opened.errors.map((e) => e.type), ['article'], 'the Grader’s Errors');
  assert.equal(opened.origin?.kind, 'lesson', 'and where the answer was written');
});

test('upholding promotes the Student’s answer to an Accepted Variant', () => {
  const disputeId = objectTo('one');
  const outcome = resolveDispute(handle.db, adminId, disputeId, 'upheld');

  assert.ok(outcome.ok);
  assert.equal(outcome.variantAdded, true);

  const variants = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, practiceExerciseIds[0]!)).all()
    .map((row) => row.value);
  assert.ok(variants.includes('one'));
});

test('upholding an answer that is already accepted adds no duplicate', () => {
  const exerciseId = practiceExerciseIds[1]!;

  // Twice over, because "already accepted" has two sources. First: an answer
  // that only differs from the Reference Answer by the normalisation the
  // Deterministic Check already applies — «An.» and «an» are one answer, and
  // storing them as two would put the same answer in front of the Grader twice.
  const sameAsReference = objectTo('An.', exerciseId);
  const first = resolveDispute(handle.db, adminId, sameAsReference, 'upheld');
  assert.ok(first.ok);
  assert.equal(first.variantAdded, false, 'the Reference Answer already accepts it');

  // Second: an answer that a previous review confirmed.
  const novel = objectTo('an apple', exerciseId);
  const second = resolveDispute(handle.db, adminId, novel, 'upheld');
  assert.ok(second.ok);
  assert.equal(second.variantAdded, true);

  const again = objectTo('An apple', exerciseId);
  const third = resolveDispute(handle.db, adminId, again, 'upheld');
  assert.ok(third.ok);
  assert.equal(third.variantAdded, false, 'the same answer, already confirmed');

  const stored = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, exerciseId)).all()
    .map((row) => row.value);
  assert.deepEqual(stored, ['an apple'], 'one row, not three');
});

// --- One answer, at one Gap — issue #85 --------------------------------------

test('a Dispute on a multi-gap fill-gap offers one answer per Gap, with its position', () => {
  const disputeId = objectToGaps(['I', 'one', 'a']);
  const opened = openDispute(handle.db, disputeId)!;

  assert.deepEqual(opened.candidates, [
    { gap: 0, value: 'I' },
    { gap: 1, value: 'one' },
    { gap: 2, value: 'a' },
  ], 'the words, not the sentence — and each with the Gap it was written at');
  assert.equal(opened.accepted.length, 3, 'and what is already accepted is read Gap by Gap');
});

test('upholding stores the confirmed answer against the Gap the Admin named', () => {
  const disputeId = objectToGaps(['I', 'one', 'a']);
  const outcome = resolveDispute(handle.db, adminId, disputeId, 'upheld', 1);

  assert.ok(outcome.ok);
  assert.equal(outcome.variantAdded, true);

  const stored = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, multiGapExerciseId)).all();
  assert.deepEqual(stored.map((row) => ({ value: row.value, gap: row.gap })), [{ value: 'one', gap: 1 }],
    'one answer, at one position — never all three, which would accept the two they got wrong');
});

test('a variant confirmed for one Gap is not acceptable in another', () => {
  // The whole of #85. Left position-less, «one» upheld for the second Gap would
  // start marking «one have an apple and a cat» correct: the Exercise teaching
  // the mistake it exists to catch.
  const exercise = handle.db.select().from(exercises).where(eq(exercises.id, multiGapExerciseId)).get()!;
  const accepted = acceptedAnswersFor(handle.db, exercise);

  assert.equal(judge(exercise, ['I', 'one', 'a'], accepted).verdict, 'correct',
    'accepted at the Gap it was confirmed for');
  assert.deepEqual(
    judge(exercise, ['one', 'an', 'a'], accepted).gaps,
    [false, true, true],
    'and refused at every other one',
  );
});

test('an answer with several words in it and no Gap named is refused, never guessed at', () => {
  const disputeId = objectToGaps(['I', 'two', 'a']);
  const refusal = resolveDispute(handle.db, adminId, disputeId, 'upheld');

  assert.equal(refusal.ok, false);
  assert.equal(refusal.ok === false && refusal.reason, 'gap_unspecified');

  // And the Dispute is still waiting, so the refusal refused rather than
  // recorded a ruling with nothing behind it.
  assert.ok(pendingDisputes(handle.db).some((entry) => entry.dispute.id === disputeId));
});

test('a Gap the Student wrote nothing at is refused too', () => {
  const disputeId = objectToGaps(['I', 'three', '']);
  const refusal = resolveDispute(handle.db, adminId, disputeId, 'upheld', 2);

  assert.equal(refusal.ok, false);
  assert.equal(refusal.ok === false && refusal.reason, 'gap_not_answered');
});

test('an Accepted Variant on every other Kind carries no position and is unchanged', () => {
  // A multiple choice has one place to answer whatever its prompt contains, so
  // there is nothing to name and nothing to ask. It behaves exactly as it did.
  const disputeId = objectTo('the', practiceExerciseIds[1]!);
  const outcome = resolveDispute(handle.db, adminId, disputeId, 'upheld');

  assert.ok(outcome.ok);
  // The Course accumulates history across this suite, so this asks about the
  // property rather than about the whole list: nothing on this Kind is ever
  // written with a position.
  const stored = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, practiceExerciseIds[1]!)).all();
  assert.ok(stored.some((row) => row.value === 'the'), 'the answer was promoted');
  assert.deepEqual(stored.map((row) => row.gap), stored.map(() => null), 'and none of them names a Gap');
});

test('upholding never rewrites the Reference Answer', () => {
  const before = handle.db.select().from(exercises)
    .where(eq(exercises.id, multiGapExerciseId)).get()!.referenceAnswer;

  const disputeId = objectToGaps(['I', 'four', 'a']);
  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'upheld', 1).ok);

  assert.equal(
    handle.db.select().from(exercises).where(eq(exercises.id, multiGapExerciseId)).get()!.referenceAnswer,
    before,
    'the author wrote it; a Dispute confirms an additional answer beside it',
  );
});

test('rejecting records that the Verdict stood and changes no Accepted Variant', () => {
  const exerciseId = practiceExerciseIds[0]!;
  const disputeId = objectTo('cat is this', exerciseId);

  const before = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, exerciseId)).all().length;

  const outcome = resolveDispute(handle.db, adminId, disputeId, 'rejected');
  assert.ok(outcome.ok);
  assert.equal(outcome.variantAdded, false);

  const after = handle.db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, exerciseId)).all().length;
  assert.equal(after, before, 'nothing was added');

  const opened = openDispute(handle.db, disputeId);
  assert.equal(opened?.dispute.ruling, 'rejected');
  assert.equal(opened?.dispute.resolvedBy, adminId, 'and who decided it');
});

test('a resolved Dispute leaves the queue and stays readable', () => {
  const disputeId = objectTo('two');
  assert.ok(pendingDisputes(handle.db).some((entry) => entry.dispute.id === disputeId));

  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'rejected').ok);

  assert.ok(!pendingDisputes(handle.db).some((entry) => entry.dispute.id === disputeId),
    'it is no longer waiting');
  assert.ok(resolvedDisputes(handle.db).some((entry) => entry.dispute.id === disputeId),
    'but it is still the record of a decision');
  assert.ok(openDispute(handle.db, disputeId), 'and it still opens');
});

test('a Dispute is decided once — a second ruling is refused', () => {
  const disputeId = objectTo('three');
  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'upheld').ok);

  const again = resolveDispute(handle.db, adminId, disputeId, 'rejected');
  assert.deepEqual(again, { ok: false, reason: 'already_resolved' });
  assert.equal(openDispute(handle.db, disputeId)?.dispute.ruling, 'upheld', 'the first stands');
});

test('neither decision alters the Submission’s Verdicts, its Errors or its answer', () => {
  for (const ruling of ['upheld', 'rejected'] as const) {
    const disputeId = objectTo(`answer-${ruling}`);
    const submissionId = openDispute(handle.db, disputeId)!.submission.id;

    const before = handle.db.select().from(submissions)
      .where(eq(submissions.id, submissionId)).get()!;
    const errorsBefore = handle.db.select().from(submissionErrors)
      .where(eq(submissionErrors.submissionId, submissionId)).all();

    assert.ok(resolveDispute(handle.db, adminId, disputeId, ruling).ok);

    const after = handle.db.select().from(submissions)
      .where(eq(submissions.id, submissionId)).get()!;
    const errorsAfter = handle.db.select().from(submissionErrors)
      .where(eq(submissionErrors.submissionId, submissionId)).all();

    assert.deepEqual(after, before, `${ruling} left the Submission alone`);
    assert.deepEqual(errorsAfter, errorsBefore, `${ruling} left the Errors alone`);
  }
});

/** What the derivation makes of one Exercise, given every row this Student has. */
function stateOf(exerciseId: number, whose: number): string {
  const own = handle.db.select().from(exercises).where(eq(exercises.id, exerciseId)).all();
  const rows = handle.db.select().from(submissions)
    .where(eq(submissions.exerciseId, exerciseId)).all()
    .filter((row) => row.studentId === whose);

  const progress = practiceProgress(own, rows, disputesOn(handle.db, rows.map((r) => r.id)));
  return progress.exercises[0]!.state;
}

test('an upheld Dispute reads as a completed Exercise', () => {
  const exerciseId = practiceExerciseIds[0]!;
  assert.equal(stateOf(exerciseId, upholderId), 'current', 'nothing has happened to it yet');

  const disputeId = objectTo('this is a cat', exerciseId, upholderId);
  assert.equal(stateOf(exerciseId, upholderId), 'disputed', 'objecting alone settles nothing');

  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'upheld').ok);

  // The Student was right, and an Admin has said so.
  assert.equal(stateOf(exerciseId, upholderId), 'completed');
});

test('a rejected Dispute re-locks nothing the Student has already passed', () => {
  const exerciseId = practiceExerciseIds[0]!;
  const disputeId = objectTo('a orange', exerciseId, rejectedId);

  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'rejected').ok);

  const state = stateOf(exerciseId, rejectedId);
  // Sending someone back to an Exercise they moved past a week ago punishes them
  // for having objected, which would teach them not to.
  assert.notEqual(state, 'current', 'it does not become answerable again');
  assert.notEqual(state, 'completed', 'and the Verdict stood, so it is not a pass');
  assert.equal(state, 'disputed');
});

test('an answer whose grading failed was never judged, so it cannot be disputed', () => {
  // The status the criterion names first, and the one a Student is most likely
  // to meet: roughly one Grader call in 24 fails. A failure must never be
  // rendered as a wrong answer — and objecting to it would be objecting to a
  // judgement that was never made.
  const failed = handle.db.insert(submissions).values({
    studentId,
    exerciseId: practiceExerciseIds[0]!,
    attempt: nextAttempt(practiceExerciseIds[0]!, studentId),
    answer: 'ответ, который не удалось проверить',
    testAttemptId: null,
    status: 'grading_failed',
    failureReason: 'timeout: the call did not return',
    // No Verdict at all, which is the whole reason there is nothing to object to.
    proposedVerdict: null,
    guardedVerdict: null,
    feedbackRu: null,
    corrected: null,
    createdAt: new Date(),
  }).returning().get();

  assert.deepEqual(
    disputeVerdict(handle.db, studentId, failed.id, 'Мой ответ верный.'),
    { ok: false, reason: 'not_judged' },
  );
});

test('an objection past the length cap is refused rather than quietly trimmed', () => {
  const judged = handle.db.insert(submissions).values({
    studentId,
    exerciseId: practiceExerciseIds[0]!,
    attempt: nextAttempt(practiceExerciseIds[0]!, studentId),
    answer: 'the',
    testAttemptId: null,
    status: 'graded',
    failureReason: null,
    proposedVerdict: 'incorrect',
    guardedVerdict: 'incorrect',
    feedbackRu: null,
    corrected: null,
    createdAt: new Date(),
  }).returning().get();

  const essay = 'а'.repeat(MAX_COMMENT_LENGTH + 1);
  assert.deepEqual(
    disputeVerdict(handle.db, studentId, judged.id, essay),
    { ok: false, reason: 'comment_too_long' },
  );

  // And nothing was written, so the Student can shorten it and send it again
  // rather than discovering they have already used up their one objection.
  const still = disputeVerdict(handle.db, studentId, judged.id, 'Коротко и по делу.');
  assert.ok(still.ok);
  assert.equal(still.dispute.comment, 'Коротко и по делу.');
});

test('a Dispute that does not exist is refused rather than crashing', () => {
  assert.deepEqual(
    resolveDispute(handle.db, adminId, 999_999, 'upheld'),
    { ok: false, reason: 'not_found' },
  );
  assert.equal(openDispute(handle.db, 999_999), null);
});

// --- The loop closing --------------------------------------------------------

test('an upheld answer reaches the next Grader call for the Exercise in a Practice', () => {
  // A Grader-judged Exercise from the seeded fixture's second Lesson would need
  // one; the first Lesson's are judged in code. So this claim is made against the
  // request builder itself, which is what every Practice call is built by.
  const exerciseId = practiceExerciseIds[0]!;
  const disputeId = objectTo('a cat');
  assert.ok(resolveDispute(handle.db, adminId, disputeId, 'upheld').ok);

  const opened = openExercise(handle.db, studentId, exerciseId);
  assert.ok(opened.ok, 'the Exercise still opens');

  const request = graderRequestFor(handle.db, studentId, opened, 'a cat');
  assert.ok(
    request.context.acceptedVariants.includes('a cat'),
    'teacher-confirmed context, with nobody touching a prompt',
  );
});

test('and it reaches a Test’s batch too', () => {
  const created = createTest(handle.db, { courseId, title: 'Работа с возражением' });
  assert.ok(created.ok);
  const saved = saveTest(handle.db, created.test.id, {
    title: 'Работа с возражением', passThreshold: 80, exercises: TEST_EXERCISES,
  });
  assert.ok(saved.ok);
  assert.ok(publishTest(handle.db, created.test.id).ok);

  const exerciseId = saved.document.exercises[0]!.id!;

  const attempt = submitAttempt(handle.db, studentId, created.test.id, [
    { exerciseId, answers: ['I have got a cat.'] },
  ]);
  assert.ok(attempt.ok);

  const answer = handle.db.select().from(submissions)
    .where(eq(submissions.testAttemptId, attempt.attemptId)).all()[0]!;

  const made = disputeVerdict(handle.db, studentId, answer.id, 'Так тоже говорят.');
  // The answer is awaiting a batch, so it is not judged yet and not disputable.
  assert.deepEqual(made, { ok: false, reason: 'not_judged' });

  // Judged, then objected to, then upheld — the order a real review follows.
  handle.db.update(submissions)
    .set({ status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect' })
    .where(eq(submissions.id, answer.id)).run();

  const objection = disputeVerdict(handle.db, studentId, answer.id, 'Так тоже говорят.');
  assert.ok(objection.ok);
  assert.ok(resolveDispute(handle.db, adminId, objection.dispute.id, 'upheld').ok);

  // A second attempt: the same Exercise, now with the confirmed answer in context.
  const again = submitAttempt(handle.db, studentId, created.test.id, [
    { exerciseId, answers: ['I have a cat.'] },
  ]);
  assert.ok(again.ok);

  const request = batchRequestFor(handle.db, again.attemptId);
  assert.ok(request);
  assert.deepEqual(
    request.context.exercises[0]!.acceptedVariants,
    ['I have got a cat.'],
    'the batch carries what the review confirmed',
  );
});
