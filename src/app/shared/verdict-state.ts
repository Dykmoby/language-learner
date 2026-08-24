// The six states a judgement can be in, as one vocabulary.
//
// Before this, the states were styled once per screen by whoever built that
// screen: the Practice marked an Error with a left border, the Test review
// tinted the whole Exercise, the progress bar striped Completed With Help, a
// Dispute got dashes. Four screens, four vocabularies, and no single place that
// said what a state looked like. They had not yet come to disagree, but nothing
// stopped them.
//
// Worse, two of the six had no visual treatment at all. `partially_correct` and
// `grading_failed` were told apart from a wrong answer by their Russian wording
// alone — and design.md is explicit that a failure must never be rendered as a
// wrong answer, on a path measured at roughly one call in twenty-four rather
// than a defensive one that never fires.
//
// So: one name per state here, one class per state in `globals.css`, one pair of
// tokens per state in `tokens.css`, one string per state in the dictionary. A
// screen that wants to show a state asks this module and is given all three ways
// of telling it apart at once.

import { ru } from '../../ru.ts';
import type { ExerciseState } from '../../practice/progress.ts';
import type { Verdict } from '../../grader/contract.ts';

export const VERDICT_STATES = [
  'correct',
  'partial',
  'incorrect',
  'help',
  'disputed',
  'failed',
] as const;

export type VerdictState = (typeof VERDICT_STATES)[number];

/**
 * The three a Verdict can be. The other three are facts about a Submission that
 * no Verdict produces — a Reveal, an objection, a call that never returned — so
 * saying so in the type keeps a caller from having to handle states that cannot
 * reach it.
 */
export type JudgementState = Extract<VerdictState, 'correct' | 'partial' | 'incorrect'>;

/**
 * The class carrying this state's hue and the shape of its rail.
 *
 * Two of the three distinctions travel together deliberately: a screen cannot
 * pick up the colour of a state and forget its pattern, because they are the
 * same class.
 */
export function stateClass(state: VerdictState): string {
  return `state-${state}`;
}

/** The third distinction. Enough on its own, on a screen with no colour at all. */
export function stateWords(state: VerdictState): string {
  return ru.states[state];
}

/**
 * A Verdict, as the Grader proposes it and the Coherence Guard settles it.
 *
 * A grading failure is not here on purpose: it is not a Verdict. Nothing was
 * judged, so there is no judgement to map, and the caller has to have noticed
 * that before it gets this far.
 */
export function stateOfVerdict(verdict: Verdict): JudgementState {
  return verdict === 'correct' ? 'correct'
    : verdict === 'partially_correct' ? 'partial'
      : 'incorrect';
}

/**
 * A segment of the progress bar.
 *
 * `current` and `not_reached` return null: neither is a judgement — one is where
 * the Student is and the other is where they have not been — so neither may
 * borrow a state's hue. They keep the bar's own neutral treatment.
 */
export function stateOfExercise(state: ExerciseState): VerdictState | null {
  return state === 'completed' ? 'correct'
    : state === 'completed_with_help' ? 'help'
      : state === 'disputed' ? 'disputed'
        : null;
}
