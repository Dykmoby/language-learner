import type { ReactNode } from 'react';
import { ru } from '../ru.ts';
import './tokens.css';
import './globals.css';

export const metadata = {
  title: ru.appName,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
