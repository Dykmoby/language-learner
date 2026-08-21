// A failed authoring call, as the editor reads it.
//
// Shared by Generation and Refinement because they fail identically and must be
// reported identically: every arm says the same thing about the Draft — it did
// not change. A call that half-succeeded would be the one outcome an Admin cannot
// act on, so there is no such arm.

import type { DocumentFault } from '../content/lesson-document.ts';
import type { AuthoringFailure } from './call.ts';
import type { AuthoringResultFrame } from './wire.ts';

export function refusalFrame(failure: AuthoringFailure): AuthoringResultFrame {
  if (failure.kind === 'call') {
    // The kind, not the model's error text. ADR 0001 records that the text
    // points at the wrong thing, and an Admin reading «403» would go and check
    // credentials that are fine.
    return { t: 'result', ok: false, reason: 'call_failed', faults: [], detail: failure.call.kind };
  }

  if (failure.kind === 'refusal') {
    return {
      t: 'result', ok: false, reason: 'not_a_lesson', detail: null,
      // The Author's refusal codes travel as document faults so the editor has
      // one list to render rather than two — they are resolved to Russian by the
      // same dictionary lookup either way.
      faults: [{
        code: failure.refusal.code as DocumentFault['code'],
        ...(failure.refusal.offending === undefined ? {} : { offending: failure.refusal.offending }),
      }],
    };
  }

  return { t: 'result', ok: false, reason: 'invalid', faults: failure.faults, detail: null };
}
