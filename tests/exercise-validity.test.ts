// Seam 2 — a pure function, tested exhaustively.
//
// One row per rule in design.md § Exercise Kinds, in both directions: the shape
// that breaks the rule and the shape that satisfies it. A validity module tested
// only on its refusals would pass while refusing everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  exerciseFaults, EXERCISE_FAULTS, MAX_FRAGMENTS,
  type AuthoredExercise, type ExerciseFaultCode,
} from '../src/content/exercise-validity.ts';
import { ru } from '../src/ru.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';

// A shape that breaks no rule, narrowed per row. Every row below states only the
// field it is about, so a row's meaning is not buried in boilerplate.
const OK: AuthoredExercise = {
  kind: 'translation',
  prompt: 'Переведите: У меня есть кошка.',
  referenceAnswer: 'I have a cat.',
};

// A fill-gap says in its prompt how many places there are to answer, so a row
// about one has to carry a prompt with as many gaps as it has positions —
// otherwise every such row also reports `gap_count_mismatch`, which is a
// different rule and has its own table below.
const ONE_GAP = 'Вставьте артикль: I have ___ apple.';

function codes(exercise: Partial<AuthoredExercise>): ExerciseFaultCode[] {
  return exerciseFaults({ ...OK, ...exercise }).map((f) => f.code).sort();
}

type Row = { what: string; exercise: Partial<AuthoredExercise>; expect: ExerciseFaultCode[] };

function runTable(rows: Row[]): void {
  for (const row of rows) {
    assert.deepEqual(codes(row.exercise), [...row.expect].sort(), row.what);
  }
}

test('every Exercise needs a prompt and a Reference Answer', () => {
  runTable([
    { what: 'a complete Exercise has no faults', exercise: {}, expect: [] },
    { what: 'an empty prompt', exercise: { prompt: '' }, expect: ['prompt_empty'] },
    { what: 'a prompt of only whitespace is empty', exercise: { prompt: '   \n ' }, expect: ['prompt_empty'] },
    { what: 'an empty Reference Answer', exercise: { referenceAnswer: '' }, expect: ['reference_answer_empty'] },
    { what: 'a Reference Answer of only whitespace', exercise: { referenceAnswer: ' \t ' }, expect: ['reference_answer_empty'] },
    {
      what: 'both at once are both reported — the Admin fixes one form, not one field at a time',
      exercise: { prompt: '', referenceAnswer: '' },
      expect: ['prompt_empty', 'reference_answer_empty'],
    },
  ]);
});

test('a Deterministic Check Kind needs at least one accepted answer', () => {
  runTable([
    {
      what: 'fill-gap with no accepted answers cannot be judged at all',
      exercise: { kind: 'fill_gap', referenceAnswer: 'an', acceptedAnswers: [] },
      expect: ['accepted_answers_required'],
    },
    {
      what: 'fill-gap with the field left off entirely',
      exercise: { kind: 'fill_gap', referenceAnswer: 'an' },
      expect: ['accepted_answers_required'],
    },
    {
      what: 'fill-gap with one accepted answer is complete',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'an', acceptedAnswers: [['an']] },
      expect: [],
    },
    {
      what: 'an accepted answer that is only whitespace does not count as one',
      exercise: { kind: 'fill_gap', referenceAnswer: 'an', acceptedAnswers: [['  ']] },
      expect: ['accepted_answers_required'],
    },
  ]);
});

