'use client';

// The one client boundary the shell needs.
//
// Mantine's provider writes the theme's variables into the document and reads
// the colour scheme, both of which are browser work. It is kept to this file so
// that every screen behind it stays whatever it already was: the Practice is a
// client component because it streams a Verdict, and the sign-in screen is a
// server-rendered form because it must work with no bundle at all. Neither
// changes because a provider is above it.

import type { ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { theme, cssVariablesResolver } from './theme.ts';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      // The setting an account starts on, not the only one it can hold: the
      // control beside the account in the navigation column stores light, dark
      // or `auto`, and `auto` is what applies until one is stored. Mantine
      // resolves whichever it is onto `data-mantine-color-scheme`, which is the
      // single thing the token layer reads — see the Dark block in `tokens.css`.
      defaultColorScheme="auto"
    >
      {children}
    </MantineProvider>
  );
}
