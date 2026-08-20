// Applies checked-in migrations. Deliberately does not seed: creating the
// schema and creating accounts are separate concerns, and only one of them
// should ever run unattended.

import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { openDatabase, type DatabaseHandle } from './client.ts';
import { config } from '../config.ts';

// Not `new URL('../../drizzle', import.meta.url)`: the bundler reads that as a
// static asset reference and tries to resolve the folder as a module. The
// service runs with WorkingDirectory set to the repo, and tests run from it.
const MIGRATIONS_FOLDER = process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'drizzle');

export function runMigrations(handle: DatabaseHandle): void {
  migrate(handle.db, { migrationsFolder: MIGRATIONS_FOLDER });
}

// CLI: node src/db/migrate.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handle = openDatabase(config.databasePath);
  try {
    runMigrations(handle);
    console.log(`migrations applied to ${config.databasePath}`);
  } finally {
    handle.close();
  }
}
