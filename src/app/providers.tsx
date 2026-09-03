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
      // `auto` and nothing else. The token layer answers the same question with
      // a `prefers-color-scheme` block, and a manual switch would be a second
      // opinion about which theme is on.
      defaultColorScheme="auto"
    >
      {children}
    </MantineProvider>
  );
}
