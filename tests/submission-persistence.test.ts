// What a Grader-judged Submission leaves behind.
//
// This is the one part of the Grader path a hermetic test can reach: a live
// model cannot be asked for an incoherent Verdict, an invented Error Type or a
// timeout, and those are precisely the cases that must be right. So the terminal
// GradingOutcome — which is a plain value, by design — is written by hand and fed
// to the same function the route feeds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import {
  students, exercises, submissions, submissionErrors, acceptedVariants, isDeterministic,
} from '../src/db/schema.ts';
import { coherenceGuard, errorTypesFor, type GraderError, type GraderResponse } from '../src/grader/contract.ts';
import type { GradingOutcome } from '../src/grader/grade.ts';
import {
  recordGrading, priorAnswersFor, graderRequestFor, correctedForStudent, errorsForStudent,
} from '../src/practice/submit.ts';
import { openExercise } from '../src/practice/lessons.ts';
import { ru, errorTypeLabel } from '../src/ru.ts';

function scenario() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'student', password: 'staple monkey trombone', isAdmin: false }]);
  seedCourseContent(handle.db, DETERMINISTIC_COURSE);

  const student = handle.db.select().from(students).where(eq(students.username, 'student')).get()!;
  const set = handle.db.select().from(exercises).all();

  return {
    db: handle.db,
    student,
    exercises: set,
    exercise: set[0]!,
    cleanup: () => { handle.close(); cleanup(); },
  };
}

const EMPTY_USAGE = {
  inputTokens: 880, cacheReadInputTokens: 12, outputTokens: 120,
  contextTokens: 892, costUsd: null, modelsInvoked: ['claude-sonnet-5'],
};

function graded(response: GraderResponse, unknownErrorTypes: string[] = []): GradingOutcome {
  // The guard is applied the way grade() applies it, rather than asserted into
  // whatever shape the test wants — the point is what gets stored, not what the
  // test believes the guard does.
  return {
    ok: true,
    response,
    proposedVerdict: response.verdict,
    guarded: coherenceGuard(response.verdict, response.errors),
    typographyDropped: false,
    wasFenced: false,
    unknownErrorTypes,
    usage: EMPTY_USAGE,
    wallMs: 4900,
    pushback: null,
  };
}

const THREE_ERRORS: GraderError[] = [
  { type: 'article', span: 'have cat', explanation_ru: 'Пропущен артикль «a».' },
  { type: 'capitalization', span: 'i', explanation_ru: 'Местоимение I пишется с заглавной буквы.' },
  { type: 'punctuation', span: 'cat', explanation_ru: 'В конце предложения нужна точка.' },
];

test('a graded Submission stores both Verdicts, the feedback and the correction', () => {
  const s = scenario();
  try {
    const frame = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: graded({
        feedback_ru: 'Почти! Не хватает артикля.',
        corrected: 'I have a cat.',
        errors: THREE_ERRORS,
        verdict: 'partially_correct',
      }),
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    const row = s.db.select().from(submissions).all()[0]!;
    assert.equal(row.attempt, 1);
    assert.equal(row.status, 'graded');
    assert.equal(row.answer, 'i have cat');
    assert.equal(row.proposedVerdict, 'partially_correct');
    assert.equal(row.guardedVerdict, 'partially_correct');
    assert.equal(row.feedbackRu, 'Почти! Не хватает артикля.');
    assert.equal(row.corrected, 'I have a cat.');
    assert.equal(row.failureReason, null);

    assert.equal(frame.status, 'graded');
    assert.equal(frame.verdict, 'partially_correct');
    assert.equal(frame.progression.advanced, false, 'partially_correct keeps the Student where they are');
    assert.equal(frame.progression.failedAttempts, 1);
  } finally { s.cleanup(); }
});

test('Errors are written one row per Error, in order, as their stable enum strings', () => {
  const s = scenario();
  try {
    recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: graded({
        feedback_ru: 'Три ошибки.', corrected: 'I have a cat.',
        errors: THREE_ERRORS, verdict: 'incorrect',
      }),
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    const rows = s.db.select().from(submissionErrors).orderBy(submissionErrors.position).all();
    assert.deepEqual(rows.map((r) => r.position), [1, 2, 3], 'the order the Grader found them in');
    assert.deepEqual(rows.map((r) => r.type), ['article', 'capitalization', 'punctuation']);
    assert.deepEqual(rows.map((r) => r.span), ['have cat', 'i', 'cat']);

    // The Russian label is resolved at display time and never persisted: only the
    // label ever changes, and storage has to survive that.
    for (const row of rows) {
      assert.ok(!/[А-Яа-я]/.test(row.type), `${row.type} is the enum string, not a label`);
      assert.notEqual(row.type, errorTypeLabel(row.type), 'and the label is a different string entirely');
    }
  } finally { s.cleanup(); }
});

