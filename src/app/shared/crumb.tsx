// The way back up, drawn as a control.
//
// It used to be a line of underlined text above the title, and on the authoring
// screens it was the last thing that still looked like a link while everything
// beside it had become a button. A person reading a screen should be able to
// tell what is prose and what is a target without trying one.
//
// It keeps the name of the thing it goes back to rather than saying «Назад»:
// what sits above a Lesson is one particular Course, and saying which one is the
// whole value of the line. The arrow says which direction; the words say where.

import type { ReactNode } from 'react';

export function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="crumb">
      <a className="button secondary small" href={href}>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M15 19l-7-7 7-7" />
        </svg>
        {children}
      </a>
    </p>
  );
}
