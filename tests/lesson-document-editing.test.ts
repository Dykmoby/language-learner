// Seam 2 — the pure half of the Exercise forms.
//
// Everything the forms do to a document that is not typing into a field is here:
// changing an Exercise's Kind, renaming an option the answers point at, removing
// one, and shaping what arrives over the wire. Each is pure, so each is a table
// rather than a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankExercise, exerciseLevelFaults, parseLessonDocument, removeChoice, renameChoice, withKind,
  documentFaults, type DocumentExercise, type LessonDocument,
} from '../src/content/lesson-document.ts';
import {
  EXERCISE_KINDS, exerciseFaults, type ExerciseFaultCode, type ExerciseKind,
} from '../src/content/exercise-validity.ts';

const A_MULTIPLE_CHOICE: DocumentExercise = {
  id: 7,
  kind: 'multiple_choice',
  prompt: 'Выберите вариант: I have ___ apple.',
  referenceAnswer: 'an',
  acceptedAnswers: ['an'],
  caseSensitive: false,
  choices: ['a', 'an', 'the'],
};

const A_TRANSLATION: DocumentExercise = {
  kind: 'translation',
  prompt: 'Переведите: У меня есть кошка.',
  referenceAnswer: 'I have a cat.',
  acceptedAnswers: [],
  caseSensitive: false,
  choices: [],
};

// --- Changing the Kind -------------------------------------------------------

// The faults that mean "you have not filled this in yet". Every other fault is a
// leftover — a field carried across from a Kind that no longer uses it — and a
// Kind change must never produce one.
const NOT_FILLED_IN_YET: ExerciseFaultCode[] = [
  'prompt_empty', 'reference_answer_empty', 'accepted_answers_required', 'choices_required',
];

test('changing an Exercise\'s Kind leaves no field from the previous Kind behind', () => {
  // The mistake the validity rules were written for: a composition still
  // carrying the options of the multiple choice it used to be.
  const asComposition = withKind(A_MULTIPLE_CHOICE, 'composition');

  assert.equal(asComposition.kind, 'composition');
  assert.deepEqual(asComposition.choices, [], 'the options are gone');
  assert.deepEqual(asComposition.acceptedAnswers, [], 'and so are the accepted answers');
  assert.equal(asComposition.prompt, A_MULTIPLE_CHOICE.prompt, 'the prompt is the author\'s work, and stays');
  assert.equal(asComposition.id, 7, 'and it is still the same Exercise');
});

test('no Kind change leaves behind a field that breaks the Exercise', () => {
  // Every pair of Kinds, in both directions, starting from a filled-in Exercise
  // of each. An earlier version of this test filtered the faults down to two
  // codes and so passed while `multiple_choice → word_order` carried three
  // options across as fragments — which raised `fragments_do_not_build_answer`
  // and blocked the save, on fields the form had stopped showing. Nothing is
  // filtered here: the only faults allowed are the ones that say a field is
  // waiting to be written.
  const filledIn: Record<ExerciseKind, DocumentExercise> = {
    composition: { kind: 'composition', prompt: 'Напишите о своём дне.', referenceAnswer: 'I woke up early.' },
    translation: A_TRANSLATION,
    open_writing: { kind: 'open_writing', prompt: 'Свободное письмо.', referenceAnswer: 'Anything goes.' },
    fill_gap: {
      kind: 'fill_gap', prompt: 'Поставьте форму: She ___ (work).',
      referenceAnswer: 'works', acceptedAnswers: ['works'], caseSensitive: true, choices: [],
    },
    multiple_choice: A_MULTIPLE_CHOICE,
    word_order: {
      kind: 'word_order', prompt: 'Составьте предложение.',
      referenceAnswer: 'This is a cat', acceptedAnswers: ['This is a cat'],
      choices: ['is', 'a', 'this', 'cat'],
    },
  };

  for (const from of EXERCISE_KINDS) {
    for (const to of EXERCISE_KINDS) {
      const changed = withKind(filledIn[from], to);
      assert.equal(changed.kind, to);

      const leftovers = exerciseFaults(changed)
        .filter((fault) => !NOT_FILLED_IN_YET.includes(fault.code));
      assert.deepEqual(
        leftovers.map((fault) => fault.code),
        [],
        `${from} → ${to} carries nothing it cannot use`,
      );
    }
  }
});

