// A Test as a Student meets it, from the Course list to a submitted attempt.
//
// (The domain's Test — CONTEXT.md. Not the test suite; that lives in /tests at
// the repo root.)
//
// The rule this module exists to keep is the one that makes a Test a Test:
// nothing is judged, revealed or said about any answer until the attempt is
// submitted. That is why the whole Test is on one screen and arrives in one
// request — there is no per-Exercise endpoint here to leak a Verdict through,
// and the Exercises a Student is handed carry no Reference Answer and no
// accepted answers at all.
//
// The guard is bound to the query the way the Practice's is: nothing hands back
// a Test without having answered whether this Student may have it. An unpublished
// Test is a 404 rather than a refusal, exactly as an unpublished Lesson is absent
// rather than locked.

import { and, asc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, tests, testAttempts, exerciseSets, exercises, submissions, submissionErrors,
  isDeterministic,
  type CourseRow, type ExerciseRow, type SubmissionRow, type TestRow, type TestAttemptRow,
} from '../db/schema.ts';
import type { Verdict } from '../grader/contract.ts';
import { acceptedAnswersFor, acceptedPositions } from '../content/accepted.ts';
import { deterministicCheck } from '../practice/deterministic-check.ts';
import { disputesOn } from '../practice/disputes.ts';
import { isEnrolled } from '../practice/lessons.ts';
import { attemptOutcome } from './score.ts';
import type {
  AttemptAnswer, AttemptExerciseView, AttemptSummary, AttemptView, TestExerciseView,
} from './wire.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** Its existence is not theirs to know, so every refusal here is the same one. */
export type TestRefusal = { ok: false; reason: 'not_found' };

// --- Reading -----------------------------------------------------------------

function exercisesOfTest(db: Db, testId: number): ExerciseRow[] {
  const set = db.select().from(exerciseSets).where(eq(exerciseSets.testId, testId)).get();
  if (!set) return [];
  return db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all();
}

function answersOf(db: Db, attemptIds: readonly number[]): Map<number, SubmissionRow[]> {
  const byAttempt = new Map<number, SubmissionRow[]>();
  if (attemptIds.length === 0) return byAttempt;

  for (const row of db.select().from(submissions)
    .where(inArray(submissions.testAttemptId, [...attemptIds])).all()) {
    const list = byAttempt.get(row.testAttemptId!);
    if (list) list.push(row);
    else byAttempt.set(row.testAttemptId!, [row]);
  }
  return byAttempt;
}

function summarise(attempt: TestAttemptRow, answers: readonly SubmissionRow[]): AttemptSummary {
  // Against the threshold this attempt was taken under, not the Test's current
  // one: raising the bar next month must not retroactively fail a past attempt.
  const outcome = attemptOutcome(answers, attempt.passThreshold);
  return {
    attemptId: attempt.id,
    attempt: attempt.attempt,
    submittedAt: attempt.submittedAt.getTime(),
    state: outcome.state,
    correct: outcome.correct,
    total: outcome.total,
    scorePercent: outcome.scorePercent,
    passed: outcome.passed,
  };
}

function attemptsFor(db: Db, studentId: number, testId: number): AttemptSummary[] {
  const rows = db.select().from(testAttempts)
    .where(and(eq(testAttempts.studentId, studentId), eq(testAttempts.testId, testId)))
    .orderBy(asc(testAttempts.attempt)).all();

  const answers = answersOf(db, rows.map((row) => row.id));
  return rows.map((row) => summarise(row, answers.get(row.id) ?? []));
}

export type StudentTest = {
  test: TestRow;
  exerciseCount: number;
  attempts: AttemptSummary[];
};

/**
 * The Tests of a Course this Student can sit, with what they have already scored.
 *
 * Published Tests only, and dropped rather than hidden — the same shape the
 * Lesson outline uses, so nothing downstream has to remember to check a flag.
 */
export function courseTests(db: Db, studentId: number, courseId: number): StudentTest[] {
  if (!isEnrolled(db, studentId, courseId)) return [];

  const published = db.select().from(tests)
    .where(and(eq(tests.courseId, courseId), isNotNull(tests.publishedAt)))
    .orderBy(asc(tests.id)).all();

  return published.map((test) => ({
    test,
    exerciseCount: exercisesOfTest(db, test.id).length,
    attempts: attemptsFor(db, studentId, test.id),
  }));
}

