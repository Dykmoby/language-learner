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
  /** An imported file's faults also say which Lesson or Test of the file they are about. */
  lessonPosition?: number;
  testPosition?: number;
  offending?: string;
};

// «Урок 2: Упражнение 3: …» — outer first, because that is the order somebody
// looks for it in the file.
function where(fault: ReadableFault): string {
  return [
    fault.lessonPosition === undefined ? null : ru.transfer.faultInLesson(fault.lessonPosition),
    fault.testPosition === undefined ? null : ru.transfer.faultInTest(fault.testPosition),
    fault.exercisePosition === undefined ? null : ru.draft.faultAt(fault.exercisePosition),
  ].filter((part) => part !== null).join(' ');
}

export function FaultList({ faults }: { faults: readonly ReadableFault[] }) {
  if (faults.length === 0) return null;

  return (
    <ul className="cards">
      {faults.map((fault, index) => {
        const prefix = where(fault);
        return (
          <li key={`${fault.code}-${index}`} className="error">
            {prefix === '' ? null : `${prefix} `}
            {faultMessage(fault.code)}
            {fault.offending === undefined ? null : ` — ${fault.offending}`}
          </li>
        );
      })}
    </ul>
  );
}
