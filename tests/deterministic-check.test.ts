// Seam 2 — a pure function, tested exhaustively.
//
// The normalisation pipeline is an ordered list, and the order is part of
// design.md § Deterministic Check normalisation rather than an implementation
// detail. Every step, and every interaction between a step and the accepted
// answers array, is a row in a table here — one row per case, each carrying the
// reason it is what it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseAnswer, deterministicCheck } from '../src/practice/deterministic-check.ts';

type Row = {
  what: string;
  answer: string;
  accepted: string[];
  caseSensitive?: boolean;
  correct: boolean;
};

function runTable(rows: Row[]): void {
  for (const row of rows) {
    const outcome = deterministicCheck(row.answer, row.accepted, {
      caseSensitive: row.caseSensitive ?? false,
    });
    assert.equal(
      outcome.correct,
      row.correct,
      `${row.what}: ${JSON.stringify(row.answer)} against ${JSON.stringify(row.accepted)}`,
    );
  }
}

test('the five normalisation steps are applied, in the order design.md fixes', () => {
  // Asserted through the normalised value rather than only through a match, so a
  // pipeline that happens to reach the right verdict by a different route still
  // fails here.
  const cases: Array<{ what: string; raw: string; caseSensitive: boolean; expect: string }> = [
    { what: 'trim', raw: '   I have a cat   ', caseSensitive: false, expect: 'i have a cat' },
    { what: 'collapse internal whitespace', raw: 'I  have\ta   cat', caseSensitive: false, expect: 'i have a cat' },
    { what: 'newlines are whitespace too', raw: 'I have\na cat', caseSensitive: false, expect: 'i have a cat' },
    { what: 'case-insensitive by default', raw: 'I HAVE A CAT', caseSensitive: false, expect: 'i have a cat' },
    { what: 'strip a trailing full stop', raw: 'I have a cat.', caseSensitive: false, expect: 'i have a cat' },
    { what: 'strip a trailing question mark', raw: 'Do you have a cat?', caseSensitive: false, expect: 'do you have a cat' },
    { what: 'strip a trailing exclamation mark', raw: 'I have a cat!', caseSensitive: false, expect: 'i have a cat' },
    { what: 'strip a run of them', raw: 'I have a cat?!.', caseSensitive: false, expect: 'i have a cat' },
    { what: 'ё normalises to е', raw: 'Ещё одна кошка', caseSensitive: false, expect: 'еще одна кошка' },
    { what: 'capital Ё too, via the case fold', raw: 'Ёлка', caseSensitive: false, expect: 'елка' },
    { what: 'caseSensitive keeps case and every other step', raw: '  Ещё   одна кошка. ', caseSensitive: true, expect: 'Еще одна кошка' },
    { what: 'internal punctuation is never touched', raw: 'Well, I have a cat.', caseSensitive: false, expect: 'well, i have a cat' },
    { what: 'an empty answer normalises to nothing', raw: '   ', caseSensitive: false, expect: '' },
  ];

  for (const c of cases) {
    assert.equal(normaliseAnswer(c.raw, { caseSensitive: c.caseSensitive }), c.expect, c.what);
  }
});

test('a trailing full stop the Student spaced away from the word still strips clean', () => {
  // Stripping the punctuation uncovers the space that sat before it, and leaving
  // that space behind would fail an answer over typography rather than language.
  assert.equal(normaliseAnswer('I have a cat .', { caseSensitive: false }), 'i have a cat');
});

test('an answer matching any entry in the accepted answers array is correct', () => {
  runTable([
    {
      what: 'the first entry matches',
      answer: 'I have a cat', accepted: ['I have a cat', 'I have got a cat'], correct: true,
    },
    {
      what: 'a later entry matches — the array exists because there is rarely one right answer',
      answer: 'I have got a cat', accepted: ['I have a cat', 'I have got a cat'], correct: true,
    },
    {
      what: 'matching none of them is incorrect',
      answer: 'I has a cat', accepted: ['I have a cat', 'I have got a cat'], correct: false,
    },
    {
      what: 'an empty accepted array can never be satisfied',
      answer: 'I have a cat', accepted: [], correct: false,
    },
    {
      what: 'an empty answer does not match a real one',
      answer: '   ', accepted: ['I have a cat'], correct: false,
    },
  ]);
});

