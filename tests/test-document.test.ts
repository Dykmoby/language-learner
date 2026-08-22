// The rules a Test is held to before it is written, and the extra one it is held
// to before a Student can open it.
//
// The Exercise-level rules are the Lesson's, unchanged and deliberately so — an
// incoherent Exercise is incoherent wherever it was written — so what is proved
// here is that they are actually applied, and that the two rules a Test has of
// its own hold: a threshold that can be read against a score, and no empty Test
// reaching a Course.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  testFaults, testPublishFaults, parseTestDocument, DEFAULT_PASS_THRESHOLD, TEST_FAULTS,
  type TestDocument,
} from '../src/content/test-document.ts';
import { ru, faultMessage } from '../src/ru.ts';

function document(over: Partial<TestDocument> = {}): TestDocument {
  return {
    title: 'Проверочная работа 1',
    passThreshold: DEFAULT_PASS_THRESHOLD,
    exercises: [
      {
        kind: 'fill_gap',
        prompt: 'Вставьте артикль: I have ___ cat.',
        referenceAnswer: 'a',
        acceptedAnswers: ['a'],
        choices: [],
        caseSensitive: false,
      },
    ],
    ...over,
  };
}

const codes = (faults: ReturnType<typeof testFaults>) => faults.map((f) => f.code);

test('a coherent Test has nothing to report', () => {
  assert.deepEqual(testFaults(document()), []);
  assert.deepEqual(testPublishFaults(document()), []);
});

test('a Test with no title cannot be saved', () => {
  assert.deepEqual(codes(testFaults(document({ title: '   ' }))), ['test_title_empty']);
});

test('a threshold that no score could be read against is refused', () => {
  for (const passThreshold of [0, -10, 101, 42.5, Number.NaN]) {
    assert.deepEqual(
      codes(testFaults(document({ passThreshold }))),
      ['pass_threshold_out_of_range'],
      `refused: ${passThreshold}`,
    );
  }
  for (const passThreshold of [1, 50, 80, 100]) {
    assert.deepEqual(codes(testFaults(document({ passThreshold }))), [], `allowed: ${passThreshold}`);
  }
});

test('an empty Test saves but does not publish', () => {
  const empty = document({ exercises: [] });

  assert.deepEqual(codes(testFaults(empty)), [], 'that is what a Test looks like a second after it is created');
  assert.deepEqual(codes(testPublishFaults(empty)), ['test_empty'], 'and nothing a Student can open');
});

test('the Exercise validity rules apply here exactly as they do in a Lesson', () => {
  const faults = testFaults(document({
    exercises: [
      // A multiple choice whose Reference Answer is not among its options.
      {
        kind: 'multiple_choice',
        prompt: 'Выберите вариант: I have ___ apple.',
        referenceAnswer: 'the',
        acceptedAnswers: ['an'],
        choices: ['a', 'an'],
      },
    ],
  }));

  assert.deepEqual(codes(faults), ['reference_answer_not_a_choice']);
  assert.equal(faults[0]!.exercisePosition, 1, 'and it says which Exercise');
});

test('the same Exercise row claimed twice is refused', () => {
  const twice = document({
    exercises: [
      { kind: 'fill_gap', id: 7, prompt: 'a', referenceAnswer: 'a', acceptedAnswers: ['a'] },
      { kind: 'fill_gap', id: 7, prompt: 'b', referenceAnswer: 'b', acceptedAnswers: ['b'] },
    ],
  });

  assert.ok(codes(testFaults(twice)).includes('test_duplicate_exercise_id'));
});

test('a body that is not a Test at all is a shape failure, not a fault', () => {
  for (const body of [null, 'a test', 42, { title: 7 }, { title: 'x' }, { title: 'x', passThreshold: 'many' },
    { title: 'x', passThreshold: 80, exercises: 'none' },
    { title: 'x', passThreshold: 80, exercises: [{ kind: 'telepathy' }] }]) {
    assert.equal(parseTestDocument(body), null, `refused: ${JSON.stringify(body)}`);
  }
});

test('a Test whose fields are typed but empty parses, so the faults can be read', () => {
  const parsed = parseTestDocument({ title: '', passThreshold: 0, exercises: [] });

  assert.notEqual(parsed, null, 'parsing keeps what was typed');
  assert.deepEqual(
    codes(testFaults(parsed!)),
    ['test_title_empty', 'pass_threshold_out_of_range'],
    'and the rules explain it in terms an Admin can act on',
  );
});

test('an Exercise id survives the parse — losing one would take a Student’s answers with it', () => {
  const parsed = parseTestDocument({
    title: 'x',
    passThreshold: 80,
    exercises: [{ id: 11, kind: 'fill_gap', prompt: 'p', referenceAnswer: 'a', acceptedAnswers: ['a'] }],
  });

  assert.equal(parsed?.exercises[0]?.id, 11);
});

test('every Test fault code has a Russian message, and the Exercise ones still resolve', () => {
  assert.deepEqual(Object.keys(ru.testFaults).sort(), [...TEST_FAULTS].sort());
  for (const code of TEST_FAULTS) {
    assert.notEqual(faultMessage(code), code, `${code} resolves to Russian`);
  }
  assert.equal(
    faultMessage('reference_answer_not_a_choice'),
    ru.exerciseFaults.reference_answer_not_a_choice,
    'a Test reports an Exercise fault in the same words a Lesson does',
  );
});
