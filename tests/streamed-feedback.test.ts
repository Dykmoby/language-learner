// Seam 2 — the other pure function.
//
// What arrives on the wire is a JSON object being typed out character by
// character. Rendering the deltas raw shows the Student JSON syntax; buffering
// until the object closes throws away the streaming design.md § Grading calls
// mandatory. So: given the accumulated raw text so far, the decoded value of
// feedback_ru as far as it can be known.
//
// Prefixes are fed programmatically rather than hand-listed, so every split point
// is covered rather than a chosen few — the whole difficulty is that an escape
// sequence can be cut anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackRuSoFar } from '../src/grader/contract.ts';

/** Every prefix of `payload`, shortest first, including the empty one. */
function prefixes(payload: string): string[] {
  return Array.from({ length: payload.length + 1 }, (_, i) => payload.slice(0, i));
}

/**
 * The property that matters, asserted over every split point: the extracted text
 * only ever grows, is always a prefix of the finished value, never leaks JSON
 * syntax, and ends up exactly equal to what JSON.parse would have produced.
 */
function assertStreamsCleanly(payload: string, expected: string): void {
  let previous = '';
  for (const prefix of prefixes(payload)) {
    const soFar = feedbackRuSoFar(prefix);

    assert.ok(
      expected.startsWith(soFar),
      `at ${JSON.stringify(prefix)} the extracted text ${JSON.stringify(soFar)} is not a prefix of the value`,
    );
    assert.ok(
      soFar.startsWith(previous),
      `at ${JSON.stringify(prefix)} the extracted text went backwards`,
    );
    assert.ok(!/[{}]/.test(soFar), `at ${JSON.stringify(prefix)} a brace reached the Student`);
    assert.ok(!soFar.includes('feedback_ru'), `at ${JSON.stringify(prefix)} a field name reached the Student`);
    assert.ok(
      !/[\uD800-\uDBFF]$/.test(soFar),
      `at ${JSON.stringify(prefix)} half a surrogate pair reached the Student`,
    );

    previous = soFar;
  }

  assert.equal(feedbackRuSoFar(payload), expected, 'the finished value');
}

test('given the complete payload, the extracted text equals the parsed field exactly', () => {
  const value = 'Почти! Артикль «a cat» теперь на месте.';
  const payload = JSON.stringify({
    feedback_ru: value, corrected: 'I have a cat.', errors: [], verdict: 'correct',
  });

  assert.equal(feedbackRuSoFar(payload), value);
  assert.equal(feedbackRuSoFar(payload), JSON.parse(payload).feedback_ru);
});

test('every prefix of a realistic payload streams cleanly', () => {
  const value = 'Почти! Артикль «a» перед исчисляемым существительным обязателен.';
  assertStreamsCleanly(
    JSON.stringify({
      feedback_ru: value,
      corrected: 'I have a cat.',
      errors: [{ type: 'article', span: 'have cat', explanation_ru: 'Пропущен артикль.' }],
      verdict: 'partially_correct',
    }),
    value,
  );
});

test('before the field\'s value begins, the result is empty rather than an error', () => {
  for (const partial of ['', '{', '{"', '{"feed', '{"feedback_ru"', '{"feedback_ru":', '{"feedback_ru": ']) {
    assert.equal(feedbackRuSoFar(partial), '', JSON.stringify(partial));
  }
  assert.equal(feedbackRuSoFar('{"feedback_ru": "'), '', 'the value has started but no characters have arrived');
});

test('a quote inside the value does not terminate it', () => {
  const value = 'Здесь нужно "the", а не "a".';
  assertStreamsCleanly(JSON.stringify({ feedback_ru: value, verdict: 'incorrect' }), value);
});

test('an escape split across deltas is never emitted half-written', () => {
  // The delta boundary lands between the backslash and what it escapes, which is
  // the case a hand-listed set of prefixes always misses.
  const value = 'Строка\nвторая\\третья\tи "кавычки"';
  assertStreamsCleanly(JSON.stringify({ feedback_ru: value, verdict: 'incorrect' }), value);
});

test('a \\uXXXX escape is not emitted until all six characters have arrived', () => {
  // JSON.stringify would not escape these on its own, so the payload is written
  // by hand: the model's own output routinely contains \u sequences.
  const payload = '{"feedback_ru": "\\u041F\\u043E\\u0447\\u0442\\u0438!", "verdict": "incorrect"}';
  assertStreamsCleanly(payload, 'Почти!');

  // Every intermediate state of one escape, checked explicitly.
  const partial = '{"feedback_ru": "A\\u041';
  assert.equal(feedbackRuSoFar(partial), 'A', 'five of six characters is still nothing to show');
});

test('a surrogate pair split across deltas never reaches the Student as half a character', () => {
  const payload = '{"feedback_ru": "\\uD83D\\uDE42 хорошо", "verdict": "correct"}';
  assertStreamsCleanly(payload, '🙂 хорошо');
});

test('text after the value\'s closing quote is not included', () => {
  const value = 'Верно.';
  const payload = JSON.stringify({
    feedback_ru: value, corrected: 'I have a cat.', errors: [], verdict: 'correct',
  });
  assert.equal(feedbackRuSoFar(payload), value);
  assert.ok(!feedbackRuSoFar(payload).includes('corrected'));
  assert.ok(!feedbackRuSoFar(payload).includes('correct"'));
});

test('a markdown-fenced payload works, matching parseGraderOutput\'s tolerance', () => {
  // Sonnet 5 wrapped its JSON in fences on 5 of 5 runs of the longest case in
  // step 1 (design.md § Response contract). The stream sees the fence first.
  const value = 'Почти! Не хватает артикля.';
  const inner = JSON.stringify({ feedback_ru: value, verdict: 'partially_correct' });
  assertStreamsCleanly('```json\n' + inner + '\n```', value);
  assertStreamsCleanly('```\n' + inner + '\n```', value);
});

test('Cyrillic and the guillemets the Russian copy uses survive intact', () => {
  const value = 'Здесь нужен артикль «a»: «a cat» — одна кошка из многих. Ещё раз — и получится!';
  assertStreamsCleanly(JSON.stringify({ feedback_ru: value, verdict: 'partially_correct' }), value);
});

test('an escaped solidus and the control escapes decode to what they denote', () => {
  const payload = '{"feedback_ru": "a\\/b\\r\\n\\t\\b\\f\\\\end", "verdict": "correct"}';
  assertStreamsCleanly(payload, 'a/b\r\n\t\b\f\\end');
});

test('a field order the contract forbids does not make the extractor read the wrong field', () => {
  // The contract fixes feedback_ru first, but a model that emits it second must
  // still stream the right text rather than the corrected answer.
  const value = 'Артикль пропущен.';
  const payload = '{"corrected": "I have a cat.", "feedback_ru": ' + JSON.stringify(value) + '}';
  assert.equal(feedbackRuSoFar(payload), value);
  assertStreamsCleanly(payload, value);
});
