// The application's single connection. Opened once, migrated once.
//
// Tests never touch this — each opens its own temporary file through
// openDatabase, so nothing leaks between them.

import { openDatabase, type DatabaseHandle } from './client.ts';
import { runMigrations } from './migrate.ts';
import { config } from '../config.ts';

let shared: DatabaseHandle | null = null;

export function getDatabase(): DatabaseHandle {
  if (!shared) {
    shared = openDatabase(config.databasePath);
    // Applying migrations at boot keeps the running service and its schema from
    // ever disagreeing. It is still the migration runner doing it, and it still
    // does not seed — creating accounts stays a deliberate command.
    runMigrations(shared);
  }
  return shared;
}
