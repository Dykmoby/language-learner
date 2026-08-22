'use client';

// The Theory as it is being written.
//
// Deliberately its own panel, and deliberately plain text. What is arriving is
// not a Lesson yet — it is a Lesson being written — and putting it in the editor
// would be exactly the "half a Lesson" the failure rules exist to prevent. An
// Admin must never be left unsure whether what they are reading came from Claude
// or was already on the screen, and two panels is how that is answered.

import { ru } from '../../../../ru.ts';

export function StreamedTheory({ theory }: { theory: string }) {
  if (theory === '') return null;

  return (
    <>
      <h3>{ru.generation.theoryArriving}</h3>
      <pre className="streaming">{theory}</pre>
    </>
  );
}
