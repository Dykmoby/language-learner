// PROTOTYPE fixtures. Each case has a KNOWN right answer so quality is checkable,
// not just latency. Ground truth for the Tajik case comes from ADR 0002.

import type { ExerciseContext, Language } from './grader.ts';

export type Case = {
  id: string;
  language: Language;
  model: string;
  ctx: ExerciseContext;
  submission: string;
  // What a correct Grader must produce. Checked by hand from the printed output.
  expect: {
    verdict: 'correct' | 'not-correct';
    plantedErrors: number;
    mustMentionTypes: string[];
    note: string;
  };
};

export const CASES: Case[] = [
  {
    id: 'en-three-errors',
    language: 'en',
    model: 'claude-sonnet-5', // design.md: Sonnet 5 for English
    submission: 'I have cat. She like the fish.',
    ctx: {
      language: 'en',
      level: 'A1',
      lessonTitle: 'Present Simple и артикли',
      grammarFocus: 'Indefinite article with countable nouns; third-person -s',
      prompt: 'Переведите на английский: У меня есть кошка. Она любит рыбу.',
      referenceAnswer: 'I have a cat. She likes fish.',
      acceptedVariants: ['I have got a cat. She likes fish.'],
      priorSubmissions: [],
    },
    expect: {
      verdict: 'not-correct',
      plantedErrors: 3,
      mustMentionTypes: ['article', 'subject_verb_agreement'],
      note: 'missing "a" before cat; "like" should be "likes"; "the fish" should be generic "fish"',
    },
  },
  {
    id: 'en-progressive-hint',
    language: 'en',
    model: 'claude-sonnet-5',
    submission: 'I have a cat. She like fish.',
    ctx: {
      language: 'en',
      level: 'A1',
      lessonTitle: 'Present Simple и артикли',
      grammarFocus: 'Indefinite article with countable nouns; third-person -s',
      prompt: 'Переведите на английский: У меня есть кошка. Она любит рыбу.',
      referenceAnswer: 'I have a cat. She likes fish.',
      acceptedVariants: ['I have got a cat. She likes fish.'],
      priorSubmissions: ['I have cat. She like the fish.'],
    },
    expect: {
      verdict: 'not-correct',
      plantedErrors: 1,
      mustMentionTypes: ['subject_verb_agreement'],
      note: 'attempt 2 — one error left. Hint must be SHARPER than attempt 1 (Progressive Hint).',
    },
  },
  {
    id: 'en-correct',
    language: 'en',
    model: 'claude-sonnet-5',
    submission: 'I have a cat. She likes fish.',
    ctx: {
      language: 'en',
      level: 'A1',
      lessonTitle: 'Present Simple и артикли',
      grammarFocus: 'Indefinite article with countable nouns; third-person -s',
      prompt: 'Переведите на английский: У меня есть кошка. Она любит рыбу.',
      referenceAnswer: 'I have a cat. She likes fish.',
      acceptedVariants: ['I have got a cat. She likes fish.'],
      priorSubmissions: [],
    },
    expect: {
      verdict: 'correct',
      plantedErrors: 0,
      mustMentionTypes: [],
      note: 'clean answer — errors must be [] and the Coherence Guard must be a no-op',
    },
  },
  {
    id: 'tj-agreement',
    language: 'tj',
    model: 'claude-opus-5', // design.md: Opus 5 for Tajik
    submission: 'Ман китоб мехонед.',
    ctx: {
      language: 'tj',
      level: 'A1',
      lessonTitle: 'Замони ҳозира — шахси якум',
      grammarFocus: 'Present tense personal endings; -ро as definiteness marker',
      prompt: 'Тарҷума кунед ба тоҷикӣ: Я читаю книгу.',
      referenceAnswer: 'Ман китобро мехонам.',
      acceptedVariants: ['Ман китоб мехонам.'],
      priorSubmissions: [],
    },
    expect: {
      verdict: 'not-correct',
      plantedErrors: 1,
      mustMentionTypes: ['verb_agreement'],
      note: 'ADR 0002 ground truth: -ед is 2nd person plural/polite (шумо), NOT 3rd singular. Should be мехонам. Haiku got this WRONG — a grader that says otherwise is disqualified.',
    },
  },
];
