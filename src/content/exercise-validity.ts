// Whether an Exercise's fields are coherent for its Exercise Kind — design.md
// § Exercise Kinds.
//
// Nothing in the system used to ask this. A multiple choice whose Reference
// Answer is not among its options, a fill-gap with nothing to match against, a
// composition still carrying the options of the Kind it used to be: all of them
// seeded cleanly and failed in front of a Student. The only thing standing
// between a Student and a broken Exercise was a person reading the fixture by
// eye — and step 5 hands the authoring to Claude, where there is no such person.
//
// Faults are reported as **stable codes**, never as sentences. The Russian
// wording is resolved from the central dictionary at display time, the same
// split the Error Type enum makes for the same reason: only the label ever
// changes, and the rule has to survive that.
//
// Pure by construction, and asserted so by a test. Both imports are things a
// rule has to agree with exactly rather than approximate: the normalisation,
// because a rule that compared answers differently from the Deterministic Check
// would pass Exercises the Student then failed; and where the gaps are, because
// a rule that counted them differently from the screen would pass an Exercise
// that renders a number of inputs nothing judges.

import { normaliseAnswer } from '../practice/deterministic-check.ts';
import { gapCount } from './gaps.ts';

// The single definition of what Kinds exist. It lives here rather than in the
// schema for the same reason the Grader's contract owns LANGUAGES and VERDICTS:
// this module imports nothing that touches the database, so it is the safe place
// for a constant both it and the schema depend on.
export const EXERCISE_KINDS = [
  'composition', 'translation', 'open_writing',
  'fill_gap', 'multiple_choice', 'word_order',
] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

// Which Kinds are settled in code and which go to the Grader. A property of the
// Kind itself, so it lives beside the Kind rather than as a branch in whichever
// module happens to need it first.
export const DETERMINISTIC_KINDS = [
  'fill_gap', 'multiple_choice', 'word_order',
] as const satisfies readonly ExerciseKind[];

export function isDeterministic(kind: ExerciseKind): boolean {
  return (DETERMINISTIC_KINDS as readonly ExerciseKind[]).includes(kind);
}

// The Kinds that show the Student something to pick from or arrange. Fill-gap is
// deliberately not one of them: it is judged in code like the other two, but the
// Student types their answer rather than choosing it.
const KINDS_WITH_CHOICES = ['multiple_choice', 'word_order'] as const satisfies readonly ExerciseKind[];

/** Whether this Kind shows the Student something to pick from or arrange. */
export function offersChoices(kind: ExerciseKind): boolean {
  return (KINDS_WITH_CHOICES as readonly ExerciseKind[]).includes(kind);
}

/**
 * Whether this Kind's accepted answers are drawn from its own options rather
 * than typed out.
 *
 * Only a multiple choice works that way, and the distinction is sharper than it
 * looks: a word order also has options, but its accepted answers are whole
 * orderings that must tile every fragment, not the fragments themselves. So
 * "has options" and "answers are options" are two different properties, and
 * conflating them carries an option label across into a Kind where it is not an
 * answer at all.
 *
 * A property of the Kind, so it lives here beside the Kind rather than as a
 * branch in whichever module happens to need it first.
 */
export function answersAreChoices(kind: ExerciseKind): boolean {
  return kind === 'multiple_choice';
}

/**
 * What an Exercise accepts, as one list per position — one entry for each place
 * in the prompt a Student answers, holding every value accepted there.
 *
 * Uniform across the Kinds rather than fill-gap-only. An Exercise with a single
 * place to answer — a multiple choice, a word order, a one-gap fill-gap — is the
 * honest special case of this shape: one position, several accepted values.
 * Keeping a flat list alive beside it would be a second shape to get wrong at
 * every call site that touches an answer.
 */
export type AcceptedAnswers = readonly (readonly string[])[];

export const EXERCISE_FAULTS = [
  'prompt_empty',
  'gap_count_mismatch',
  'too_many_fragments',
  'reference_answer_empty',
  'accepted_answers_required',
  'accepted_answers_not_allowed',
  'choices_required',
  'choices_not_allowed',
  'accepted_answer_not_a_choice',
  'reference_answer_not_a_choice',
  'fragments_do_not_build_answer',
  'duplicate_accepted_answers',
] as const;
export type ExerciseFaultCode = (typeof EXERCISE_FAULTS)[number];

export type ExerciseFault = {
  code: ExerciseFaultCode;
  /** The value at fault, where one particular value is to blame rather than the shape. */
  offending?: string;
};

/**
 * An Exercise as an author has it, before it is a row. Optional where the schema
 * has a default, because a form that has not been filled in yet has no array at
 * all — and "no accepted answers" and "an empty list of them" are the same fault.
 */
export type AuthoredExercise = {
  kind: ExerciseKind;
  prompt: string;
  referenceAnswer: string;
  acceptedAnswers?: AcceptedAnswers;
  caseSensitive?: boolean;
  choices?: readonly string[];
};

/** A value that normalises away is absent, whatever the raw string looked like. */
export function isBlank(value: string): boolean {
  return value.trim() === '';
}

// Word-order fragments are not words. The fixture offers `to school` and `by bus`
// as single fragments, so an accepted order cannot be checked by splitting it on
// whitespace — the question is whether the fragments *tile* the answer, each used
// exactly once, and that is a search rather than a comparison.
//
// Bounded by memoising (position, fragments-used) so a pathological set cannot
// hang the form. Beyond the cap the Exercise is **refused** rather than waved
// through: a word order with more than twelve fragments is not something anyone
// can author usefully, and passing what could not be checked would leave exactly
// the hole these rules exist to close once Generation is writing the Drafts.
export const MAX_FRAGMENTS = 12;

