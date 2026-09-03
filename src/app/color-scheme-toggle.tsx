'use client';

// The theme, as something a person decides rather than something their machine
// decides for them.
//
// Three states rather than two, because «как в системе» is a state: a Student
// who has picked light has to be able to hand the decision back, and a two-way
// switch has nowhere to hand it. Mantine stores the choice in `localStorage` and
// writes the resolved scheme onto <html> as `data-mantine-color-scheme`, which
// is the one attribute the token layer and Mantine's own dark rules both read —
// see the Dark block in `tokens.css`.
//
// It is the only client component in the navigation column. The column itself is
// server-rendered because it reads a session and a Course outline; this is a
// browser control over a browser preference, so it is the piece that crosses.

import { useEffect, useState } from 'react';
import { useMantineColorScheme, type MantineColorScheme } from '@mantine/core';
import type { ReactNode } from 'react';
import { ru } from '../ru.ts';

/* Drawn on the same grid and at the same weight as the column's other icons —
   see the note above them in `app-nav.tsx`. They are repeated here rather than
   imported because that file is server-rendered and pulls in the database. */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const SystemIcon = <Icon><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></Icon>;
const SunIcon = <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></Icon>;
const MoonIcon = <Icon><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Icon>;

const CHOICES: { value: MantineColorScheme; label: string; icon: ReactNode }[] = [
  { value: 'auto', label: ru.chrome.themeAuto, icon: SystemIcon },
  { value: 'light', label: ru.chrome.themeLight, icon: SunIcon },
  { value: 'dark', label: ru.chrome.themeDark, icon: MoonIcon },
];

export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  // Which choice is stored is a fact only the browser holds, so the server
  // cannot render it and the first client render must not either — it would be
  // a hydration mismatch on every reload where the stored choice is not the
  // default. Nothing is marked as chosen until the component is mounted, at
  // which point the real answer is one paint away.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="schemeToggle" role="group" aria-label={ru.chrome.theme}>
      {CHOICES.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          className="secondary"
          // The pressed one is the choice, not the theme it resolves to: on
          // «как в системе» this control says the machine is deciding, which is
          // a different fact from "it is dark right now".
          aria-pressed={mounted && colorScheme === value}
          aria-label={label}
          title={label}
          onClick={() => setColorScheme(value)}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
