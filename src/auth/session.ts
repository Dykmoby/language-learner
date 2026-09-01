// Server-side sessions. A random opaque id in the cookie, the Student and an
// expiry in SQLite. Sign-out deletes the row — the thing a stateless token
// cannot do (issue #1 § Authentication).

import { randomBytes } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { sessions, students, type StudentRow } from '../db/schema.ts';

type Db = BetterSQLite3Database<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;

// 32 bytes of CSPRNG output. Opaque: it encodes nothing about the Student, so a
// session id can neither be guessed nor read.
function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

export function createSession(db: Db, studentId: number, ttlDays: number): { id: string; expiresAt: Date } {
  const now = Date.now();
  const expiresAt = new Date(now + ttlDays * DAY_MS);
  const id = newSessionId();
  db.insert(sessions).values({ id, studentId, expiresAt, createdAt: new Date(now) }).run();
  return { id, expiresAt };
}

// Returns the Student the session belongs to, or null. An expired row is treated
// as absent and swept, so an old cookie can never authenticate.
export function findSessionStudent(db: Db, sessionId: string): StudentRow | null {
  const row = db
    .select({ student: students })
    .from(sessions)
    .innerJoin(students, eq(students.id, sessions.studentId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .get();
  return row?.student ?? null;
}

export function deleteSession(db: Db, sessionId: string): void {
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

// Called on sign-in: an account signing in is a good moment to drop the rows
// nobody can use any more.
export function deleteExpiredSessions(db: Db): void {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
}

/**
 * Every session of this Student except the one asking. Called when the password
 * changes.
 *
 * A password is changed for two reasons and this is right for both. Replacing a
 * Temporary Password ends the window in which somebody else knew it, and a
 * window that ends everywhere except on a device already signed in has not
 * ended. Changing a password because it may be known to someone is the same
 * thing said in a hurry — and the row is the only thing that revokes a session
 * here, which is the whole reason sessions are rows rather than tokens.
 *
 * The caller's own session is kept: signing a Student out of the screen they are
 * standing in front of, as the reward for doing the right thing, would teach
 * them not to.
 */
export function deleteOtherSessions(db: Db, studentId: number, keepSessionId: string): void {
  db.delete(sessions)
    .where(and(eq(sessions.studentId, studentId), ne(sessions.id, keepSessionId)))
    .run();
}