test('multiple choice: the options, and what may be judged correct among them', () => {
  const base = { kind: 'multiple_choice' as const, referenceAnswer: 'a', acceptedAnswers: [['a']] };
  runTable([
    {
      what: 'four options with the Reference Answer among them',
      exercise: { ...base, choices: ['a', 'an', 'the', '— (без артикля)'] },
      expect: [],
    },
    {
      what: 'no options at all cannot be rendered',
      exercise: { ...base, choices: [] },
      expect: ['choices_required'],
    },
    {
      what: 'a single option is not a choice',
      exercise: { ...base, choices: ['a'] },
      expect: ['choices_required'],
    },
    {
      what: 'an accepted answer that is not on offer can never be selected',
      exercise: { ...base, acceptedAnswers: [['a', 'some']], choices: ['a', 'an', 'the'] },
      expect: ['accepted_answer_not_a_choice'],
    },
    {
      what: 'a Reference Answer that is not on offer shows the Student something never offered',
      exercise: { ...base, referenceAnswer: 'some', acceptedAnswers: [['a']], choices: ['a', 'an', 'the'] },
      expect: ['reference_answer_not_a_choice'],
    },
    {
      what: 'options are matched the way the Deterministic Check will match them',
      exercise: { ...base, referenceAnswer: 'A', acceptedAnswers: [['A']], choices: ['a', 'an', 'the'] },
      expect: [],
    },
    {
      what: 'under caseSensitive the same pair no longer matches',
      exercise: { ...base, referenceAnswer: 'A', acceptedAnswers: [['A']], choices: ['a', 'an', 'the'], caseSensitive: true },
      expect: ['accepted_answer_not_a_choice', 'reference_answer_not_a_choice'],
    },
  ]);
});

test('word order: every accepted order is built from exactly the fragments shown', () => {
  const base = { kind: 'word_order' as const };
  runTable([
    {
      what: 'the fixture shape: single-word fragments',
      exercise: {
        ...base,
        referenceAnswer: 'This is a cat',
        acceptedAnswers: [['This is a cat']],
        choices: ['is', 'a', 'this', 'cat'],
      },
      expect: [],
    },
    {
      what: 'multi-word fragments, which is why this is not a whitespace split',
      exercise: {
        ...base,
        referenceAnswer: 'I usually go to school by bus',
        acceptedAnswers: [['I usually go to school by bus', 'Usually I go to school by bus']],
        choices: ['usually', 'I', 'go', 'to school', 'by bus'],
      },
      expect: [],
    },
    {
      what: 'an accepted order using a word that is not on offer',
      exercise: {
        ...base,
        referenceAnswer: 'This is my cat',
        acceptedAnswers: [['This is my cat']],
        choices: ['is', 'a', 'this', 'cat'],
      },
      expect: ['fragments_do_not_build_answer'],
    },
    {
      what: 'an accepted order that leaves a fragment unused',
      exercise: {
        ...base,
        referenceAnswer: 'This is a cat',
        acceptedAnswers: [['This is a cat']],
        choices: ['is', 'a', 'this', 'cat', 'big'],
      },
      expect: ['fragments_do_not_build_answer'],
    },
    {
      what: 'an accepted order that reuses one fragment twice',
      exercise: {
        ...base,
        referenceAnswer: 'a cat a cat',
        acceptedAnswers: [['a cat a cat']],
        choices: ['a', 'cat'],
      },
      expect: ['fragments_do_not_build_answer'],
    },
    {
      what: 'fragments that recombine across their own boundaries do not build the answer',
      exercise: {
        ...base,
        referenceAnswer: 'to bus by school',
        acceptedAnswers: [['to bus by school']],
        choices: ['to school', 'by bus'],
      },
      expect: ['fragments_do_not_build_answer'],
    },
    {
      what: 'a repeated fragment is offered twice and used twice',
      exercise: {
        ...base,
        referenceAnswer: 'a cat and a dog',
        acceptedAnswers: [['a cat and a dog']],
        choices: ['a', 'cat', 'and', 'a', 'dog'],
      },
      expect: [],
    },
    {
      what: 'word order needs fragments to show, like multiple choice needs options',
      exercise: { ...base, referenceAnswer: 'This is a cat', acceptedAnswers: [['This is a cat']], choices: [] },
      expect: ['choices_required'],
    },
  ]);
});

test('a Grader-judged Kind carries neither choices nor accepted answers', () => {
  runTable([
    {
      what: 'leftover choices are a sign the Kind changed and the fields did not',
      exercise: { kind: 'composition', choices: ['a', 'an'] },
      expect: ['choices_not_allowed'],
    },
    {
      what: 'leftover accepted answers, likewise',
      exercise: { kind: 'open_writing', acceptedAnswers: [['I have a cat.']] },
      expect: ['accepted_answers_not_allowed'],
    },
    {
      what: 'both left behind at once',
      exercise: { kind: 'translation', choices: ['a'], acceptedAnswers: [['a']] },
      expect: ['choices_not_allowed', 'accepted_answers_not_allowed'],
    },
    {
      what: 'fill-gap has no options to offer either — only multiple choice and word order do',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'an', acceptedAnswers: [['an']], choices: ['a', 'an'] },
      expect: ['choices_not_allowed'],
    },
  ]);
});

