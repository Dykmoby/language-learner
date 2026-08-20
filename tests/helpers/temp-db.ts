// Every test runs against a throwaway database file, migrated and seeded through
// the same modules the application uses — never through hand-written SQL that
// could drift from what production actually does.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDatabasePath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'language-learner-test-'));
  return {
    path: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
