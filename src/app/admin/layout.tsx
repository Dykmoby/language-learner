// The Admin section is denser than everything else in this application, and the
// measure is where that shows first.
//
// A Student's screen shows one Exercise; an Admin's shows a Lesson's worth of
// Exercise forms, each with its own Kind, its options, its Reference Answer and
// the answers it has come to accept. Restraint here is making that legible
// rather than making it sparse — the reading measure a Theory is set in
// suffocates a table of controls.
//
// It is a layout rather than a class on each `main` because that is the whole
// point: a screen added to this section is wide because of where it is, not
// because its author remembered.

import type { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="adminSection">{children}</div>;
}
