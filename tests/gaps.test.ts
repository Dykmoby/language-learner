// Seam 2 — a pure function, tested exhaustively.
//
// Three modules ask this one where the gaps are: the validity rules count them
// against the accepted answers, the question renders an input at each, and the
// answer is put back into the sentence through them. The property that matters
// is that all three get the *same* answer, so the count and the fill are tested
// against the split rather than against a second idea of what a gap is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAP, fillGaps, gapCount, pieces } from '../src/content/gaps.ts';

test('the number of gaps is one less than the number of pieces, always', () => {
  const prompts = [
    'No gap at all.',
    'I have ___ cat.',
    '___ have ___ cat.',
    '___',
    'Trailing ___',
    '___ leading',
    'Три: ___ и ___ и ___.',
  ];

  for (const prompt of prompts) {
    assert.equal(gapCount(prompt), pieces(prompt).length - 1, prompt);
  }
});

test('a prompt with no gap has one piece and no gaps', () => {
  assert.deepEqual(pieces('Составьте предложение.'), ['Составьте предложение.']);
  assert.equal(gapCount('Составьте предложение.'), 0);
});

test('a gap at either end leaves an empty piece rather than disappearing', () => {
  assert.deepEqual(pieces('___ am from Dushanbe.'), ['', ' am from Dushanbe.']);
  assert.deepEqual(pieces('Ends with ___'), ['Ends with ', '']);
  assert.equal(gapCount('___'), 1);
  assert.deepEqual(pieces('___'), ['', '']);
});

test('a run of four underscores is one gap and a literal underscore', () => {
  // Not a special case anybody wrote: it is what splitting on the token does,
  // and the renderer is handed these same pieces, so the screen shows exactly
  // what the count says is there.
  assert.equal(gapCount('I have ____ cat.'), 1);
  assert.deepEqual(pieces('I have ____ cat.'), ['I have ', '_ cat.']);
});

test('filling puts each value where its gap was, in reading order', () => {
  assert.equal(
    fillGaps('Вставьте артикль: I have ___ apple.', ['an']),
    'Вставьте артикль: I have an apple.',
  );
  assert.equal(
    fillGaps('___ have ___ cat and ___ dog.', ['I', 'a', 'a']),
    'I have a cat and a dog.',
  );
});

test('a gap nobody answered keeps its gap rather than closing over it', () => {
  // A sentence closed over an unanswered gap would read as an answer somebody
  // gave. Whitespace is nothing written, for the same reason it is nothing
  // answered everywhere else.
  assert.equal(fillGaps('___ have ___ cat.', ['I']), `I have ${GAP} cat.`);
  assert.equal(fillGaps('___ have ___ cat.', ['I', '   ']), `I have ${GAP} cat.`);
  assert.equal(fillGaps('___ have ___ cat.', []), `${GAP} have ${GAP} cat.`);
});

test('a value is trimmed on the way into the sentence, and nothing else is', () => {
  // The same standard the Deterministic Check holds an answer to, applied where
  // the sentence is built: leading spaces are typing, not language. What sits
  // between the words is the author's prompt and is never touched.
  assert.equal(fillGaps('I have  ___  cat.', ['  a  ']), 'I have  a  cat.');
});

test('values beyond the prompt\'s gaps are dropped rather than appended', () => {
  // A prompt and an answer that disagree about how many gaps there are is an
  // Exercise the validity rules refuse. If one ever reaches here, the sentence
  // still reads as the prompt reads.
  assert.equal(fillGaps('I have ___ cat.', ['a', 'an']), 'I have a cat.');
});

test('the gap module stays pure', () => {
  const source = readFileSync(new URL('../src/content/gaps.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
  assert.deepEqual(imports, [], 'where the gaps are depends on nothing at all');
});
