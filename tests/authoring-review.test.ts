// What in a Draft nobody has looked at since Claude wrote it.
//
// A question about two documents, so it is a table here rather than a click in a
// browser — which is the whole reason it is a function of two documents and not
// a check inside the publish screen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreviewedReferenceAnswers } from '../src/authoring/review.ts';
import type { DocumentExercise, LessonDocument } from '../src/content/lesson-document.ts';

function lesson(...answers: string[]): LessonDocument {
  return {
    title: 'Артикль a/an',
    grammarFocus: 'Indefinite article',
    theoryMarkdown: 'Теория.',
    exercises: answers.map((referenceAnswer, index): DocumentExercise => ({
      kind: 'translation',
      prompt: `Переведите предложение ${index + 1}.`,
      referenceAnswer,
      acceptedAnswers: [],
      caseSensitive: false,
      choices: [],
    })),
  };
}

const CLAUDE_WROTE = lesson('I have a cat.', 'She is an artist.', 'We need an apple.');

test('a Draft nobody has touched carries every Reference Answer unreviewed', () => {
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, CLAUDE_WROTE), 3);
});

test('an Exercise whose Reference Answer was edited no longer counts', () => {
  const edited = lesson('I have a cat.', 'She is an artist, actually.', 'We need an apple.');
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, edited), 2);
});

test('a Draft an Admin has been through Exercise by Exercise asks nothing', () => {
  // The criterion that makes the confirmation worth having: it has to fall
  // silent for somebody who did the work, or it is a click tax nobody reads.
  const reviewed = lesson('I have got a cat.', 'She works as an artist.', 'Pass me an apple.');
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, reviewed), 0);
});

test('a Draft nobody generated has nothing unreviewed in it', () => {
  const typed = lesson('Я написал это сам.');
  assert.equal(unreviewedReferenceAnswers(lesson(), typed), 0);
  assert.equal(unreviewedReferenceAnswers(typed, lesson()), 0);
});

test('reordering the Practice reviews nothing', () => {
  // The case a positional comparison gets wrong, and gets wrong in the dangerous
  // direction: it would report three reviewed Exercises where nobody read one.
  const reordered = lesson('We need an apple.', 'I have a cat.', 'She is an artist.');
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, reordered), 3);
});

test('an Exercise added by hand is not something Claude wrote', () => {
  const withMine = lesson('I have a cat.', 'She is an artist.', 'We need an apple.', 'This one is mine.');
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, withMine), 3);
});

test('an Exercise deleted takes its unreviewed answer with it', () => {
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, lesson('I have a cat.')), 1);
});

test('a blank Reference Answer is not evidence that anybody wrote either', () => {
  // Two absences matching is not a match. It is refused at publish anyway, and
  // counting it would raise a confirmation about an Exercise that cannot go live.
  assert.equal(unreviewedReferenceAnswers(lesson('', '  '), lesson('', '   ')), 0);
});

test('whitespace either side is a different answer, and counts as reviewed', () => {
  // Compared verbatim rather than normalised, deliberately. The question is
  // whether a person has touched this string, and someone who retyped it with a
  // trailing space did touch it. Being wrong here costs one confirmation too few
  // on an answer somebody edited — never one too few on an answer nobody read.
  assert.equal(unreviewedReferenceAnswers(CLAUDE_WROTE, lesson('I have a cat. ')), 0);
});
