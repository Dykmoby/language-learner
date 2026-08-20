import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

export type DatabaseHandle = {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close: () => void;
};

export function openDatabase(path: string): DatabaseHandle {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);

  // WAL so a Student reading a Lesson is never blocked behind a write on a
  // single-disk Pi (design.md § Operations).
  sqlite.pragma('journal_mode = WAL');
  // The Exercise Set ownership XOR is enforced by the database, and a check
  // constraint is worth nothing if foreign keys are off.
  sqlite.pragma('foreign_keys = ON');
  // Wait rather than fail if a write is in flight.
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, close: () => sqlite.close() };
}
