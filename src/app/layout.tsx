import type { ReactNode } from 'react';
import { ru } from '../ru.ts';
import { AppHeader } from './app-header.tsx';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {PRELOADED_FACES.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        {/* Every signed-in screen, Student and Admin alike. It renders nothing
            for a request with no session, which is what keeps it off the
            sign-in screen without the sign-in screen having to know. */}
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