function fragmentsBuildAnswer(
  answer: string,
  fragments: readonly string[],
  caseSensitive: boolean,
): boolean {
  const target = normaliseAnswer(answer, { caseSensitive });
  const parts = fragments
    .map((fragment) => normaliseAnswer(fragment, { caseSensitive }))
    .filter((fragment) => fragment !== '');

  if (parts.length === 0 || target === '') return false;

  const everyFragment = (1 << parts.length) - 1;
  const exhausted = new Set<number>();

  const walk = (index: number, used: number): boolean => {
    if (index === target.length) return used === everyFragment;

    const state = index * (everyFragment + 1) + used;
    if (exhausted.has(state)) return false;

    for (let i = 0; i < parts.length; i += 1) {
      const bit = 1 << i;
      if (used & bit) continue;
      const part = parts[i]!;
      if (!target.startsWith(part, index)) continue;

      // A fragment ends where the next one begins, or where the answer does.
      // Without this, `a` would match the head of `and` and tile nothing.
      const next = index + part.length;
      if (next === target.length) {
        if (walk(next, used | bit)) return true;
      } else if (target[next] === ' ' && walk(next + 1, used | bit)) {
        return true;
      }
    }

    exhausted.add(state);
    return false;
  };

  return walk(0, 0);
}

/**
 * Every way this Exercise is incoherent for its Kind, or an empty array.
 *
 * All of them at once rather than the first: an Admin fixes a form, not one
 * field per attempt.
 */
export function exerciseFaults(exercise: AuthoredExercise): ExerciseFault[] {
  const faults: ExerciseFault[] = [];
  const caseSensitive = exercise.caseSensitive ?? false;

  // Held to the same standard as an answer: a value that normalises away is
  // absent, whatever the raw string looked like. The positions are kept — an
  // empty one is a gap nobody has written an answer for, which is a fault about
  // that gap rather than a shorter Exercise.
  const positions = (exercise.acceptedAnswers ?? [])
    .map((values) => values.filter((value) => !isBlank(value)));
  // Flattened where the rule asks about a *value* rather than about where it
  // sits: is it on offer, do the fragments tile it. Both of those belong to
  // Kinds with exactly one place to answer.
  const accepted = positions.flat();
  const choices = (exercise.choices ?? []).filter((value) => !isBlank(value));

  if (isBlank(exercise.prompt)) faults.push({ code: 'prompt_empty' });
  if (isBlank(exercise.referenceAnswer)) faults.push({ code: 'reference_answer_empty' });

  if (isDeterministic(exercise.kind)) {
    // Per position, not across them: an Exercise that accepts something at its
    // first gap and nothing at its second cannot be answered, and saying only
    // that it has *some* accepted answer would wave it through.
    if (positions.length === 0 || positions.some((values) => values.length === 0)) {
      faults.push({ code: 'accepted_answers_required' });
    } else {
      // How many places this Exercise asks a Student to answer. A fill-gap's
      // prompt says so and may say three; every other Kind has exactly one, and
      // a second list of accepted values on one of those is an answer nothing
      // would ever compare against.
      //
      // Skipped where there are no positions at all: `accepted_answers_required`
      // has already said that, and saying it twice is not saying it louder.
      const places = exercise.kind === 'fill_gap' ? gapCount(exercise.prompt) : 1;
      if (positions.length !== places) faults.push({ code: 'gap_count_mismatch' });
    }
  } else if (accepted.length > 0) {
    faults.push({ code: 'accepted_answers_not_allowed' });
  }

  if (offersChoices(exercise.kind)) {
    // One option is not a choice, and one fragment is not an ordering.
    if (choices.length < 2) faults.push({ code: 'choices_required' });
  } else if (choices.length > 0) {
    faults.push({ code: 'choices_not_allowed' });
  }

  // Compared the way the Deterministic Check will compare them. A rule that
  // matched more loosely would accept an Exercise the Student then failed.
  const normalisedChoices = choices.map((choice) => normaliseAnswer(choice, { caseSensitive }));
  const onOffer = (value: string) => normalisedChoices.includes(normaliseAnswer(value, { caseSensitive }));

  if (exercise.kind === 'multiple_choice' && choices.length > 0) {
    for (const answer of accepted) {
      if (!onOffer(answer)) faults.push({ code: 'accepted_answer_not_a_choice', offending: answer });
    }
    if (!isBlank(exercise.referenceAnswer) && !onOffer(exercise.referenceAnswer)) {
      faults.push({ code: 'reference_answer_not_a_choice', offending: exercise.referenceAnswer });
    }
  }

  if (exercise.kind === 'word_order' && choices.length > 0) {
    if (choices.length > MAX_FRAGMENTS) {
      faults.push({ code: 'too_many_fragments' });
    } else {
      for (const answer of accepted) {
        if (!fragmentsBuildAnswer(answer, choices, caseSensitive)) {
          faults.push({ code: 'fragments_do_not_build_answer', offending: answer });
        }
      }
    }
  }

  // Two accepted answers the Deterministic Check cannot tell apart are one
  // answer written twice. Named rather than silently deduplicated: an author who
  // meant to add a second form wrote something that has no effect.
  //
  // Within a position, never across them. Two gaps of one sentence accepting the
  // same word is ordinary — «___ have ___ dog» takes «a» at neither or at one —
  // and a rule that compared them would refuse the sentence for being consistent.
  for (const values of positions) {
    const seen = new Set<string>();
    for (const answer of values) {
      const key = normaliseAnswer(answer, { caseSensitive });
      if (seen.has(key)) faults.push({ code: 'duplicate_accepted_answers', offending: answer });
      else seen.add(key);
    }
  }

  return faults;
}
