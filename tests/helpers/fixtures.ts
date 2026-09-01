// Content written for the tests, seeded through the same script the Pi runs.
//
// The real fixture (ENGLISH_A1) is what the screens are demonstrated against,
// but it cannot be finished without a live model: three of its Exercises are
// Grader-judged, and a hermetic suite cannot make a model return `correct`.
// Progression, unlocking and the Lesson-complete path are therefore proved
// against Deterministic Check Exercises, which need no model to produce a chosen
// Verdict — exactly as #19 asks.

import type { CourseFixture } from '../../src/content/english-a1.ts';
import type { ExerciseKind } from '../../src/db/schema.ts';

/** Two short Lessons, every Exercise judged in code, so a Course can be finished. */
export const DETERMINISTIC_COURSE: CourseFixture = {
  language: 'en',
  level: 'A1',
  graderModel: 'claude-sonnet-5',
  title: 'Тестовый курс',
  lessons: [
    {
      title: 'Первый урок',
      grammarFocus: 'Indefinite article a/an with singular countable nouns.',
      theoryMarkdown: '## Первый урок\n\nАртикль **a** перед согласным звуком.',
      practice: [
        { kind: 'fill_gap', prompt: 'Вставьте артикль: I have ___ cat.', referenceAnswer: 'a', acceptedAnswers: [['a']] },
        {
          kind: 'multiple_choice',
          prompt: 'Выберите вариант: I have ___ apple.',
          referenceAnswer: 'an', acceptedAnswers: [['an']], choices: ['a', 'an', 'the'],
        },
        {
          kind: 'word_order',
          prompt: 'Составьте предложение: is / a / this / cat',
          referenceAnswer: 'This is a cat', acceptedAnswers: [['This is a cat']],
          choices: ['is', 'a', 'this', 'cat'],
        },
      ],
    },
    {
      title: 'Второй урок',
      grammarFocus: 'Present Simple third person -s.',
      theoryMarkdown: '## Второй урок\n\nВ третьем лице добавляется **-s**.',
      practice: [
        { kind: 'fill_gap', prompt: 'Поставьте форму: She ___ (work).', referenceAnswer: 'works', acceptedAnswers: [['works']] },
      ],
    },
  ],
};

/** A Course nobody is meant to be able to reach, once the test drops its Enrollment. */
export const OTHER_COURSE: CourseFixture = {
  language: 'en',
  level: 'A2',
  graderModel: 'claude-sonnet-5',
  title: 'Чужой курс',
  lessons: [
    {
      title: 'Чужой урок',
      grammarFocus: 'Past Simple regular verbs.',
      theoryMarkdown: '## Чужой урок\n\nЭтот урок не для этого студента.',
      practice: [
        { kind: 'fill_gap', prompt: 'Вставьте форму: I ___ (work) yesterday.', referenceAnswer: 'worked', acceptedAnswers: [['worked']] },
      ],
    },
  ],
};

/** Theory that tries to bring its own markup. Step 5 will have Claude writing this. */
export const HOSTILE_THEORY_COURSE: CourseFixture = {
  language: 'en',
  level: 'A1',
  graderModel: 'claude-sonnet-5',
  title: 'Курс с разметкой',
  lessons: [
    {
      title: 'Урок с разметкой',
      grammarFocus: 'Articles, with markup in the Theory.',
      theoryMarkdown: [
        '## Заголовок',
        '',
        '<script>window.__owned = true;</script>',
        '',
        '<img src=x onerror="window.__owned = true">',
        '',
        '[нажми](javascript:window.__owned=true)',
      ].join('\n'),
      practice: [
        { kind: 'fill_gap', prompt: 'Вставьте артикль: I have ___ cat.', referenceAnswer: 'a', acceptedAnswers: [['a']] },
      ],
    },
  ],
};

/**
 * One Course per Exercise Kind, each with that Kind as the only Exercise of its
 * only Lesson — the only way to have all six reachable at once, since Practice
 * presents one Exercise at a time and Lessons unlock sequentially.
 */
export function kindShowcase(kind: ExerciseKind): CourseFixture {
  const deterministic = {
    // A fill-gap's prompt is what says how many places there are to answer, so
    // one that carried no `___` would render no input at all — and is refused by
    // the validity rules for exactly that reason.
    fill_gap: { gaps: ': I have ___ cat.', acceptedAnswers: [['a']], choices: [] },
    multiple_choice: { gaps: '', acceptedAnswers: [['a']], choices: ['a', 'an', 'the'] },
    word_order: { gaps: '', acceptedAnswers: [['This is a cat']], choices: ['is', 'a', 'this', 'cat'] },
  }[kind as 'fill_gap' | 'multiple_choice' | 'word_order']
    ?? { gaps: '', acceptedAnswers: [], choices: [] };
  const { gaps, ...fields } = deterministic;

  return {
    language: 'en',
    level: 'A1',
    graderModel: 'claude-sonnet-5',
    title: `Показ: ${kind}`,
    lessons: [
      {
        title: `Урок ${kind}`,
        grammarFocus: 'Indefinite article a/an with singular countable nouns.',
        theoryMarkdown: `## Урок ${kind}\n\nОдно упражнение этого вида.`,
        practice: [
          {
            kind,
            prompt: `Задание вида ${kind}${gaps}`,
            referenceAnswer: 'a',
            ...fields,
          },
        ],
      },
    ],
  };
}

export const KIND_SHOWCASES = [
  'fill_gap', 'multiple_choice', 'word_order', 'composition', 'translation', 'open_writing',
] as const satisfies readonly ExerciseKind[];

/**
 * A Lesson whose Exercises have several gaps each, and a Test of the same.
 *
 * Its own Course, because the Practice presents one Exercise at a time and
 * Lessons unlock sequentially: a multi-gap Exercise buried behind two others is
 * one no test can reach without answering them first.
 *
 * The prompts are deliberately shaped so that a value accepted at one gap is not
 * accepted at another — that is the property per-gap judgement exists for, and a
 * fixture where every gap took the same word would pass under the rule this
 * replaces.
 */
export const MULTI_GAP_COURSE: CourseFixture = {
  language: 'en',
  level: 'A1',
  graderModel: 'claude-sonnet-5',
  title: 'Курс с пропусками',
  lessons: [
    {
      title: 'Урок с пропусками',
      grammarFocus: 'Indefinite article a/an, and the pronoun I.',
      theoryMarkdown: '## Урок с пропусками\n\nВ одном предложении может быть несколько пропусков.',
      practice: [
        {
          kind: 'fill_gap',
          prompt: 'Заполните пропуски: ___ have ___ apple and ___ cat.',
          referenceAnswer: 'I have an apple and a cat.',
          acceptedAnswers: [['I'], ['an'], ['a']],
        },
        {
          kind: 'fill_gap',
          prompt: 'Заполните пропуски: She ___ a teacher and he ___ a driver.',
          referenceAnswer: 'She is a teacher and he is a driver.',
          acceptedAnswers: [['is'], ['is']],
        },
      ],
    },
  ],
};
