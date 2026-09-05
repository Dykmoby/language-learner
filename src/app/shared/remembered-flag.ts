'use client';

// A yes-or-no the browser remembers, and nothing else does.
//
// Both «скрыть пройденное» toggles on the Course screen are this: a preference
// about one reader's own view of one list, which no other Student shares and no
// screen derives anything from. Storing it on the Student would put a column in
// the database, a migration behind it and a round trip in front of it, for a
// fact that stops being interesting the moment the tab closes.
//
// It starts false on every render and is read back in an effect rather than
// during the first one, because the server rendered this list with nothing
// hidden: reading storage while rendering would make the browser's first paint
// disagree with the HTML it was sent. The cost is that a hidden row flashes into
// view for a frame; the alternative is a hydration mismatch on every visit.
//
// Storage can throw rather than merely be empty — a private window, a browser
// set to block site data — so every access is guarded and the answer on the way
// out is the same one an empty store gives.

import { useCallback, useEffect, useState } from 'react';

export function useRememberedFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(false);

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(key) === 'true');
    } catch {
      // No storage to read. The default is what the server already rendered.
    }
  }, [key]);

  const remember = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, String(next));
    } catch {
      // The toggle still works for this visit; it is only the memory that is gone.
    }
  }, [key]);

  return [value, remember];
}
