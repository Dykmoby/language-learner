// Issue #78 — the Grader stops costing a Student a Verdict over typography.
//
// A right sentence typed with a lowercase first letter, or without its final full
// stop, was told about it — and the Coherence Guard's rule that any Error forbids
// `correct` turned that report into `partially_correct`, which then landed in the
// Student's Error Type histogram as though they had got something wrong. None of
// it is language. The Deterministic Check has always ignored all three; only the
// Grader nitpicked them.
//
// Two mechanisms, because one is a request and the other is a guarantee:
//
//   - The prompt asks for case, terminal punctuation and whitespace under
//     `typography`, and that type is dropped here before anything downstream —
//     the Guard, the stored row, the histogram — ever sees it.
//   - When the model does not comply, the backstop settles it on a fact rather
//     than on the model's prose: if the Student's answer and the corrected form
//     are the same string once the typography is normalised away, the only
//     difference between them IS typography, so the Grader's `punctuation` and
//     `capitalization` reports are about nothing else and go too.
//
// A missing comma is not typography and must survive. It survives because it is
// a real difference between the two strings, which is why the backstop is written
// as a comparison and not as a reading of the Grader's Russian.
//
// Where the backstop is knowingly blunt
//
// If the first word of the sentence is the only difference, the backstop cannot
// tell «i have a cat» (a typing convention) from «london is the capital» (a fact
// about the word): both differ from the correction by one leading capital and
// nothing else. It clears the Error in both cases, so a proper noun that opens a
// sentence loses its `capitalization` report when the sentence is otherwise
// perfect. That is the deliberate side of #78's two acceptance criteria, which
// cannot both hold for that one case — the ticket wants a lowercase sentence
// marked `correct` even when the Grader ignores the instruction and calls it
// `capitalization`, and that is exactly what this case looks like.
//
// The first mechanism is what covers it: a complying Grader files a sentence's
// opening capital under `typography` and a proper noun under `capitalization`,
// and only the first is dropped unconditionally. Mid-sentence, the backstop keeps
// the distinction on its own.

import { TYPOGRAPHY_ERROR_TYPE, type GraderError } from './contract.ts';

// The types the backstop clears once it has established that nothing but
// typography separates the two forms. `typography` itself goes unconditionally;
// these two only go when there is demonstrably nothing else they could be about.
const NITPICKS = new Set([TYPOGRAPHY_ERROR_TYPE, 'punctuation', 'capitalization']);

// The Deterministic Check's normalisation with its case fold narrowed, and the
// narrowing is the whole of the difference between the two acceptance criteria
// this has to satisfy at once:
//
//   - a right sentence typed in lower case is `correct` with no Errors
//   - `london` written for `London` still reports `capitalization`, wherever the
//     word sits other than first (see the note below for why "other than first")
//
// A blanket case fold cannot tell those apart — both differ from the correction
// by nothing but case — so it would have to drop the proper noun's Error too.
// What makes the first typography and the second language is *where* the capital
// is: the first letter of a sentence is a typing convention, and a capital
// anywhere else is a fact about the word. So only sentence-initial case is
// folded, and `London` is left as a real difference between the two strings.
//
// The trailing `.!?` and the whitespace collapse are the Deterministic Check's
// unchanged. A full stop *between* two sentences is not stripped: a Student who
// ran two sentences together made a punctuation mistake, not a typing one.
function foldTypography(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trimEnd()
    .replace(/(^|[.!?]\s+)(\p{L})/gu, (_match, lead: string, letter: string) => lead + letter.toLowerCase());
}

export type TypographyOutcome = {
  errors: GraderError[];
  /** True when the server removed something the Grader reported. */
  dropped: boolean;
};

/**
 * The Errors worth keeping, and whether anything was taken away.
 *
 * The backstop needs the Grader to have actually corrected something. `corrected`
 * is documented to the model as "the student's answer if already correct", so
 * echoing the answer verbatim is a known habit — and an echo would make the fold
 * comparison trivially true and clear a real `punctuation` Error with no evidence
 * at all. A byte-identical `corrected` is the Grader declining to correct, not
 * the Grader saying the difference is typographic.
 */
export function withoutTypography(
  errors: readonly GraderError[],
  answer: string,
  corrected: string,
): TypographyOutcome {
  const onlyTypography = answer !== corrected && foldTypography(answer) === foldTypography(corrected);

  const kept = errors.filter((error) =>
    onlyTypography ? !NITPICKS.has(error.type) : error.type !== TYPOGRAPHY_ERROR_TYPE);

  return { errors: kept, dropped: kept.length !== errors.length };
}
