'use client';

// A list of faults an Admin can read.
//
// The same rendering everywhere a fault is reported — a Draft saved, a Lesson
// published, a Generation, a Refinement, a Test — because a fault code means the
// same thing whichever act produced it, and the Russian for it comes from the
// same dictionary lookup.

import { ru, faultMessage } from '../../../ru.ts';

/**
 * Anything the validity rules report — a Lesson document's faults or a Test's.
 * Structural rather than one of those two unions, because this component's whole
 * point is that a fault code means the same thing whichever act produced it.
 */
export type ReadableFault = {
  code: string;
  exercisePosition?: number;
  offending?: string;
};

export function FaultList({ faults }: { faults: readonly ReadableFault[] }) {
  if (faults.length === 0) return null;

  return (
    <ul className="cards">
      {faults.map((fault, index) => (
        <li key={`${fault.code}-${index}`} className="error">
          {fault.exercisePosition === undefined ? null : `${ru.draft.faultAt(fault.exercisePosition)} `}
          {faultMessage(fault.code)}
          {fault.offending === undefined ? null : ` — ${fault.offending}`}
        </li>
      ))}
    </ul>
  );
}
