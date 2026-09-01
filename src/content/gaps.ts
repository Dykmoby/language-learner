// The gap: a place in a fill-gap Exercise's prompt where a Student writes an
// answer — CONTEXT.md § Gap.
//
// It is written `___` in the prompt, and that token is the whole of the
// notation. A fill-gap Exercise used to have exactly one place to answer
// whatever its prompt said, so the token was a private constant of the component
// that rendered it; a second `___` was printed as literal text beside the one
// input. Now the prompt decides how many inputs there are, how many lists of
// accepted answers the Exercise must hold, and how a Student's answer is put
// back into the sentence — three questions in three modules that have to agree
// about where the gaps are, exactly.
//
// So they all ask here, and they all ask the *same* function: `pieces` is the
// one split, and both the count and the fill are derived from it. A renderer
// that split the prompt its own way would eventually render a number of inputs
// the validity rules did not count.
//
// Pure by construction — no imports at all, like the normalisation it sits
// beside, and asserted by a test rather than left to convention.

/** Where a fill-gap Exercise wants an input. */
export const GAP = '___';

/**
 * The prompt's text around its gaps: N gaps give N + 1 pieces, any of which may
 * be empty where a gap opens or closes the sentence.
 *
 * A plain split, deliberately. A run of four underscores is one gap followed by
 * a literal underscore, and that is what a Student sees rendered, because the
 * renderer is handed these same pieces rather than a rule of its own.
 */
export function pieces(prompt: string): string[] {
  return prompt.split(GAP);
}

/** How many places this prompt asks a Student to write in. */
export function gapCount(prompt: string): number {
  return pieces(prompt).length - 1;
}

/**
 * The prompt with each gap replaced by what was written in it.
 *
 * This is what "the answer" means for a fill-gap wherever one is shown to a
 * person: the values alone are storage, and a Student reading «кошка, стол»
 * cannot tell what they answered. A gap with nothing in it keeps its `___`,
 * because an unanswered gap is a hole in the sentence rather than a missing
 * word — and a sentence silently closed over one would read as an answer
 * somebody gave.
 */
export function fillGaps(prompt: string, values: readonly string[]): string {
  const parts = pieces(prompt);
  return parts
    .map((part, index) => {
      if (index === parts.length - 1) return part;
      const value = (values[index] ?? '').trim();
      return part + (value === '' ? GAP : value);
    })
    .join('');
}