export type OpenTest = {
  course: CourseRow;
  test: TestRow;
  /** In the Exercise Set's order, and carrying nothing that answers them. */
  exercises: TestExerciseView[];
  attempts: AttemptSummary[];
};

/** One Test, with everything the Student's right to sit it depends on. */
export function openTest(
  db: Db,
  studentId: number,
  testId: number,
): ({ ok: true } & OpenTest) | TestRefusal {
  const found = db.select({ test: tests, course: courses })
    .from(tests)
    .innerJoin(courses, eq(courses.id, tests.courseId))
    .where(eq(tests.id, testId))
    .get();

  if (!found) return { ok: false, reason: 'not_found' };
  if (!isEnrolled(db, studentId, found.course.id)) return { ok: false, reason: 'not_found' };
  // Not yet something a Student may open, and saying so would say it exists.
  if (found.test.publishedAt === null) return { ok: false, reason: 'not_found' };

  const own = exercisesOfTest(db, testId);

  return {
    ok: true,
    course: found.course,
    test: found.test,
    exercises: own.map((exercise) => ({
      exerciseId: exercise.id,
      position: exercise.position,
      kind: exercise.kind,
      prompt: exercise.prompt,
      choices: exercise.choices,
    })),
    attempts: attemptsFor(db, studentId, testId),
  };
}

// --- Submitting --------------------------------------------------------------

export type SubmitAttemptResult =
  | { ok: true; attemptId: number; awaiting: number[] }
  | { ok: false; reason: 'not_found' | 'empty_test' };

/**
 * The whole attempt, in one transaction: an attempt row and one Submission per
 * Exercise of the Test.
 *
 * Everything judged in code is judged here and now. Everything the Grader judges
 * is stored as an answer with no judgement — the batch is a separate act, and
 * the ids of the Exercises waiting for it come back so the caller can start it.
 *
 * A blank free-form answer is settled here too, and settled as incorrect: sending
 * an empty answer to the Grader spends a call to be told what the Deterministic
 * Check already says, that submitting nothing is not answering.
 */
export function submitAttempt(
  db: Db,
  studentId: number,
  testId: number,
  answers: readonly AttemptAnswer[],
): SubmitAttemptResult {
  const opened = openTest(db, studentId, testId);
  if (!opened.ok) return { ok: false, reason: 'not_found' };

  const own = exercisesOfTest(db, testId);
  // Only reachable where an Admin emptied a published Test: there is nothing to
  // answer, so there is no attempt to record.
  if (own.length === 0) return { ok: false, reason: 'empty_test' };

  const given = new Map(answers.map((entry) => [entry.exerciseId, entry.answer]));

  return db.transaction((tx) => {
    const highest = tx.select({ value: max(testAttempts.attempt) }).from(testAttempts)
      .where(and(eq(testAttempts.studentId, studentId), eq(testAttempts.testId, testId)))
      .get()?.value ?? 0;
    const attemptNumber = highest + 1;

    const attempt = tx.insert(testAttempts).values({
      testId,
      studentId,
      attempt: attemptNumber,
      // Copied, not read through the Test: what this attempt was judged against
      // must not change under it later.
      passThreshold: opened.test.passThreshold,
      submittedAt: new Date(),
    }).returning().get();

    const awaiting: number[] = [];

    for (const exercise of own) {
      const answer = given.get(exercise.id) ?? '';

      let status: 'graded' | 'awaiting_grading' = 'awaiting_grading';
      let verdict: Verdict | null = null;
      let corrected: string | null = null;

      if (isDeterministic(exercise.kind)) {
        // The authored list and the Accepted Variants alike — CONTEXT.md
        // § Deterministic Check names both, and a Test judges in code exactly as
        // a Practice does.
        const outcome = deterministicCheck(answer, acceptedAnswersFor(tx, exercise), {
          caseSensitive: exercise.caseSensitive,
        });
        status = 'graded';
        verdict = outcome.correct ? 'correct' : 'incorrect';
        corrected = outcome.correct ? outcome.matched : null;
      } else if (answer.trim() === '') {
        status = 'graded';
        verdict = 'incorrect';
      } else {
        awaiting.push(exercise.id);
      }

      tx.insert(submissions).values({
        studentId,
        exerciseId: exercise.id,
        // The attempt's own number, so the same Exercise answered again in a
        // later attempt is a different row rather than a collision.
        attempt: attemptNumber,
        answer,
        testAttemptId: attempt.id,
        status,
        failureReason: null,
        // Both columns from the one comparison, as the Practice does it: they
        // agree by construction here, and a row that recorded only one would
        // read differently from a Grader-judged row for no reason (ADR 0003).
        proposedVerdict: verdict,
        guardedVerdict: verdict,
        feedbackRu: null,
        corrected,
        createdAt: new Date(),
      }).run();
    }

    return { ok: true, attemptId: attempt.id, awaiting } as const;
  });
}

