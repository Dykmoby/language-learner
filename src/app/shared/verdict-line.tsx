// One line that names a state, drawn the same way wherever a state is named.
//
// `verdict-state.ts` gave the six states one vocabulary and `globals.css` gave
// them one appearance, and then three screens each assembled the same paragraph
// out of them by hand — the Practice, the Test review and the Dispute form. That
// is the shape of the problem this system was built to end, in a new place: the
// pieces agreed, the assembly did not have to.
//
// `detail` is for a state that has more to say than its name — the retry message
// after a failed grading, or what an objection has and has not unblocked. It is
// set in the body colour rather than the state's, because a paragraph of coloured
// text is harder to read than a paragraph of text.

import type { ReactNode } from 'react';
import { stateClass, stateWords, type VerdictState } from './verdict-state.ts';

export function VerdictLine({
  state, words, detail, role = 'status',
}: {
  state: VerdictState;
  /**
   * What this screen calls the state, where it calls it something of its own.
   * The Practice congratulates a step — "Верно!" — where the canonical label
   * merely records one. Left out, the canonical label is used.
   */
  words?: string;
  detail?: ReactNode;
  /** `alert` where the line reports something that went wrong unasked. */
  role?: 'status' | 'alert';
}) {
  return (
    <p className={`verdict ${stateClass(state)}`} role={role}>
      {words ?? stateWords(state)}
      {detail === undefined ? null : <span className="detail">{detail}</span>}
    </p>
  );
}