test('two accepted answers that collapse to the same string are an authoring mistake', () => {
  runTable([
    {
      what: 'differing only by case, which the Deterministic Check folds away',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'is', acceptedAnswers: [['is', 'IS']] },
      expect: ['duplicate_accepted_answers'],
    },
    {
      what: 'differing only by a trailing full stop',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'is', acceptedAnswers: [['is', 'is.']] },
      expect: ['duplicate_accepted_answers'],
    },
    {
      what: 'differing only by ё, which normalises to е',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'ещё', acceptedAnswers: [['ещё', 'еще']] },
      expect: ['duplicate_accepted_answers'],
    },
    {
      what: 'under caseSensitive, case is no longer folded and the pair is two real answers',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'is', acceptedAnswers: [['is', 'IS']], caseSensitive: true },
      expect: [],
    },
    {
      what: 'genuinely different answers are not duplicates',
      exercise: { kind: 'fill_gap', prompt: ONE_GAP, referenceAnswer: 'is', acceptedAnswers: [['is', "'s", '’s']] },
      expect: [],
    },
  ]);
});

test('the fault names the value at fault where one value is to blame', () => {
  const faults = exerciseFaults({
    kind: 'multiple_choice',
    prompt: 'Выберите артикль.',
    referenceAnswer: 'a',
    acceptedAnswers: [['a', 'some']],
    choices: ['a', 'an', 'the'],
  });
  assert.deepEqual(faults, [{ code: 'accepted_answer_not_a_choice', offending: 'some' }]);
});

test('every fault code has a Russian message, and the dictionary invents none', () => {
  const described = Object.keys(ru.exerciseFaults).sort();
  assert.deepEqual(described, [...EXERCISE_FAULTS].sort());
});

test('the checked-in fixture breaks no rule', () => {
  // The fixture is the content the application actually ships with. A rule it
  // fails is either a real bug in the fixture or a wrong rule, and either way
  // this is where it should be found.
  for (const lesson of ENGLISH_A1.lessons) {
    lesson.practice.forEach((exercise, index) => {
      assert.deepEqual(
        exerciseFaults(exercise),
        [],
        `${ENGLISH_A1.title} / ${lesson.title} / exercise ${index + 1}`,
      );
    });
  }
});