test('when the Coherence Guard fires, both the proposed and the guarded Verdict are stored', () => {
  // ADR 0003 — keeping only the guarded value would make the Verdict's
  // instability impossible to measure later. The guard did not fire once in 24
  // calls in step 1, so this is the only place its storage is exercised at all.
  const s = scenario();
  try {
    recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: graded({
        feedback_ru: 'Есть ошибки.', corrected: 'I have a cat.',
        errors: THREE_ERRORS,
        // Incoherent on purpose: errors present, yet the Grader said correct.
        verdict: 'correct',
      }),
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    const row = s.db.select().from(submissions).all()[0]!;
    assert.equal(row.proposedVerdict, 'correct', 'what the Grader said');
    assert.equal(row.guardedVerdict, 'partially_correct', 'and what the server allowed');
  } finally { s.cleanup(); }
});

test('an Error Type outside the enum is stored rather than dropped', () => {
  // Dropping it would hide a real fault from the Student. It is a contract
  // violation to record, not a reason to lose the Error.
  const s = scenario();
  try {
    recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: graded({
        feedback_ru: 'Ошибка.', corrected: 'I have a cat.',
        errors: [{ type: 'invented_type', span: 'cat', explanation_ru: 'Что-то не так.' }],
        verdict: 'incorrect',
      }, ['invented_type']),
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    const rows = s.db.select().from(submissionErrors).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.type, 'invented_type');
    assert.equal(errorTypeLabel('invented_type'), 'invented_type',
      'and it is shown as it came rather than as a blank');
  } finally { s.cleanup(); }
});

// --- Withholding the corrected answer — issue #81 ----------------------------

/** One wrong answer, judged, as attempt after attempt. */
function failOnce(s: ReturnType<typeof scenario>, answer: string) {
  return recordGrading(s.db, {
    studentId: s.student.id,
    exerciseId: s.exercise.id,
    answer,
    outcome: graded({
      feedback_ru: 'Не хватает артикля.',
      corrected: 'I have a cat.',
      errors: [THREE_ERRORS[0]!],
      verdict: 'incorrect',
    }),
    exercises: s.exercises,
    previousExerciseId: s.exercise.id,
  });
}

test('the first two failed attempts show the Verdict and the explanation — not the answer', () => {
  // What a Student is given grows with what they have already tried. The Verdict
  // and the explanation arrive on every attempt; the Errors join on the second
  // (issue #97) and the corrected answer on the third (issue #81).
  const s = scenario();
  try {
    const first = failOnce(s, 'i have cat 1');
    assert.equal(first.verdict, 'incorrect', 'the Verdict still travels');
    assert.equal(first.feedbackRu, 'Не хватает артикля.', 'and so does the explanation');
    assert.equal(first.errors.length, 0, 'the error list is not handed over on the first failure');
    assert.equal(first.corrected, null, 'and neither is the finished sentence');
    assert.equal(first.progression.revealOffered, false);

    const second = failOnce(s, 'i have cat 2');
    assert.equal(second.errors.length, 1, 'the second failure names what is wrong');
    assert.equal(second.corrected, null, 'and still does not hand over the finished sentence');
    assert.equal(second.progression.revealOffered, false);
  } finally { s.cleanup(); }
});

test('the third failed attempt shows it, in the same view where Reveal is first offered', () => {
  // One event, not two: «three tries and it did not come» is what Reveal is
  // offered for, and it is what releases the correction.
  const s = scenario();
  try {
    failOnce(s, 'i have cat');
    failOnce(s, 'i have the cat');
    const third = failOnce(s, 'i have cats');

    assert.equal(third.corrected, 'I have a cat.');
    assert.equal(third.progression.revealOffered, true);
    assert.equal(third.progression.failedAttempts, 3);
  } finally { s.cleanup(); }
});

test('the correction is written to every attempt, withheld ones included', () => {
  // The half an Admin depends on. Resolving a Dispute means reading what the
  // Grader thought the answer should have been, and a Dispute is most often made
  // against the attempt whose correction the Student never saw.
  const s = scenario();
  try {
    failOnce(s, 'i have cat');
    failOnce(s, 'i have the cat');

    const rows = s.db.select().from(submissions).all();
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.corrected, 'I have a cat.', 'the row holds it whatever the wire did');
    }
  } finally { s.cleanup(); }
});