test('a multiple choice\'s answers never cross into another Kind, or back', () => {
  // A word order has options too, but its accepted answers are whole orderings
  // that tile every fragment — not the fragments themselves. So "has options"
  // and "answers are options" are different properties, and only the second
  // decides what may be carried.
  const asWordOrder = withKind(A_MULTIPLE_CHOICE, 'word_order');
  assert.deepEqual(asWordOrder.choices, [], 'options are not fragments');
  assert.deepEqual(asWordOrder.acceptedAnswers, [], 'and an option is not an ordering');
  assert.equal(asWordOrder.referenceAnswer, '');

  const wordOrder: DocumentExercise = {
    kind: 'word_order', prompt: 'Составьте предложение.',
    referenceAnswer: 'This is a cat', acceptedAnswers: ['This is a cat'],
    choices: ['is', 'a', 'this', 'cat'],
  };
  const asMultipleChoice = withKind(wordOrder, 'multiple_choice');
  assert.deepEqual(asMultipleChoice.choices, [], 'fragments are not options');
  assert.deepEqual(asMultipleChoice.acceptedAnswers, []);
  assert.equal(asMultipleChoice.referenceAnswer, '');
});

test('what both Kinds use is carried across, and what only one of them does is not', () => {
  const fillGap: DocumentExercise = {
    kind: 'fill_gap',
    prompt: 'Поставьте форму: She ___ (work).',
    referenceAnswer: 'works',
    acceptedAnswers: ['works'],
    caseSensitive: true,
    choices: [],
  };

  // Both are judged in code against a list of accepted answers, so the list and
  // the case-sensitivity flag mean the same thing in both.
  const asWordOrder = withKind(fillGap, 'word_order');
  assert.deepEqual(asWordOrder.acceptedAnswers, ['works']);
  assert.equal(asWordOrder.caseSensitive, true);

  // A Grader-judged Kind has no accepted list at all, and the flag with it.
  const asOpenWriting = withKind(fillGap, 'open_writing');
  assert.deepEqual(asOpenWriting.acceptedAnswers, []);
  assert.equal(asOpenWriting.caseSensitive, false);
  assert.equal(asOpenWriting.referenceAnswer, 'works', 'every Kind has a Reference Answer');
});

test('becoming a multiple choice clears the answers, because they must be options', () => {
  const asMultipleChoice = withKind(A_TRANSLATION, 'multiple_choice');

  assert.equal(asMultipleChoice.referenceAnswer, '', 'nothing is an option yet');
  assert.deepEqual(asMultipleChoice.acceptedAnswers, []);
  assert.deepEqual(asMultipleChoice.choices, []);
});

test('a blank Exercise of any Kind is empty rather than half-filled', () => {
  for (const kind of EXERCISE_KINDS) {
    const blank = blankExercise(kind);
    assert.deepEqual(blank, {
      kind, prompt: '', referenceAnswer: '', acceptedAnswers: [], caseSensitive: false, choices: [],
    });
  }
});

// --- Editing the options -----------------------------------------------------

test('renaming an option carries the answers that named it', () => {
  // Otherwise renaming «an» leaves an Exercise whose correct answer is not among
  // its options — the exact fault the form exists to prevent.
  const renamed = renameChoice(A_MULTIPLE_CHOICE, 1, 'an apple');

  assert.deepEqual(renamed.choices, ['a', 'an apple', 'the']);
  assert.deepEqual(renamed.acceptedAnswers, ['an apple']);
  assert.equal(renamed.referenceAnswer, 'an apple');
});

test('renaming an option that no answer named leaves the answers alone', () => {
  const renamed = renameChoice(A_MULTIPLE_CHOICE, 2, 'those');

  assert.deepEqual(renamed.choices, ['a', 'an', 'those']);
  assert.deepEqual(renamed.acceptedAnswers, ['an']);
  assert.equal(renamed.referenceAnswer, 'an');
});

test('removing an option removes the answers that named it', () => {
  const removed = removeChoice(A_MULTIPLE_CHOICE, 1);

  assert.deepEqual(removed.choices, ['a', 'the']);
  assert.deepEqual(removed.acceptedAnswers, [], 'an accepted answer nobody is offered is not an answer');
  assert.equal(removed.referenceAnswer, '', 'and neither is a Reference Answer nobody is offered');
});

test('editing an option that is not there changes nothing', () => {
  assert.deepEqual(renameChoice(A_MULTIPLE_CHOICE, 9, 'что-то'), A_MULTIPLE_CHOICE);
  assert.deepEqual(removeChoice(A_MULTIPLE_CHOICE, 9), A_MULTIPLE_CHOICE);
});

// --- What arrives over the wire ----------------------------------------------

const A_DOCUMENT = {
  title: 'Урок',
  grammarFocus: 'Indefinite article a/an.',
  theoryMarkdown: '## Теория',
  exercises: [A_MULTIPLE_CHOICE],
};

test('a whole document parses, Exercises and all', () => {
  const parsed = parseLessonDocument(JSON.parse(JSON.stringify(A_DOCUMENT)));
  assert.deepEqual(parsed, A_DOCUMENT);
});