test('the validity rules stay pure', () => {
  const source = readFileSync(new URL('../src/content/exercise-validity.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
  assert.deepEqual(
    imports,
    ['../practice/deterministic-check.ts', './gaps.ts'],
    'the only dependencies are the normalisation and the gaps the rules are judged against',
  );
  assert.ok(!/\bnode:(fs|net|http|child_process|sqlite)\b/.test(source), 'no I/O module reference');
  assert.ok(!/drizzle/.test(source), 'no database reference');
});

test('a word order with more fragments than can be checked is refused, not waved through', () => {
  // The tiling search is bounded so a pathological set cannot hang the form.
  // Beyond the bound the Exercise is refused rather than passed: passing what
  // could not be checked would leave exactly the hole these rules exist to close
  // once Generation is writing the Drafts.
  const fragments = Array.from({ length: MAX_FRAGMENTS + 1 }, (_, i) => `w${i}`);
  assert.deepEqual(
    codes({
      kind: 'word_order',
      referenceAnswer: fragments.join(' '),
      acceptedAnswers: [[fragments.join(' ')]],
      choices: fragments,
    }),
    ['too_many_fragments'],
    'refused even though the answer genuinely is built from the fragments',
  );

  // Exactly at the bound it is still checked properly, in both directions.
  const atBound = Array.from({ length: MAX_FRAGMENTS }, (_, i) => `w${i}`);
  assert.deepEqual(
    codes({
      kind: 'word_order',
      referenceAnswer: atBound.join(' '),
      acceptedAnswers: [[atBound.join(' ')]],
      choices: atBound,
    }),
    [],
  );
  assert.deepEqual(
    codes({
      kind: 'word_order',
      referenceAnswer: atBound.join(' '),
      acceptedAnswers: [[[...atBound, 'extra'].join(' ')]],
      choices: atBound,
    }),
    ['fragments_do_not_build_answer'],
  );
});

// --- Gaps and positions ------------------------------------------------------

test('the prompt says how many places there are to answer, and the answers must agree', () => {
  runTable([
    {
      what: 'three gaps and three lists of accepted values',
      exercise: {
        kind: 'fill_gap',
        prompt: '___ have ___ cat and ___ dog.',
        referenceAnswer: 'I have a cat and a dog.',
        acceptedAnswers: [['I'], ['a'], ['a']],
      },
      expect: [],
    },
    {
      what: 'a second gap nothing judges — one input would have nothing behind it',
      exercise: {
        kind: 'fill_gap',
        prompt: '___ have ___ cat.',
        referenceAnswer: 'I have a cat.',
        acceptedAnswers: [['I']],
      },
      expect: ['gap_count_mismatch'],
    },
    {
      what: 'a list of accepted values with no gap to sit in',
      exercise: {
        kind: 'fill_gap',
        prompt: 'I have ___ cat.',
        referenceAnswer: 'I have a cat.',
        acceptedAnswers: [['a'], ['cat']],
      },
      expect: ['gap_count_mismatch'],
    },
    {
      what: 'a fill-gap whose prompt has no gap at all cannot be rendered',
      exercise: {
        kind: 'fill_gap',
        prompt: 'Вставьте артикль.',
        referenceAnswer: 'a',
        acceptedAnswers: [['a']],
      },
      expect: ['gap_count_mismatch'],
    },
    {
      what: 'a gap with nothing accepted at it is named as such, not as a count',
      exercise: {
        kind: 'fill_gap',
        prompt: '___ have ___ cat.',
        referenceAnswer: 'I have a cat.',
        acceptedAnswers: [['I'], []],
      },
      expect: ['accepted_answers_required'],
    },
    {
      what: 'a gap holding only whitespace is a gap with nothing accepted at it',
      exercise: {
        kind: 'fill_gap',
        prompt: '___ have ___ cat.',
        referenceAnswer: 'I have a cat.',
        acceptedAnswers: [['I'], ['  ']],
      },
      expect: ['accepted_answers_required'],
    },
    {
      what: 'a multiple choice has exactly one place to answer, whatever its prompt says',
      exercise: {
        kind: 'multiple_choice',
        prompt: 'Выберите вариант: I have ___ apple.',
        referenceAnswer: 'an',
        acceptedAnswers: [['an'], ['a']],
        choices: ['a', 'an', 'the'],
      },
      expect: ['gap_count_mismatch'],
    },
    {
      what: 'a word order likewise — one ordering, not one per word',
      exercise: {
        kind: 'word_order',
        prompt: 'Составьте предложение: is / a / this / cat',
        referenceAnswer: 'This is a cat',
        acceptedAnswers: [['This is a cat'], ['This is a cat']],
        choices: ['is', 'a', 'this', 'cat'],
      },
      expect: ['gap_count_mismatch'],
    },
  ]);
});

test('the same word accepted at two different gaps is not a duplicate', () => {
  // Duplicates are compared within a position and never across them. «a» at both
  // gaps of one sentence is ordinary English, and a rule that compared the two
  // would refuse the sentence for being consistent.
  runTable([
    {
      what: 'the same value at two gaps',
      exercise: {
        kind: 'fill_gap',
        prompt: 'I have ___ cat and ___ dog.',
        referenceAnswer: 'I have a cat and a dog.',
        acceptedAnswers: [['a'], ['a']],
      },
      expect: [],
    },
    {
      what: 'written twice at one gap is still an authoring mistake',
      exercise: {
        kind: 'fill_gap',
        prompt: 'I have ___ cat and ___ dog.',
        referenceAnswer: 'I have a cat and a dog.',
        acceptedAnswers: [['a', 'A'], ['a']],
      },
      expect: ['duplicate_accepted_answers'],
    },
  ]);
});