test('a grading failure does not advance the count toward the correction', () => {
  const s = scenario();
  try {
    failOnce(s, 'i have cat');
    failOnce(s, 'i have the cat');

    const failed = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have one cat',
      outcome: {
        ok: false,
        failure: {
          kind: 'timeout', reason: 'the call was aborted after 90000ms', raw: null,
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
        },
        usage: EMPTY_USAGE, wallMs: 90_000, pushback: null,
      },
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    assert.equal(failed.progression.failedAttempts, 2, 'a flaky call is not an attempt');
    assert.equal(failed.corrected, null);

    const next = failOnce(s, 'i have cats');
    assert.equal(next.progression.failedAttempts, 3);
    assert.equal(next.corrected, 'I have a cat.', 'the third *judged* failure is the one that releases it');
  } finally { s.cleanup(); }
});

test('a correct answer keeps its correction, on the attempt it was written', () => {
  const s = scenario();
  try {
    const frame = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'I have a cat.',
      outcome: graded({
        feedback_ru: 'Верно.', corrected: 'I have a cat.', errors: [], verdict: 'correct',
      }),
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    assert.equal(frame.verdict, 'correct');
    assert.equal(frame.corrected, 'I have a cat.', 'there is nothing left to work out');
  } finally { s.cleanup(); }
});

test('the rule reads the attempt count and nothing else — no Exercise Kind is exempt', () => {
  // Asserted on the rule rather than once per Kind: translation, composition and
  // open writing reach the browser through this one function, and a rule that
  // branched on Kind is the shape of thing that would leave one of them behind.
  assert.equal(correctedForStudent('I have a cat.', 'incorrect', false), null);
  assert.equal(correctedForStudent('I have a cat.', 'partially_correct', false), null);
  assert.equal(correctedForStudent('I have a cat.', 'incorrect', true), 'I have a cat.');
  assert.equal(correctedForStudent('I have a cat.', 'correct', false), 'I have a cat.');
  assert.equal(correctedForStudent(null, 'incorrect', true), null, 'nothing to show is still nothing');
});

test('the error list is withheld until the second failed attempt — issue #97', () => {
  // The same shape as the correction above, one failure earlier, and asserted on
  // the rule for the same reason: every Grader-judged Kind reaches the browser
  // through this one function.
  const errors = [{ type: 'grammar', span: 'have', explanationRu: 'Нужна форма has.' }];

  assert.deepEqual(errorsForStudent(errors, 'incorrect', 1), [],
    'the first failure carries the Verdict and the explanation alone');
  assert.deepEqual(errorsForStudent(errors, 'partially_correct', 1), [],
    'a partly right answer is a failed attempt like any other');
  assert.deepEqual(errorsForStudent(errors, 'incorrect', 2), errors, 'and the list arrives on the second');
  assert.deepEqual(errorsForStudent(errors, 'correct', 0), errors,
    'a correct Verdict keeps whatever it has, which the Coherence Guard has already made empty');
});

test('a failed grading is stored as a failure, with a reason and no Verdict', () => {
  const s = scenario();
  try {
    const frame = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: {
        ok: false,
        failure: {
          kind: 'contract',
          reason: 'feedback_ru missing or not a string',
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
          raw: '{"corrected": "I have a cat."}',
        },
        usage: EMPTY_USAGE,
        wallMs: 5100,
        pushback: null,
      },
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    const row = s.db.select().from(submissions).all()[0]!;
    assert.equal(row.status, 'grading_failed');
    assert.equal(row.proposedVerdict, null);
    assert.equal(row.guardedVerdict, null);
    assert.match(row.failureReason!, /contract/);
    assert.equal(s.db.select().from(submissionErrors).all().length, 0, 'and no Errors are invented');

    assert.equal(frame.progression.failedAttempts, 0, 'it does not count against the Student');
    assert.equal(frame.progression.revealOffered, false);
  } finally { s.cleanup(); }
});

test('a rate-limited grading is busy rather than broken, and loses nothing', () => {
  // design.md § Failure behaviour with the reason attached. The Student is told
  // to wait rather than to try again immediately, and everything else about the
  // failure path holds exactly as it does for any other failure: the answer is
  // stored, no Verdict is implied, and the attempt does not count.
  const s = scenario();
  try {
    const frame = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: {
        ok: false,
        failure: {
          kind: 'sdk',
          reason: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: true,
          raw: null,
        },
        usage: EMPTY_USAGE,
        wallMs: 800,
        pushback: { status: 429, retries: 1, rejected: false },
      },
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    assert.equal(frame.status, 'grading_failed');
    assert.equal(frame.failure, 'busy', 'the Student is told to wait, not that something is broken');
    assert.equal(frame.verdict, null, 'and a busy API is still never a wrong answer');

    const row = s.db.select().from(submissions).all()[0]!;
    assert.equal(row.status, 'grading_failed');
    assert.equal(row.answer, 'i have cat', 'the Student’s words are kept, so nothing has to be retyped');
    assert.equal(frame.progression.failedAttempts, 0, 'and it does not count against them');
  } finally { s.cleanup(); }
});