test('a document with no exercises key is a document with no Exercises', () => {
  // A Lesson whose Practice has not been written yet is an ordinary state.
  const parsed = parseLessonDocument({
    title: 'Урок', grammarFocus: 'Focus.', theoryMarkdown: 'Теория.',
  });
  assert.deepEqual(parsed?.exercises, []);
});

test('blank answers and options are dropped on the way in', () => {
  // The form does not trim while someone is typing — a trailing newline is how a
  // second answer gets started, and an empty option is how one gets added before
  // it is written. So the emptiness is resolved here instead, by the same rule
  // the validity checks already apply: a value that normalises away is absent.
  const parsed = parseLessonDocument({
    ...A_DOCUMENT,
    exercises: [{
      ...A_MULTIPLE_CHOICE,
      acceptedAnswers: ['an', '', '   '],
      choices: ['a', 'an', '', 'the'],
    }],
  });

  assert.deepEqual(parsed?.exercises[0]?.acceptedAnswers, ['an']);
  assert.deepEqual(parsed?.exercises[0]?.choices, ['a', 'an', 'the']);
});

test('a body that is not a document at all is refused as a shape, not as a fault', () => {
  const rows: Array<{ what: string; body: unknown }> = [
    { what: 'not an object', body: 'урок' },
    { what: 'no title', body: { grammarFocus: 'f', theoryMarkdown: 't' } },
    { what: 'exercises is not an array', body: { ...A_DOCUMENT, exercises: 'нет' } },
    { what: 'an Exercise Kind nobody has heard of', body: { ...A_DOCUMENT, exercises: [{ ...A_MULTIPLE_CHOICE, kind: 'dictation' }] } },
    { what: 'accepted answers that are not strings', body: { ...A_DOCUMENT, exercises: [{ ...A_MULTIPLE_CHOICE, acceptedAnswers: [1, 2] }] } },
    { what: 'a case-sensitivity flag that is not a boolean', body: { ...A_DOCUMENT, exercises: [{ ...A_MULTIPLE_CHOICE, caseSensitive: 'да' }] } },
    // An id that never named a row must not be dropped and re-inserted: that
    // would turn an edit into a delete, taking the Exercise's Submissions.
    { what: 'an id that is not a whole number', body: { ...A_DOCUMENT, exercises: [{ ...A_MULTIPLE_CHOICE, id: 1.5 }] } },
  ];

  for (const { what, body } of rows) {
    assert.equal(parseLessonDocument(body), null, what);
  }
});

test('an empty prompt parses and is then a fault, rather than a parse failure', () => {
  // Shaping, not judging: an Admin who left a field blank should be told which
  // field, not have everything else they typed thrown away.
  const parsed = parseLessonDocument({ ...A_DOCUMENT, exercises: [{ ...A_MULTIPLE_CHOICE, prompt: '' }] });
  assert.notEqual(parsed, null);
  assert.deepEqual(
    documentFaults(parsed as LessonDocument).map((f) => f.code),
    ['prompt_empty'],
  );
});

// --- Which faults stop a save ------------------------------------------------

test('faults about an Exercise stop a save; faults about the Lesson wait for publish', () => {
  const halfWritten: LessonDocument = {
    // Ordinary states halfway through writing a Lesson.
    title: '',
    grammarFocus: '',
    theoryMarkdown: '',
    exercises: [],
  };
  assert.deepEqual(exerciseLevelFaults(documentFaults(halfWritten)), [], 'nothing here stops a save');
  assert.equal(documentFaults(halfWritten).length, 3, 'but publishing still refuses all three');

  const brokenExercise: LessonDocument = {
    title: 'Урок', grammarFocus: 'Focus.', theoryMarkdown: 'Теория.',
    // A multiple choice whose Reference Answer is not among its options: the
    // Student would be shown an answer they were never offered.
    exercises: [{ ...A_MULTIPLE_CHOICE, referenceAnswer: 'some' }],
  };
  assert.deepEqual(
    exerciseLevelFaults(documentFaults(brokenExercise)).map((f) => f.code),
    ['reference_answer_not_a_choice'],
  );
  assert.deepEqual(
    exerciseLevelFaults(documentFaults(brokenExercise)).map((f) => f.exercisePosition),
    [1],
    'and it names which Exercise',
  );
});

test('every Exercise Kind has a Russian name for the form that offers it', async () => {
  const { ru } = await import('../src/ru.ts');
  for (const kind of EXERCISE_KINDS satisfies readonly ExerciseKind[]) {
    assert.ok(ru.exerciseKinds[kind], `${kind} is named in Russian`);
  }
});
