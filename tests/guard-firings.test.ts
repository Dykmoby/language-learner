// Seam 2 — how often the Coherence Guard fired, derived from rows.
//
// design.md § Open risks recorded that the guard "did not fire once in 24
// calls", and the gap was never the rule — `grader-contract.test.ts` covers that
// exhaustively — but that a firing in production would leave no trace anyone
// reads. This is the read, and it is pure: the rows say what happened, and no
// live model is involved in counting them.
//
// The two directions are asserted separately because they mean opposite things.
// One is the guard handing a Student a pass the Grader withheld; the other is
// the guard taking one away. A tally that reported four firings without saying
// which way they went would answer a different question from the one an Admin
// is asking.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { guardFirings, tallyGuardFirings, type JudgedSubmission } from '../src/admin/guard-firings.ts';
import type { Verdict } from '../src/grader/contract.ts';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { exercises, students, submissions, isDeterministic } from '../src/db/schema.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';

/** A Grader-judged Kind, since that is the only kind the guard can act on. */
function judged(proposed: Verdict | null, guarded: Verdict | null): JudgedSubmission {
  return { kind: 'translation', proposedVerdict: proposed, guardedVerdict: guarded };
}

test('a system where the guard has never fired counts zero out of the answers it judged', () => {
  const tally = tallyGuardFirings([
    judged('correct', 'correct'),
    judged('partially_correct', 'partially_correct'),
    judged('incorrect', 'incorrect'),
  ]);

  assert.deepEqual(tally, { judged: 3, fired: 0, forcedCorrect: 0, forbadeCorrect: 0 });
});

test('«no Errors forces correct» is counted as its own direction', () => {
  const tally = tallyGuardFirings([
    judged('partially_correct', 'correct'),
    judged('incorrect', 'correct'),
    judged('correct', 'correct'),
  ]);

  assert.equal(tally.fired, 2);
  assert.equal(tally.forcedCorrect, 2, 'the guard handed the Student a pass the Grader withheld');
  assert.equal(tally.forbadeCorrect, 0);
});

test('«any Error forbids correct» is counted as the other', () => {
  const tally = tallyGuardFirings([
    judged('correct', 'partially_correct'),
    judged('incorrect', 'incorrect'),
  ]);

  assert.equal(tally.fired, 1);
  assert.equal(tally.forcedCorrect, 0);
  assert.equal(tally.forbadeCorrect, 1, 'the guard took a pass away');
});

test('the two directions always add up to the firings', () => {
  // The property a reader of the screen will assume, asserted over a mixture
  // rather than left to the two single-direction tests above.
  const tally = tallyGuardFirings([
    judged('partially_correct', 'correct'),
    judged('correct', 'partially_correct'),
    judged('incorrect', 'correct'),
    judged('correct', 'correct'),
    judged('incorrect', 'incorrect'),
  ]);

  assert.equal(tally.judged, 5);
  assert.equal(tally.fired, 3);
  assert.equal(tally.forcedCorrect + tally.forbadeCorrect, tally.fired);
});

test('a failed grading is neither a firing nor an answer the guard was asked about', () => {
  // No judgement was made, so there is nothing for the guard to have moved — and
  // counting the row in the denominator would understate the rate.
  const tally = tallyGuardFirings([
    judged(null, null),
    judged('correct', 'correct'),
  ]);

  assert.deepEqual(tally, { judged: 1, fired: 0, forcedCorrect: 0, forbadeCorrect: 0 });
});

test('a Deterministic Check is not counted at all, in either half of the fraction', () => {
  // It writes both Verdict columns from one comparison and cannot disagree with
  // itself. Counting those rows would leave the denominator saying something
  // other than "answers the Grader judged", and a Course of multiple-choice
  // Exercises would drive the reported rate towards zero on its own.
  const deterministic: JudgedSubmission = {
    kind: 'multiple_choice', proposedVerdict: 'correct', guardedVerdict: 'correct',
  };

  const tally = tallyGuardFirings([deterministic, deterministic, judged('correct', 'partially_correct')]);

  assert.equal(tally.judged, 1, 'only the Grader-judged answer is in the denominator');
  assert.equal(tally.fired, 1);
});


// --- Over the database -------------------------------------------------------
//
// The tally above is the rule; this is the query that feeds it. Worth its own
// setup because the two things that could go wrong here are invisible to a pure
// test: reading a Submission that was never judged, and joining to the Exercise
// wrongly — and the Exercise is the only thing that says whether the Grader was
// ever involved.

let handle: DatabaseHandle;
let cleanup: (() => void) | undefined;
let studentId: number;
let graderJudgedId: number;
let deterministicId: number;

before(() => {
  const temp = tempDatabasePath();
  cleanup = temp.cleanup;
  handle = openDatabase(temp.path);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'student', password: 'staple monkey trombone', isAdmin: false }]);
  // The real fixture, because it is the one holding both kinds of Exercise.
  seedCourseContent(handle.db, ENGLISH_A1);

  studentId = handle.db.select().from(students).all()[0]!.id;
  const all = handle.db.select().from(exercises).all();
  graderJudgedId = all.find((row) => !isDeterministic(row.kind))!.id;
  deterministicId = all.find((row) => isDeterministic(row.kind))!.id;
});

after(() => {
  handle?.close();
  cleanup?.();
});

let attempt = 0;

function write(
  exerciseId: number,
  status: 'graded' | 'grading_failed',
  proposed: Verdict | null,
  guarded: Verdict | null,
): void {
  attempt += 1;
  handle.db.insert(submissions).values({
    studentId, exerciseId, attempt, answer: 'I have cat.', status,
    proposedVerdict: proposed, guardedVerdict: guarded,
    feedbackRu: null, corrected: null, createdAt: new Date(),
  }).run();
}

test('the query counts what the tally counts, and nothing the Grader never judged', () => {
  write(graderJudgedId, 'graded', 'correct', 'partially_correct');   // the guard fired
  write(graderJudgedId, 'graded', 'incorrect', 'incorrect');         // it did not
  write(graderJudgedId, 'grading_failed', null, null);               // nothing was judged
  write(deterministicId, 'graded', 'correct', 'correct');            // no Grader involved

  assert.deepEqual(guardFirings(handle.db), {
    judged: 2, fired: 1, forcedCorrect: 0, forbadeCorrect: 1,
  });
});

test('a system where nobody has answered anything counts nothing at all', () => {
  // The reading the Disputes screen has to give on a fresh install: not a rate
  // over no answers, and not an empty panel.
  handle.db.delete(submissions).where(eq(submissions.studentId, studentId)).run();

  assert.deepEqual(guardFirings(handle.db), {
    judged: 0, fired: 0, forcedCorrect: 0, forbadeCorrect: 0,
  });
});
