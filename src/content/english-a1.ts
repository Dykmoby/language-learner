// The one Lesson the vertical slice is built on — checked in as data, not baked
// into a migration. Content is data: putting a Lesson into the schema's history
// would make changing a typo a migration.
//
// English, because it grades on the faster model (ADR 0002) and because the Tajik
// Error Type enum is still unreviewed by a Tajik speaker (design.md § Open risks).
//
// ⚠️ Reference Answers here are the only thing standing between a Student and a
// confidently wrong Verdict: the Grader is given them as ground truth. Nothing in
// the system checks them, so they are kept short enough for a person to check by
// eye, and a person must.

import type { ExerciseKind } from '../db/schema.ts';
import type { AcceptedAnswers } from './exercise-validity.ts';

export type ExerciseFixture = {
  kind: ExerciseKind;
  /** Shown to the Student, in Russian. */
  prompt: string;
  referenceAnswer: string;
  /** Deterministic Check Kinds: every form judged correct, one list per gap. */
  acceptedAnswers?: AcceptedAnswers;
  /** Set where capitalisation is the point, and nowhere else. */
  caseSensitive?: boolean;
  /** Multiple choice options, or word order fragments, in the order shown. */
  choices?: string[];
};

export type LessonFixture = {
  title: string;
  theoryMarkdown: string;
  /** Handed to the Grader as context on every call, so never a placeholder. */
  grammarFocus: string;
  practice: ExerciseFixture[];
};

export type CourseFixture = {
  language: 'en' | 'tj';
  level: string;
  graderModel: string;
  title: string;
  lessons: LessonFixture[];
};

const LESSON_ONE_THEORY = `
## Артикли **a** и **an**

В английском языке перед исчисляемым существительным в единственном числе
почти всегда стоит артикль. Когда мы говорим о предмете впервые или о любом
предмете из группы, используется неопределённый артикль.

- **a** — перед согласным звуком: *a cat*, *a book*, *a student*
- **an** — перед гласным звуком: *an apple*, *an hour*, *an umbrella*

Выбор зависит от **звука**, а не от буквы. Поэтому *an hour* (буква «h» не
читается), но *a university* (слово начинается со звука «ю»).

## Глагол **to be**

| Лицо | Форма | Пример |
| --- | --- | --- |
| I | am | I **am** a student. |
| he / she / it | is | She **is** a teacher. |
| we / you / they | are | They **are** doctors. |

В разговорной речи формы сокращаются: *I'm*, *he's*, *she's*, *they're*.

## Что важно запомнить

1. Местоимение **I** всегда пишется с заглавной буквы — в любом месте предложения.
2. Во множественном числе артикль **a/an** не ставится: *They are doctors*, а не
   ~~*They are a doctors*~~.
3. Профессия по-английски требует артикля: *She is **a** teacher.*
`.trim();

const LESSON_TWO_THEORY = `
## Present Simple: утверждение

Present Simple описывает то, что происходит регулярно или является фактом.

- I / you / we / they **work**
- he / she / it **works** — в третьем лице единственного числа добавляется **-s**

*I work in Dushanbe. She works in a school.*

## Отрицание

Отрицание строится со вспомогательным глаголом **do** или **does**:

- I / you / we / they **do not** (**don't**) work
- he / she / it **does not** (**doesn't**) work

Обратите внимание: окончание **-s** уходит к вспомогательному глаголу.
Правильно *She doesn't work*, а не ~~*She doesn't works*~~.

## Наречия частотности

*always, usually, often, sometimes, never* обычно стоят **перед** смысловым
глаголом: *I **usually** go to school by bus.*
`.trim();

export const ENGLISH_A1: CourseFixture = {
  language: 'en',
  level: 'A1',
  // ADR 0002 — Sonnet 5 for English. Stored per Course, not branched on in code.
  graderModel: 'claude-sonnet-5',
  title: 'Английский A1',
  lessons: [
    {
      title: 'Артикли a / an и глагол to be',
      grammarFocus:
        'Indefinite article a/an with singular countable nouns, chosen by sound; the verb to be in Present Simple.',
      theoryMarkdown: LESSON_ONE_THEORY,
      practice: [
        {
          kind: 'fill_gap',
          prompt: 'Вставьте артикль: I have ___ apple.',
          referenceAnswer: 'an',
          acceptedAnswers: [['an']],
        },
        {
          kind: 'fill_gap',
          // Several accepted answers, and for two different reasons: the full
          // form and the contraction are both correct English, and a Student
          // typing the contraction may produce either apostrophe character
          // depending on their keyboard.
          prompt: 'Вставьте пропущенное слово или сокращение: He ___ a doctor.',
          referenceAnswer: 'is',
          acceptedAnswers: [['is', "'s", '’s']],
        },
        {
          kind: 'fill_gap',
          // caseSensitive: the whole point of this Exercise is the capital letter.
          prompt: 'Вставьте пропущенное слово с правильной заглавной буквы: ___ am from Dushanbe.',
          referenceAnswer: 'I',
          acceptedAnswers: [['I']],
          caseSensitive: true,
        },
        {
          kind: 'multiple_choice',
          prompt: 'Выберите правильный вариант: She is ___ teacher.',
          referenceAnswer: 'a',
          acceptedAnswers: [['a']],
          choices: ['a', 'an', 'the', '— (без артикля)'],
        },
        {
          kind: 'word_order',
          prompt: 'Составьте предложение из слов: is / a / this / cat',
          referenceAnswer: 'This is a cat',
          acceptedAnswers: [['This is a cat']],
          choices: ['is', 'a', 'this', 'cat'],
        },
        {
          kind: 'translation',
          prompt: 'Переведите на английский: У меня есть кошка.',
          referenceAnswer: 'I have a cat.',
        },
        {
          kind: 'composition',
          prompt: 'Составьте предложение о своей профессии, используя глагол to be и артикль.',
          referenceAnswer: 'I am a teacher.',
        },
        {
          kind: 'open_writing',
          prompt: 'Напишите два-три предложения о себе: имя, город, профессия.',
          referenceAnswer: 'My name is Igor. I am from Dushanbe. I am a teacher.',
        },
      ],
    },
    {
      // The second Lesson exists so sequential unlocking has something to unlock.
      title: 'Present Simple: утверждение и отрицание',
      grammarFocus:
        'Present Simple affirmative and negative with do/does; the third person -s; adverbs of frequency before the main verb.',
      theoryMarkdown: LESSON_TWO_THEORY,
      practice: [
        {
          kind: 'fill_gap',
          prompt: 'Поставьте глагол в правильную форму: She ___ (work) in a school.',
          referenceAnswer: 'works',
          acceptedAnswers: [['works']],
        },
        {
          kind: 'multiple_choice',
          prompt: 'Выберите правильный вариант: He ___ like coffee.',
          referenceAnswer: "doesn't",
          acceptedAnswers: [["doesn't"]],
          choices: ["doesn't", "don't", "isn't", "aren't"],
        },
        {
          kind: 'word_order',
          // Two valid orders: the adverb of frequency may lead the sentence.
          prompt: 'Составьте предложение: usually / I / go / to school / by bus',
          referenceAnswer: 'I usually go to school by bus',
          acceptedAnswers: [['I usually go to school by bus', 'Usually I go to school by bus']],
          choices: ['usually', 'I', 'go', 'to school', 'by bus'],
        },
        {
          kind: 'translation',
          prompt: 'Переведите на английский: Он не работает по воскресеньям.',
          referenceAnswer: "He doesn't work on Sundays.",
        },
      ],
    },
  ],
};
