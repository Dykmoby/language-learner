// How the first accounts come into existence, and the only thing that grants the
// Admin role.
//
// It is no longer the only way an account is ever made: an Admin creates further
// Students from the Admin section, and `src/auth/accounts.ts` is what does it.
// What has not changed is that nobody makes an account for themselves — there is
// still no registration route — and that the Admin role is granted here, on the
// box, and nowhere else. An account made through the web is always a Student.

import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { students } from './schema.ts';
import type * as schema from './schema.ts';
import { openDatabase } from './client.ts';
import { runMigrations } from './migrate.ts';
import { hashPasswordSync } from '../auth/password.ts';
import { config } from '../config.ts';

export type SeedAccount = { username: string; password: string; isAdmin: boolean };
export type SeedAction = 'created' | 'skipped' | 'reseeded';
export type SeedResult = { username: string; action: SeedAction };

// `igor` holds the Admin role (design.md § Security). Both names are overridable
// so the script is not the place a person's name is hard-coded.
export const DEFAULT_ACCOUNTS: ReadonlyArray<Omit<SeedAccount, 'password'>> = [
  { username: process.env.SEED_ADMIN_USERNAME || 'igor', isAdmin: true },
  { username: process.env.SEED_STUDENT_USERNAME || 'student', isAdmin: false },
];

export function seedStudents(
  db: BetterSQLite3Database<typeof schema>,
  accounts: ReadonlyArray<SeedAccount>,
  options: { force?: boolean } = {},
): SeedResult[] {
  return accounts.map(({ username, password, isAdmin }) => {
    const existing = db.select().from(students).where(eq(students.username, username)).get();

    if (existing && !options.force) {
      // Setting the Pi up twice must not silently reset a password.
      return { username, action: 'skipped' };
    }

    const passwordHash = hashPasswordSync(password);

    if (existing) {
      db.update(students).set({ passwordHash, isAdmin }).where(eq(students.id, existing.id)).run();
      return { username, action: 'reseeded' };
    }

    db.insert(students).values({ username, passwordHash, isAdmin, createdAt: new Date() }).run();
    return { username, action: 'created' };
  });
}

// CLI: node src/db/seed.ts [--force]
//
// Passwords come from the environment rather than argv, because argv is visible
// in `ps` to every user on the box.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--force');

  const passwords = [process.env.SEED_ADMIN_PASSWORD, process.env.SEED_STUDENT_PASSWORD];
  const missing = DEFAULT_ACCOUNTS
    .map((a, i) => (passwords[i] ? '' : a.isAdmin ? 'SEED_ADMIN_PASSWORD' : 'SEED_STUDENT_PASSWORD'))
    .filter((name) => name !== '');

  if (missing.length > 0) {
    console.error(`missing required environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  const handle = openDatabase(config.databasePath);
  try {
    runMigrations(handle);
    const results = seedStudents(
      handle.db,
      DEFAULT_ACCOUNTS.map((a, i) => ({ ...a, password: passwords[i]! })),
      { force },
    );
    for (const { username, action } of results) {
      const note = action === 'skipped' ? ' (already exists — pass --force to overwrite)' : '';
      console.log(`${username}: ${action}${note}`);
    }
  } finally {
    handle.close();
  }
}
