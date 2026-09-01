// What a Deterministic Check Exercise's answer becomes: a Verdict, a row, and
// which of its gaps were accepted.
//
// One module for both places an answer is judged in code — a Lesson's Practice
// and a Test — because the two had the same eight lines each and are about to
// have more. A fill-gap now has as many gaps as its prompt says, each judged
// against its own accepted values, and a Verdict that is neither correct nor
// incorrect when some of them held. Two copies of that would eventually disagree
// about what a Student is told, on the one path where nothing but code decides.
//
// It is where the Student's answer is put back into the sentence, once, at the
// moment it is written down. Not at each of the screens that later show one:
// there are four of them, and a screen that forgot would print «кошка, стол» at
// a person.

import type { Verdict } from '../grader/contract.ts';
import type { ExerciseRow, SubmissionRow } from '../db/schema.ts';
import type { AcceptedAnswers } from '../content/exercise-validity.ts';
import { fillGaps } from '../content/gaps.ts';
import { checkGaps } from './deterministic-check.ts';

/** Enough of an Exercise to say what an answer to it reads like. */
type Asked = Pick<ExerciseRow, 'kind' | 'prompt'>;

/**
 * The Student's answer as a person reads it.
 *
 * A fill-gap is answered in pieces and read as a sentence, so this is where the
 * pieces go back into it. Every other Kind is answered in one place and reads as
 * what was written there.
 */
export function answerOf(exercise: Asked, answers: readonly string[]): string {
  return exercise.kind === 'fill_gap'
    ? fillGaps(exercise.prompt, answers)
    : answers[0] ?? '';
}

/**
 * What is stored as the per-gap record of an answer.
 *
 * Empty on every Kind with one place to answer, the way `choices` is empty on a
 * Kind with nothing to offer: a single value is already in `answer`, and storing
 * it twice would make the two able to disagree.
 */
export function gapsOf(exercise: Asked, answers: readonly string[]): string[] {
  return exercise.kind === 'fill_gap' ? answers.map((value) => value.trim()) : [];
}

/**
 * Nothing written anywhere is not answering.
 *
 * The same rule at one gap or at three, and deliberately not `answer.trim()`:
 * an unanswered fill-gap still reads as its prompt, gaps and all, so the
 * sentence is never what says whether anything was written.
 */
export function nothingAnswered(answers: readonly string[]): boolean {
  return answers.every((value) => value.trim() === '');
}

export type Judgement = {
  verdict: Verdict;
  /** The answer as a person reads it, for the row and for every screen. */
  answer: string;
  /** What was written in each gap. Empty on every Kind but fill-gap. */
  answerGaps: string[];
  /** Which gaps were accepted, in reading order. */
  gaps: boolean[];
  /**
   * The authored wording of what was accepted, or null.
   *
   * Only where the whole answer was accepted. Never on a wrong or partly wrong
   * one: that is what Reveal is for, and it is offered after three attempts
   * rather than after one — telling a Student which of three gaps to keep would
   * hand them the other two by elimination.
   */
  corrected: string | null;
};

/**
 * One Deterministic Check answer, judged.
 *
 * `partially_correct` is the whole of what is new here. Three gaps are three
 * facts being checked, and answering "неверно" without saying which of the three
 * makes the second attempt a re-guess of all of them. It costs nothing in
 * progression: an attempt that is not `correct` already counts as a failed one.
 */
export function judge(
  exercise: Asked & Pick<ExerciseRow, 'caseSensitive'>,
  answers: readonly string[],
  accepted: AcceptedAnswers,
): Judgement {
  const outcome = checkGaps(answers, accepted, { caseSensitive: exercise.caseSensitive });

  const verdict: Verdict = outcome.correct ? 'correct'
    : outcome.partial ? 'partially_correct'
      : 'incorrect';

  // The values the Exercise accepts, not the ones the Student typed: a Student
  // who wrote «AN» is shown «an», which is the point of recording a correction
  // at all.
  const corrected = outcome.correct
    ? answerOf(exercise, outcome.gaps.map((gap) => gap.matched ?? ''))
    : null;

  return {
    verdict,
    answer: answerOf(exercise, answers),
    answerGaps: gapsOf(exercise, answers),
    gaps: outcome.gaps.map((gap) => gap.correct),
    corrected,
  };
}

/**
 * The values behind a stored answer, gap by gap.
 *
 * A Kind with one place to answer stores nothing per gap — its single value is
 * already the answer — and so does every Submission written before gaps existed.
 * Both are one gap holding what is in `answer`, which is exactly what they were.
 */
export function storedGaps(row: Pick<SubmissionRow, 'answer' | 'answerGaps'>): string[] {
  return row.answerGaps.length > 0 ? row.answerGaps : [row.answer];
}
