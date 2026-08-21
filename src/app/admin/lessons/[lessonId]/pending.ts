'use client';

// The one thing on the Draft editor waiting to be confirmed.
//
// One at a time across the whole form, whichever it is. A confirmation the
// author has forgotten about is a confirmation that confirms nothing, and two of
// them at once is two things they have half-decided. Asking for any while one is
// pending replaces it.
//
// It lives at the top of the form rather than inside the control that raises it
// for exactly that reason: three components each holding their own «вы уверены?»
// is three confirmations that can all be open together.

import type { ExerciseKind } from '../../../../content/exercise-validity.ts';

export type Pending =
  /** Removing an Exercise that has Submissions against it. */
  | { what: 'remove'; index: number }
  /** Changing a Kind in a way that would discard fields already filled in. */
  | { what: 'kind'; index: number; kind: ExerciseKind }
  /**
   * Publishing a Draft descended from Claude's output, where Exercises still
   * carry a Reference Answer nobody has looked at. Not indexed by an Exercise:
   * it is about the Draft as a whole.
   */
  | { what: 'publish'; unreviewed: number };
