// Judgement in code, with no Grader involved — CONTEXT.md § Deterministic Check.
//
// Fill-gap, multiple choice and word order are all settled here: an Exercise
// stores an array of accepted answers, the Student's answer is normalised the
// same way they are, and a match is a match. Word order needs no separate
// comparison — collapsing whitespace is what turns a string comparison into a
// sequence comparison, and each accepted order is simply another accepted answer.
//
// Pure by construction: no I/O, no database, no knowledge of Submissions. That is
// what makes every step of the pipeline and every interaction between steps a
// table test, and it is asserted by a test rather than left to convention.

export type DeterministicOutcome = {
  correct: boolean;
  /**
   * The accepted answer that matched, in its authored form rather than its
   * normalised one — a Submission records what the Student was judged against.
   */
  matched: string | null;
};

export type GapsOutcome = {
  /** One judgement per place the Exercise asks a Student to answer, in reading order. */
  gaps: DeterministicOutcome[];
  /** Every gap accepted. */
  correct: boolean;
  /** Some accepted and some not — never true where `correct` is. */
  partial: boolean;
};

export type NormalisationOptions = {
  /**
   * Set on the Exercise where capitalisation is the point — "put the word in the
   * correct form". It skips the case fold and nothing else.
   */
  caseSensitive: boolean;
};

// design.md § Deterministic Check normalisation. The order is part of the
// specification, not an implementation detail:
//
//   trim → collapse internal whitespace → case-insensitive → strip trailing .!? → ё → е
//
// The final trim inside the punctuation step is the one refinement: stripping a
// trailing full stop uncovers the space that sat before it, and failing an answer
// over that space would be marking typography rather than language.
export function normaliseAnswer(raw: string, options: NormalisationOptions): string {
  let value = raw.trim();
  value = value.replace(/\s+/g, ' ');
  if (!options.caseSensitive) value = value.toLowerCase();
  value = value.replace(/[.!?]+$/, '').trimEnd();
  // After the case fold, so the capital Ё is only reachable under caseSensitive.
  value = value.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  return value;
}

// No typo tolerance, anywhere. In a language-learning application, tolerating a
// misspelling teaches the misspelling — a decision, not an omission, and a
// fuzzy-match library is not a helpful contribution here.
export function deterministicCheck(
  answer: string,
  accepted: readonly string[],
  options: Partial<NormalisationOptions> = {},
): DeterministicOutcome {
  const settings: NormalisationOptions = { caseSensitive: options.caseSensitive ?? false };
  const normalisedAnswer = normaliseAnswer(answer, settings);

  // An empty answer is never correct, even against an Exercise whose accepted
  // list somehow holds an empty string: submitting nothing is not answering.
  if (normalisedAnswer === '') return { correct: false, matched: null };

  const matched = accepted.find((candidate) => normaliseAnswer(candidate, settings) === normalisedAnswer);
  return { correct: matched !== undefined, matched: matched ?? null };
}

/**
 * The same comparison at every gap of one Exercise.
 *
 * An Exercise has one list of accepted values per place a Student answers, so
 * this walks *those* rather than what the Student sent: a gap left empty, or one
 * the browser never sent a value for at all, is a gap that was not answered, and
 * an answer short of the prompt is not a shorter Exercise.
 *
 * Three gaps are three facts being checked. Reporting only whether all of them
 * held would make the next attempt a re-guess of all three, so each gap's own
 * outcome comes back — and `partial` is what says the Verdict is neither of the
 * two this path used to have.
 *
 * The accepted lists are taken structurally rather than as `AcceptedAnswers`,
 * because naming that type here would be an import, and this module has none.
 */
export function checkGaps(
  answers: readonly string[],
  accepted: readonly (readonly string[])[],
  options: Partial<NormalisationOptions> = {},
): GapsOutcome {
  const gaps = accepted.map((values, at) => deterministicCheck(answers[at] ?? '', values, options));
  const right = gaps.filter((gap) => gap.correct).length;

  return {
    gaps,
    // An Exercise with nowhere to answer is not correct by vacuity. Nothing can
    // author one — the validity rules refuse it by name — and this is what stops
    // one that got in some other way from marking every answer right.
    correct: gaps.length > 0 && right === gaps.length,
    partial: right > 0 && right < gaps.length,
  };
}
