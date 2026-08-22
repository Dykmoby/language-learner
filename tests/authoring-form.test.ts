// What the Generation and Refinement forms send, as the server reads it.
//
// Shaping, not judging — the same split the Lesson document's parse makes. An
// empty topic parses fine and is reported as a fault an Admin can read; a Kind
// nobody has heard of is a shape failure, because there is no control that could
// have produced it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFORT_CHOICES, parseGenerationForm, parseRefinementForm } from '../src/authoring/form.ts';
import { EFFORTS } from '../src/claude/effort.ts';
import { AUTHOR_MODELS, GRADER_MODELS } from '../src/content/course-options.ts';
import type { LessonDocument } from '../src/content/lesson-document.ts';

const BODY = {
  topic: 'Артикли',
  vocabulary: ['cat', '  ', 'apple'],
  exerciseCount: 4,
  kindMix: { translation: 2, multiple_choice: 0 },
  wishes: 'Побольше про еду.',
  continueFromLessonId: null,
  model: 'claude-sonnet-5',
  effort: 'high',
};

const DOCUMENT: LessonDocument = {
  title: 'Артикль a/an',
  grammarFocus: 'Indefinite article',
  theoryMarkdown: 'Теория.',
  exercises: [],
};

// --- The six Effort entries --------------------------------------------------

test('the picker offers five Efforts and «По умолчанию»', () => {
  // design.md § Authoring. The sixth is the absence of the parameter, which is
  // why it is null here and not a string the SDK would ever see.
  assert.equal(EFFORT_CHOICES.length, EFFORTS.length + 1);
  assert.equal(EFFORT_CHOICES[0], null);
  assert.deepEqual(EFFORT_CHOICES.slice(1), [...EFFORTS]);
});

test('«По умолчанию» arrives as an absence, however the browser spells it', () => {
  // A `<select>` cannot offer an absence, so the empty option, an explicit null
  // and a missing key all have to mean the same thing.
  for (const effort of [null, '', undefined]) {
    const form = parseGenerationForm({ ...BODY, effort });
    assert.notEqual(form, null);
    assert.ok(!('effort' in form!), `${JSON.stringify(effort)} omits the parameter`);
  }
});

test('each of the five Efforts travels as itself', () => {
  for (const effort of EFFORTS) {
    assert.equal(parseGenerationForm({ ...BODY, effort })?.effort, effort);
  }
});

test('an Effort nobody offers is a shape failure', () => {
  assert.equal(parseGenerationForm({ ...BODY, effort: 'maximum' }), null);
});

// --- Models ------------------------------------------------------------------

test('the two offered models are accepted and nothing else is', () => {
  for (const model of AUTHOR_MODELS) {
    assert.notEqual(parseGenerationForm({ ...BODY, model }), null);
  }
  assert.equal(parseGenerationForm({ ...BODY, model: 'gpt-4' }), null);
});

test('Haiku cannot write a Lesson, however the request is crafted', () => {
  // ADR 0002's rule, closed on this side too: a model that explains grammar
  // confidently and wrongly is worse than none, and a Theory is read as fact.
  // The picker cannot offer it and the parse will not take it — two guards.
  for (const model of ['claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'CLAUDE-HAIKU-99']) {
    assert.equal(parseGenerationForm({ ...BODY, model }), null, `${model} is refused`);
    assert.equal(parseRefinementForm({ document: DOCUMENT, message: 'x', model }), null);
  }
  assert.ok(!(GRADER_MODELS as readonly string[]).some((m) => /haiku/i.test(m)));
});

// --- The rest of the Generation form -----------------------------------------

test('a blank vocabulary line is absent rather than an empty word', () => {
  assert.deepEqual(parseGenerationForm(BODY)?.vocabulary, ['cat', 'apple']);
});

test('nought of a Kind is no preference about that Kind', () => {
  // Which is what an absent entry already means, so the two must not be
  // distinguishable downstream.
  assert.deepEqual(parseGenerationForm(BODY)?.kindMix, { translation: 2 });
});

test('a Kind nobody has heard of is a shape failure, not a fault to report', () => {
  assert.equal(parseGenerationForm({ ...BODY, kindMix: { essay: 2 } }), null);
  assert.equal(parseGenerationForm({ ...BODY, kindMix: { fill_gap: -1 } }), null);
  assert.equal(parseGenerationForm({ ...BODY, kindMix: { fill_gap: 1.5 } }), null);
});

test('an exercise count out of range parses and is judged later', () => {
  // Deliberately not refused here: how many Exercises are workable is the
  // Author's contract's rule, and it is reported as a fault an Admin can read
  // rather than as a body nobody can see.
  assert.equal(parseGenerationForm({ ...BODY, exerciseCount: 500 })?.exerciseCount, 500);
  assert.equal(parseGenerationForm({ ...BODY, exerciseCount: 'six' }), null);
});

test('an empty topic parses and is judged later, for the same reason', () => {
  assert.equal(parseGenerationForm({ ...BODY, topic: '' })?.topic, '');
});

test('an absent wishes box is an empty one', () => {
  const { wishes, ...withoutWishes } = BODY;
  assert.equal(parseGenerationForm(withoutWishes)?.wishes, '');
});

// --- Refinement --------------------------------------------------------------

test('a turn carries the document, the request and the Draft it forks from', () => {
  const form = parseRefinementForm({
    document: DOCUMENT,
    message: 'Третье упражнение слишком лёгкое.',
    fromDraftId: 12,
    model: 'claude-opus-5',
    effort: 'max',
  });

  assert.deepEqual(form?.document, { ...DOCUMENT, exercises: [] });
  assert.equal(form?.message, 'Третье упражнение слишком лёгкое.');
  assert.equal(form?.fromDraftId, 12);
  assert.equal(form?.effort, 'max');
});

test('a turn with no Draft to fork from is a fresh conversation, not a shape failure', () => {
  assert.equal(parseRefinementForm({ document: DOCUMENT, message: 'x', model: 'claude-sonnet-5' })?.fromDraftId, null);
});

test('a body without a Lesson document in it is a shape failure', () => {
  assert.equal(parseRefinementForm({ message: 'x', model: 'claude-sonnet-5' }), null);
  assert.equal(parseRefinementForm({ document: { title: 'т' }, message: 'x', model: 'claude-sonnet-5' }), null);
  assert.equal(parseRefinementForm(null), null);
});