// --- Reviewing ---------------------------------------------------------------

export type OpenAttempt = {
  view: AttemptView;
  /** The Exercises still waiting on a judgement, if any. */
  awaiting: number[];
};

/**
 * One attempt, whole.
 *
 * Everything is shown here — Reference Answers included — because the attempt is
 * closed. Withholding them now would be withholding the only thing the Test was
 * for.
 */
export function openAttempt(
  db: Db,
  studentId: number,
  attemptId: number,
): ({ ok: true } & OpenAttempt) | TestRefusal {
  const attempt = db.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).get();
  // Another Student's attempt is not theirs to read, and is answered as missing
  // rather than as forbidden.
  if (!attempt || attempt.studentId !== studentId) return { ok: false, reason: 'not_found' };

  const opened = openTest(db, studentId, attempt.testId);
  if (!opened.ok) return opened;

  // The attempt's answers, each with the Exercise it was an answer to — rather
  // than the Test's Exercises as they stand today. An Exercise added since is not
  // part of what this Student was asked, and one removed took its answer with it.
  const answered = db.select({ submission: submissions, exercise: exercises })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .where(eq(submissions.testAttemptId, attemptId))
    .orderBy(asc(exercises.position))
    .all();
  const answers = answered.map((row) => row.submission);

  const errorRows = answers.length === 0 ? [] : db.select().from(submissionErrors)
    .where(inArray(submissionErrors.submissionId, answers.map((row) => row.id)))
    .orderBy(asc(submissionErrors.position)).all();
  const errorsBySubmission = new Map<number, typeof errorRows>();
  for (const row of errorRows) {
    const list = errorsBySubmission.get(row.submissionId);
    if (list) list.push(row);
    else errorsBySubmission.set(row.submissionId, [row]);
  }

  const outcome = attemptOutcome(answers, attempt.passThreshold);
  const awaiting: number[] = [];

  // Objections against this attempt's answers. They change no score and reopen
  // no attempt — a Test gates nothing — so they are read here purely so the
  // review can say that an objection was made and what came of it.
  const objections = new Map(
    disputesOn(db, answers.map((row) => row.id)).map((row) => [row.submissionId, row]),
  );

  const reviewed: AttemptExerciseView[] = answered.map(({ submission: row, exercise }, index) => {
    const status = row.status === 'graded' || row.status === 'grading_failed'
      ? row.status
      : 'awaiting_grading';
    if (status === 'awaiting_grading') awaiting.push(exercise.id);

    const objection = objections.get(row.id);

    return {
      exerciseId: exercise.id,
      submissionId: row.id,
      // Its place in this attempt, not in the Test as it stands: «задание 2 из 3»
      // has to add up on the screen it is written on.
      position: index + 1,
      kind: exercise.kind,
      prompt: exercise.prompt,
      choices: exercise.choices,
      answer: row.answer,
      status,
      // No Verdict on anything unjudged: a failure must never be rendered as a
      // wrong answer, so there is nothing here that could be mistaken for one.
      verdict: status === 'graded' ? row.guardedVerdict : null,
      correct: status === 'graded' && row.guardedVerdict === 'correct',
      feedbackRu: status === 'graded' ? row.feedbackRu : null,
      corrected: status === 'graded' ? row.corrected : null,
      errors: (errorsBySubmission.get(row.id) ?? []).map((error) => ({
        type: error.type,
        span: error.span,
        explanationRu: error.explanationRu,
      })),
      referenceAnswer: exercise.referenceAnswer,
      acceptedAnswers: isDeterministic(exercise.kind) ? acceptedPositions(exercise).flat() : [],
      dispute: objection === undefined ? null : { ruling: objection.ruling },
    };
  });

  return {
    ok: true,
    awaiting,
    view: {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: opened.test.title,
      attempt: attempt.attempt,
      submittedAt: attempt.submittedAt.getTime(),
      state: outcome.state,
      passThreshold: attempt.passThreshold,
      correct: outcome.correct,
      total: outcome.total,
      scorePercent: outcome.scorePercent,
      passed: outcome.passed,
      exercises: reviewed,
    },
  };
}
