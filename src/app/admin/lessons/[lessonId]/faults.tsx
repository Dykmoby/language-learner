'use client';

// A list of faults an Admin can read.
//
// The same rendering everywhere a fault is reported — a save, a publish, a
// Generation, a Refinement — because a fault code means the same thing whichever
// act produced it, and the Russian for it comes from the same dictionary lookup.

import { ru, faultMessage } from '../../../../ru.ts';
import type { DocumentFault } from '../../../../content/lesson-document.ts';

export function FaultList({ faults }: { faults: readonly DocumentFault[] }) {
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
