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
//   - `london` written for `London` still reports `capitalization`
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

/** The Errors worth keeping. */
export function withoutTypography(
  errors: readonly GraderError[],
  answer: string,
  corrected: string,
): GraderError[] {
  const onlyTypography = foldTypography(answer) === foldTypography(corrected);

  return errors.filter((error) =>
    onlyTypography ? !NITPICKS.has(error.type) : error.type !== TYPOGRAPHY_ERROR_TYPE);
}
