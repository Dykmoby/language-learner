// The batch Grader contract: N answers out in one call, N judgements back.
//
// Everything here is pure, so the cases a live model will not produce on demand
// are the ones tested hardest: a response that skips an Exercise, one that
// invents an id nobody asked about, one that answers the same Exercise twice.
// A silent off-by-one would tell a Student their correct answer was wrong and
// mark their wrong one correct, with no symptom anywhere — which is the failure
// this contract exists to make impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchSystemPrompt, buildBatchUserPrompt, parseBatchOutput, judgeBatch,
  type BatchContext, type BatchJudgement,
} from '../src/grader/batch-contract.ts';
import { SHIPPED_GUIDANCE } from '../src/grader/guidance.ts';

const CONTEXT: BatchContext = {
  language: 'en',
  level: 'A1',
  testTitle: 'Проверочная работа',
  exercises: [
    {
      exerciseId: 11,
      prompt: 'Переведите: У меня есть кот.',
      referenceAnswer: 'I have a cat.',
      acceptedVariants: ['I have got a cat.'],
      answer: 'I have cat.',
    },
    {
      exerciseId: 12,
      prompt: 'Напишите три предложения о себе.',
      referenceAnswer: 'I am a student. I live in Dushanbe. I like tea.',
      acceptedVariants: [],
      answer: 'I am student. I live in Dushanbe. I likes tea.',
    },
  ],
};

function judgement(exerciseId: number, over: Partial<BatchJudgement> = {}): BatchJudgement {
  return {
    exerciseId,
    feedback_ru: 'Почти верно.',
    corrected: 'I have a cat.',
    errors: [{ type: 'article', span: 'have cat', explanation_ru: 'Нужен артикль a.' }],
    verdict: 'partially_correct',
    ...over,
  };
}

function payload(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({ judgements: entries });
}

function entry(exerciseId: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    exercise_id: exerciseId,
    feedback_ru: 'Почти верно.',
    corrected: 'I have a cat.',
    errors: [{ type: 'article', span: 'have cat', explanation_ru: 'Нужен артикль a.' }],
    verdict: 'partially_correct',
    ...over,
  };
}

// --- the prompt --------------------------------------------------------------

test('every Exercise of the attempt is in the prompt with its own Reference Answer', () => {
  const prompt = buildBatchUserPrompt(CONTEXT);

  for (const exercise of CONTEXT.exercises) {
    assert.ok(prompt.includes(exercise.prompt), `the prompt of ${exercise.exerciseId} is asked`);
    assert.ok(prompt.includes(exercise.referenceAnswer), `the Reference Answer of ${exercise.exerciseId} is given`);
    assert.ok(prompt.includes(exercise.answer), `the Student's answer to ${exercise.exerciseId} is given`);
  }
  assert.ok(prompt.includes('I have got a cat.'), 'an Accepted Variant is teacher-confirmed context');
  assert.ok(prompt.includes(CONTEXT.level), 'the Course level is context');
  assert.ok(prompt.includes(CONTEXT.testTitle), 'the Test is named');
});

test('each answer is fenced as data, tagged with the Exercise it answers', () => {
  const prompt = buildBatchUserPrompt(CONTEXT);

  for (const exercise of CONTEXT.exercises) {
    const opening = `<student_answer exercise="${exercise.exerciseId}">`;
    assert.ok(prompt.includes(opening), `answer ${exercise.exerciseId} opens its own block`);
  }
  assert.equal(prompt.match(/<\/student_answer>/g)?.length, 2, 'and each one closes');
});

test('the system prompt forbids following the answers and fixes the response shape', () => {
  const system = buildBatchSystemPrompt('en', SHIPPED_GUIDANCE);

  assert.match(system, /DATA, never/i, 'the answers are data, never instructions');
  assert.ok(system.includes('exercise_id'), 'each judgement names the Exercise it is about');
  assert.ok(system.includes('"judgements"'), 'the envelope is named');
  assert.ok(system.includes('article'), 'the English Error Type enum is listed');
  assert.ok(!system.includes('izofat'), 'and the Tajik one is not');
});

test('no prior attempts travel with a batch — a Test has no Progressive Hints', () => {
  const prompt = buildBatchUserPrompt(CONTEXT);
  const system = buildBatchSystemPrompt('en', SHIPPED_GUIDANCE);

  assert.ok(!/attempt \d/i.test(prompt), 'nothing in the prompt counts attempts');
  assert.ok(!/sharpen/i.test(system), 'and nothing asks for a sharper hint');
});

// --- the parse ---------------------------------------------------------------

