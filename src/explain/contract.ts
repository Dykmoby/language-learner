// What Claude is asked when a Student wants to know why their answer was wrong,
// and the one thing it must not say back.
//
// Pure, and separate from the call for the same reason the Grader's contract is:
// what goes into the prompt is the whole of what an Explanation is based on, it
// is the part worth reading in a review, and it can be asserted without a live
// model.
//
// Two things make this not a Grader call. It judges nothing — the Verdict is
// already in, decided in code, and asking a model to re-decide it would put a
// second answer on screen beside the first. And it is bound by a prohibition the
// Grader has no equivalent of: the right answer is never named. A Student who is
// told which option was correct has been given the Exercise rather than helped
// through it, which is the whole reason this button exists instead of Reveal
// arriving three attempts early.

import type { ExerciseKind } from '../db/schema.ts';
import type { Language } from '../grader/contract.ts';

export type ExplanationContext = {
  language: Language;
  /** The Course's CEFR level, so the explanation is pitched at the Student. */
  level: string;
  lessonTitle: string | null;
  grammarFocus: string | null;
  kind: ExerciseKind;
  prompt: string;
  /** What the Student could choose between, where the Kind offers a choice. */
  choices: readonly string[];
  /** The answer being explained — the Student's own, wrong, and quoted back. */
  answer: string;
  /**
   * The Reference Answer, given so the explanation is about this Exercise rather
   * than about what a model guesses the Exercise wanted. It is the one thing in
   * this prompt that may never come back out, and the system prompt says so four
   * ways: not named, not spelled, not hinted at, not written into an example.
   */
  referenceAnswer: string;
};

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', tj: 'Tajik' };

/** How each Kind is put to the model, so the explanation is about the right act. */
const KINDS: Record<ExerciseKind, string> = {
  multiple_choice: 'a multiple choice question — the student picked one of the listed options',
  fill_gap: 'a fill-in-the-gap sentence — the student typed a word into each gap, written ___',
  word_order: 'a word-order task — the student arranged fragments into a sentence, choosing from'
    + ' the fragments listed below, some of which may belong in no correct sentence and are'
    + ' there to be left out',
  composition: 'a short composition',
  translation: 'a translation',
  open_writing: 'an open writing task',
};

/**
 * The prohibition, written as a system prompt rather than enforced afterwards.
 *
 * It cannot be enforced afterwards. A filter that searched the text for the
 * Reference Answer would catch the flat case and miss every paraphrase, and
 * running one at all would mean holding the whole explanation back to check it —
 * which is the streaming the Student is waiting on. So this is an instruction
 * that a model can disobey, in the same way the Grader's ladder is, and it is
 * written at the length that makes disobeying it hard.
 */
export function buildSystemPrompt(context: ExplanationContext): string {
  return [
    `You are helping a Russian-speaking student who is learning ${LANGUAGE_NAMES[context.language]} at CEFR level ${context.level}.`,
    '',
    'The student answered an exercise incorrectly and has asked why their answer is wrong.',
    '',
    'Your task: explain what is wrong with the answer they gave.',
    '',
    'ABSOLUTE RULE — you must never reveal the correct answer:',
    '- Do not state it, quote it, spell it, or write the corrected sentence.',
    '- Do not say which of the offered options is right, or eliminate options until one is left.',
    '- Do not give an example sentence that contains the correct answer.',
    '- Do not hint at it so plainly that naming it would add nothing.',
    'The student has to work it out themselves. That is the point of the exercise.',
    'The correct answer is given to you below only so that your explanation is accurate.',
    'If you cannot explain the mistake without revealing the answer, explain the rule that',
    'governs the choice instead, in general terms.',
    '',
    'How to write it:',
    '- In Russian.',
    '- Two to four sentences. Plain text, no markdown, no headings, no lists.',
    '- Address the student directly and kindly. Name the rule their answer breaks,',
    '  in the words a learner at this level would understand.',
    '- Explain their mistake, not the whole grammar topic.',
  ].join('\n');
}

/** Everything about this particular Exercise and this particular wrong answer. */
export function buildUserPrompt(context: ExplanationContext): string {
  const lines = [
    `Exercise kind: ${KINDS[context.kind]}.`,
    context.lessonTitle === null ? null : `Lesson: ${context.lessonTitle}`,
    context.grammarFocus === null ? null : `Grammar focus: ${context.grammarFocus}`,
    '',
    'Exercise prompt:',
    context.prompt,
  ];

  if (context.choices.length > 0) {
    lines.push('', 'Options offered:', ...context.choices.map((choice) => `- ${choice}`));
  }

  lines.push(
    '',
    "The student's answer (this is what you are explaining):",
    context.answer,
    '',
    'The correct answer (NEVER reveal this, in any form):',
    context.referenceAnswer,
    '',
    'Now explain, in Russian, why the student\'s answer is wrong — without revealing the correct answer.',
  );

  return lines.filter((line) => line !== null).join('\n');
}
