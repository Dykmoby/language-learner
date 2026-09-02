// What the two Course endpoints read out of a request body.
//
// Beside them rather than inside either, because they read the same shape: the
// New Course form posts it and the settings screen patches it, and a Course that
// could be created with a value the settings screen refuses — or the other way
// round — is exactly the drift a second copy produces.
//
// Every reader here answers three questions rather than two, and the third is
// the one worth naming: a field can be **absent**, which is not the same as being
// present and empty. Absent means the caller said nothing about it; the
// authoring rules decide what that means, and they decide it differently for a
// Course coming into being than for one being edited.

import { isEffort, type Effort } from '../../../../claude/effort.ts';

/** A field that must be text where it is present at all. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The Effort a body asks for — issue #76.
 *
 * Four answers, and all four are real. An `Effort` is a choice; `null` is the
 * choice of «По умолчанию», where the parameter is not sent to the model at all;
 * `undefined` is the key being absent. `false` is "that is not an Effort", and
 * it has to be a fourth value rather than `null` because `null` is taken.
 */
export function asEffort(value: unknown): Effort | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return isEffort(value) ? value : false;
}

/**
 * A text field that may be left out altogether — the Grader model and a Course's
 * own instruction, on an update.
 *
 * The empty string is never the failure. It is a real value on both of them: on
 * the model it means "take the Language's default", and on the instruction it
 * means "this Course has nothing of its own to say". So only a non-string is
 * malformed, and absence is reported as absence.
 */
export function asOptionalString(value: unknown): string | null | undefined {
  return value === undefined ? undefined : asString(value);
}
