// Issue #76 — the Grader's Effort, chosen per Course, and the timeout that has
// to move with it.
//
// The pure half. The coupling is the part worth pinning: a timeout sized for
// `low` turns every high-Effort Course into a stream of failed gradings, which
// a Student reads as the application being broken rather than as a setting an
// Admin chose.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORTS, EFFORT_TIMEOUT_FACTOR, DEFAULT_EFFORT_TIMEOUT_FACTOR, effortTimeoutMs,
} from '../src/claude/effort.ts';
import { config } from '../src/config.ts';
import { readFileSync } from 'node:fs';
import { resolvedGraderEffort } from '../src/admin/authoring.ts';

test('the Grader ladder is roughly 90 / 180 / 300 / 480 / 720 seconds', () => {
  const seconds = EFFORTS.map((effort) => effortTimeoutMs(90_000, effort) / 1000);
  assert.deepEqual(seconds, [90, 180, 300, 480, 720]);
});

test('every Effort has a factor, and none of them shortens the call', () => {
  for (const effort of EFFORTS) {
    const factor = EFFORT_TIMEOUT_FACTOR[effort];
    assert.ok(factor >= 1, `${effort} never gets less time than low does`);
  }
  assert.equal(EFFORT_TIMEOUT_FACTOR.low, 1, 'low is the base the numbers were sized against');
});

test('the factors only rise as the Effort does', () => {
  const factors = EFFORTS.map((effort) => EFFORT_TIMEOUT_FACTOR[effort]);
  for (const [at, factor] of factors.entries()) {
    if (at === 0) continue;
    assert.ok(factor > factors[at - 1]!, `${EFFORTS[at]} gets longer than ${EFFORTS[at - 1]}`);
  }
});

test('«По умолчанию» is not a level, and is bounded by the middle of the ladder', () => {
  // The parameter is not sent, so what the model will spend cannot be looked up.
  // The floor would fail a Course that grades slowly; the ceiling would make a
  // hung call cost a Student twelve minutes.
  assert.ok(DEFAULT_EFFORT_TIMEOUT_FACTOR > EFFORT_TIMEOUT_FACTOR.low);
  assert.ok(DEFAULT_EFFORT_TIMEOUT_FACTOR < EFFORT_TIMEOUT_FACTOR.max);
  assert.equal(effortTimeoutMs(90_000, null), 300_000);
});

test('the Test batch path scales from its own, longer base by the same ladder', () => {
  // A batch is many answers in one call and its clock was already different
  // before Effort was a choice. What is shared is the ladder, not the base.
  const base = config.testGrading.timeoutMs;
  assert.ok(base > config.grader.timeoutMs, 'the batch starts from a longer clock');

  for (const effort of EFFORTS) {
    assert.equal(
      effortTimeoutMs(base, effort) / base,
      effortTimeoutMs(config.grader.timeoutMs, effort) / config.grader.timeoutMs,
      `${effort} stretches both paths by the same amount`,
    );
  }
});

// --- the Course that carries it ----------------------------------------------

test('a Course created without an Effort stated grades at low, never at the default', () => {
  // Left out is not «По умолчанию». `low` is what every Course graded at while
  // this was fixed in code, and a caller that says nothing must never change how
  // anything grades.
  assert.equal(resolvedGraderEffort({}), 'low');
  assert.equal(resolvedGraderEffort({ graderEffort: undefined }), 'low');
});

test('«По умолчанию» survives as itself, and is not collapsed into a level', () => {
  assert.equal(resolvedGraderEffort({ graderEffort: null }), null);
  for (const effort of EFFORTS) {
    assert.equal(resolvedGraderEffort({ graderEffort: effort }), effort);
  }
});

test('every Course that existed before the column migrates to low', () => {
  // The only home of that guarantee is the migration, and it is the one thing
  // here no later code can restate: the rows are already written by the time
  // anything else runs. A Course that quietly started reasoning for minutes
  // because a migration ran would present as the application hanging.
  const sql = readFileSync(
    new URL('../drizzle/0017_grader_effort_per_course.sql', import.meta.url), 'utf8',
  );
  assert.match(sql, /ALTER TABLE `courses` ADD `grader_effort` text;/);
  assert.match(sql, /UPDATE `courses` SET `grader_effort` = 'low';/);
  // The statements, not the commentary above them — which says the same thing
  // in prose and would otherwise match.
  const statements = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n');
  assert.ok(
    !/DEFAULT/i.test(statements),
    'no column default: one would make «По умолчанию» and low the same stored state',
  );
});