test('the normalisation applies to the accepted answers too, not only to what the Student typed', () => {
  runTable([
    {
      what: 'an authored answer with a full stop still matches one typed without',
      answer: 'I have a cat', accepted: ['I have a cat.'], correct: true,
    },
    {
      what: 'an authored answer with stray spacing still matches',
      answer: 'I have a cat', accepted: ['  I  have a cat  '], correct: true,
    },
    {
      what: 'ё on the authored side matches е on the typed side',
      answer: 'еще', accepted: ['ещё'], correct: true,
    },
  ]);
});

test('caseSensitive makes capitalisation significant and leaves every other step applied', () => {
  runTable([
    {
      what: 'case is ignored by default — "put the word in" rarely cares',
      answer: 'london', accepted: ['London'], correct: true,
    },
    {
      what: 'caseSensitive is the Exercise where capitalisation is the point',
      answer: 'london', accepted: ['London'], caseSensitive: true, correct: false,
    },
    {
      what: 'and it still accepts the correctly capitalised answer',
      answer: 'London', accepted: ['London'], caseSensitive: true, correct: true,
    },
    {
      what: 'caseSensitive must not also start demanding the trailing full stop match',
      answer: 'London.', accepted: ['London'], caseSensitive: true, correct: true,
    },
    {
      what: 'nor the whitespace',
      answer: '  London  ', accepted: ['London'], caseSensitive: true, correct: true,
    },
  ]);
});

test('word order compares an exact sequence and accepts more than one valid order', () => {
  // Word order needs no separate function: an accepted order is an accepted
  // answer, and the whitespace collapse is what makes the comparison a sequence
  // comparison rather than a string one.
  runTable([
    {
      what: 'the authored order matches',
      answer: 'I usually go to school by bus',
      accepted: ['I usually go to school by bus', 'Usually I go to school by bus'],
      correct: true,
    },
    {
      what: 'a second valid order matches — English allows the adverb in front',
      answer: 'Usually I go to school by bus',
      accepted: ['I usually go to school by bus', 'Usually I go to school by bus'],
      correct: true,
    },
    {
      what: 'the right words in the wrong order are incorrect',
      answer: 'I go usually to school by bus',
      accepted: ['I usually go to school by bus', 'Usually I go to school by bus'],
      correct: false,
    },
    {
      what: 'spacing between the fragments is not part of the order',
      answer: 'I   usually  go to school by bus',
      accepted: ['I usually go to school by bus'],
      correct: true,
    },
  ]);
});

test('a misspelling is incorrect — there is no edit-distance tolerance anywhere', () => {
  // A decision, not an omission: in a language-learning application, tolerating a
  // misspelling teaches the misspelling.
  runTable([
    { what: 'one letter wrong', answer: 'I have a cta', accepted: ['I have a cat'], correct: false },
    { what: 'one letter missing', answer: 'I have a ct', accepted: ['I have a cat'], correct: false },
    { what: 'one letter extra', answer: 'I have a catt', accepted: ['I have a cat'], correct: false },
    { what: 'a doubled letter', answer: 'I have a caat', accepted: ['I have a cat'], correct: false },
    {
      what: 'a Cyrillic near-miss is not forgiven either — ё → е is a normalisation, not a typo budget',
      answer: 'кошка сирая', accepted: ['кошка серая'], correct: false,
    },
  ]);
});

test('the outcome names which accepted answer matched, so a Submission can record it', () => {
  const outcome = deterministicCheck('I HAVE GOT A CAT.', ['I have a cat', 'I have got a cat']);
  assert.equal(outcome.correct, true);
  assert.equal(outcome.matched, 'I have got a cat', 'the authored form, not the normalised one');

  const missed = deterministicCheck('I has a cat', ['I have a cat']);
  assert.equal(missed.correct, false);
  assert.equal(missed.matched, null);
});

test('the module performs no I/O and reads nothing from the database', () => {
  // Judgement in code has no reason to touch anything, and one convenient import
  // is how a pure module stops being exhaustively testable.
  const source = readFileSync(new URL('../src/practice/deterministic-check.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
  assert.deepEqual(imports, [], 'the Deterministic Check imports nothing at all');
  assert.ok(!/\bnode:(fs|net|http|child_process|sqlite)\b/.test(source), 'no I/O module reference');
  assert.ok(!/drizzle|schema\.ts/.test(source), 'no database reference');
});