test('every other failure says broken, because waiting will not help', () => {
  const s = scenario();
  try {
    const frame = recordGrading(s.db, {
      studentId: s.student.id,
      exerciseId: s.exercise.id,
      answer: 'i have cat',
      outcome: {
        ok: false,
        failure: {
          kind: 'timeout', reason: 'the call was aborted after 90000ms', raw: null,
          likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
        },
        usage: EMPTY_USAGE, wallMs: 90_000, pushback: null,
      },
      exercises: s.exercises,
      previousExerciseId: s.exercise.id,
    });

    assert.equal(frame.failure, 'broken');
  } finally { s.cleanup(); }
});

test('Progressive Hints are fed the earlier answers, oldest first, and never a failed one', () => {
  // ADR 0004 — the whole mechanism. An answer whose grading failed was never read
  // by the Grader, so handing it back as "you already tried this" would sharpen
  // the hint against something nobody saw.
  const s = scenario();
  try {
    const write = (attempt: number, answer: string, status: 'graded' | 'grading_failed') =>
      s.db.insert(submissions).values({
        studentId: s.student.id, exerciseId: s.exercise.id, attempt, answer, status,
        proposedVerdict: status === 'graded' ? 'incorrect' : null,
        guardedVerdict: status === 'graded' ? 'incorrect' : null,
        feedbackRu: null, corrected: null, createdAt: new Date(),
      }).run();

    write(1, 'the', 'graded');
    write(2, 'nothing was read here', 'grading_failed');
    write(3, 'an', 'graded');

    assert.deepEqual(
      priorAnswersFor(s.db, s.student.id, s.exercise.id),
      ['the', 'an'],
      'oldest first, and the failed grading is not among them',
    );
  } finally { s.cleanup(); }
});

test('the Grader is given the Course model, the grammar focus, the Reference Answer and the Variants', () => {
  // Every field here is what a Verdict is based on. One of them wrong degrades
  // every Verdict quietly, and no amount of looking at what a live model answers
  // would show it.
  const s = scenario();
  try {
    const graderJudged = s.exercises.find((e) => e.kind === 'translation')
      ?? s.exercises.find((e) => !isDeterministic(e.kind));
    const target = graderJudged ?? s.exercise;

    s.db.insert(acceptedVariants).values({
      exerciseId: target.id, value: 'I have got a cat.', createdAt: new Date(),
    }).run();

    s.db.insert(submissions).values({
      studentId: s.student.id, exerciseId: target.id, attempt: 1, answer: 'I have cat.',
      status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
      feedbackRu: null, corrected: null, createdAt: new Date(),
    }).run();

    const opened = openExercise(s.db, s.student.id, target.id);
    assert.equal(opened.ok, true);
    if (!opened.ok) return;

    const request = graderRequestFor(s.db, s.student.id, opened, 'I have a cat.');

    // ADR 0002 — the model is per Course, data rather than a code branch.
    assert.equal(request.model, DETERMINISTIC_COURSE.graderModel);
    // ADR 0007 — and so is the Effort, which also decides the clock the call
    // runs against. A seeded Course grades at `low`, like every other one.
    assert.equal(request.effort, 'low');
    assert.equal(request.submission, 'I have a cat.');
    assert.equal(request.context.language, 'en');
    assert.equal(request.context.level, DETERMINISTIC_COURSE.level);
    assert.equal(request.context.lessonTitle, DETERMINISTIC_COURSE.lessons[0]!.title);
    assert.equal(request.context.grammarFocus, DETERMINISTIC_COURSE.lessons[0]!.grammarFocus,
      'a placeholder here would quietly degrade every Verdict');
    assert.equal(request.context.prompt, target.prompt);
    assert.equal(request.context.referenceAnswer, target.referenceAnswer);
    assert.deepEqual(request.context.acceptedVariants, ['I have got a cat.'],
      'teacher-confirmed answers flow into every later call');
    assert.deepEqual(request.context.priorSubmissions, ['I have cat.'],
      'and the earlier attempt, which is the whole of Progressive Hints');
  } finally { s.cleanup(); }
});

test('every Error Type in the enum has a Russian label, for both Languages', () => {
  for (const language of ['en', 'tj'] as const) {
    for (const type of errorTypesFor(language)) {
      const label = errorTypeLabel(type);
      assert.notEqual(label, type, `${type} has no Russian label — a Student would read the identifier`);
      assert.match(label, /[А-Яа-яЁё]/, `${type}: the label is in Russian`);
    }
  }

  // The dictionary must not grow labels for types the enum does not have: an
  // unused label is a type somebody removed and a screen that still expects it.
  const known = new Set([...errorTypesFor('en'), ...errorTypesFor('tj')]);
  for (const type of Object.keys(ru.errorTypes)) {
    assert.ok(known.has(type), `${type} has a label but is not in the enum`);
  }
});