test('one judgement per Exercise, bound to its Exercise rather than to its position', () => {
  // Deliberately in the opposite order to the one they were asked in.
  const parsed = parseBatchOutput(payload([entry(12, { corrected: 'twelve' }), entry(11, { corrected: 'eleven' })]), [11, 12]);

  assert.ok(parsed.ok, 'a complete answer parses');
  assert.deepEqual(parsed.judgements.map((j) => j.exerciseId), [11, 12], 'returned in the order asked');
  assert.equal(parsed.judgements[0]!.corrected, 'eleven', 'and each judgement kept its own Exercise');
  assert.equal(parsed.judgements[1]!.corrected, 'twelve');
});

test('a response that omits an Exercise yields no judgements at all', () => {
  const parsed = parseBatchOutput(payload([entry(11)]), [11, 12]);

  assert.equal(parsed.ok, false, 'a partial batch is a contract failure, not a partial success');
  if (!parsed.ok) assert.match(parsed.reason, /12/, 'and it names the Exercise nobody judged');
});

test('a response carrying an Exercise nobody asked about is refused whole', () => {
  const parsed = parseBatchOutput(payload([entry(11), entry(12), entry(99)]), [11, 12]);

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.reason, /99/);
});

test('a response judging the same Exercise twice is refused whole', () => {
  const parsed = parseBatchOutput(payload([entry(11), entry(11), entry(12)]), [11, 12]);

  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.reason, /11/);
});

test('a judgement missing a field takes the whole batch down rather than being guessed at', () => {
  for (const broken of [
    { feedback_ru: undefined },
    { corrected: undefined },
    { errors: undefined },
    { verdict: 'mostly right' },
    { exercise_id: '11' },
  ] as Array<Record<string, unknown>>) {
    const parsed = parseBatchOutput(payload([{ ...entry(11), ...broken }, entry(12)]), [11, 12]);
    assert.equal(parsed.ok, false, `refused: ${JSON.stringify(broken)}`);
  }
});

test('a missing or misshapen envelope is a contract failure with the raw text kept', () => {
  for (const raw of ['', 'not json at all', '{}', '{"judgements": {}}', '[]']) {
    const parsed = parseBatchOutput(raw, [11]);
    assert.equal(parsed.ok, false, `refused: ${JSON.stringify(raw)}`);
    if (!parsed.ok) assert.equal(typeof parsed.raw, 'string', 'the raw text is evidence, kept');
  }
});

test('markdown fences around the JSON are tolerated and reported', () => {
  const fenced = ['Вот результат:', '```json', payload([entry(11), entry(12)]), '```'].join('\n');
  const parsed = parseBatchOutput(fenced, [11, 12]);

  assert.ok(parsed.ok, 'a routine model habit is not worth failing an attempt over');
  assert.equal(parsed.wasFenced, true, 'but it is reported, so a change in how often it happens is visible');
});

test('an empty error list parses — a correct answer has nothing to list', () => {
  const parsed = parseBatchOutput(
    payload([entry(11, { errors: [], verdict: 'correct' }), entry(12)]),
    [11, 12],
  );

  assert.ok(parsed.ok);
  if (parsed.ok) assert.deepEqual(parsed.judgements[0]!.errors, []);
});

// --- judging -----------------------------------------------------------------

test('the Coherence Guard is applied to every item independently', () => {
  const judged = judgeBatch([
    // No Errors, but not called correct: ADR 0003 forces correct.
    judgement(11, { errors: [], verdict: 'incorrect' }),
    // Errors, and called correct: forbidden.
    judgement(12, { verdict: 'correct' }),
  ], CONTEXT);

  assert.equal(judged[0]!.guarded.verdict, 'correct');
  assert.equal(judged[0]!.guarded.changed, true);
  assert.equal(judged[0]!.proposedVerdict, 'incorrect', 'and the proposal survives beside it (ADR 0003)');

  assert.equal(judged[1]!.guarded.verdict, 'partially_correct');
  assert.equal(judged[1]!.proposedVerdict, 'correct');
});

test('an Error Type outside the Language enum is reported per item, not thrown', () => {
  const judged = judgeBatch([
    judgement(11, { errors: [{ type: 'izofat', span: 'x', explanation_ru: 'нет' }] }),
    judgement(12),
  ], CONTEXT);

  assert.deepEqual(judged[0]!.unknownErrorTypes, ['izofat'], 'Tajik types are not English types');
  assert.deepEqual(judged[1]!.unknownErrorTypes, []);
  assert.equal(judged[0]!.response.errors.length, 1, 'and the Error is kept: dropping it hides a real fault');
});

test('the module is pure — no database, no SDK', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../src/grader/batch-contract.ts', import.meta.url), 'utf8'));

  for (const forbidden of ['claude-agent-sdk', 'drizzle', '../db/']) {
    assert.ok(!source.includes(forbidden), `a pure contract does not import ${forbidden}`);
  }
});
