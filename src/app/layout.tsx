import type { ReactNode } from 'react';
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core';
import '@mantine/core/styles.css';
import { ru } from '../ru.ts';
import { currentStudent } from '../auth/current-student.ts';
import { AppNav } from './app-nav.tsx';
import { Providers } from './providers.tsx';
import './fonts.css';
import './tokens.css';
import './globals.css';

export const metadata = {
  title: ru.appName,
};

/**
 * The sans faces every screen needs before it can paint a word.
 *
 * `font-display: block` is what keeps the fallback from being shown and then
 * replaced; preloading is what keeps the block from being noticeable. All three
 * scripts are here because all three are chrome: the interface is Russian, a
 * Course title is English or Tajik, and a Lesson sets both in the same
 * paragraph. The mono faces are deliberately absent — they carry the error span
 * and Theory code blocks, neither of which is on a first paint.
 */
const PRELOADED_FACES = [
  '/fonts/ibm-plex-sans-cyrillic.woff2',
  '/fonts/ibm-plex-sans-cyrillic-ext.woff2',
  '/fonts/ibm-plex-sans-latin.woff2',
];

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Read once here rather than inside the navigation column, because the shell
  // needs the same answer: a screen with no session is not a screen with an
  // empty column beside it, it is a screen with no column.
  const student = await currentStudent();

  return (
    <html lang="ru" {...mantineHtmlProps}>
      <head>
        {/* Mantine's own stylesheet is imported above and its variables are
            resolved onto the token layer in `theme.ts`. This script settles the
            colour scheme before the first paint so a dark screen does not flash
            white on the way in. */}
        <ColorSchemeScript defaultColorScheme="auto" />
        {PRELOADED_FACES.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        <Providers>
          <div className="appShell">
            {/* Every signed-in screen, Student and Admin alike. The sign-in and
                password screens get no column for free: there is no session, so
                there is nothing to show and nowhere to go. */}
            {student === null ? null : <AppNav student={student} />}
            <div className={student === null ? 'appWork unframed' : 'appWork'}>
              {children}
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
