// Reads the session cookie and resolves the Student behind it. The one place
// that turns a request into an identity.

import { cookies } from 'next/headers';
import { getDatabase } from '../db/index.ts';
import { findSessionStudent } from './session.ts';
import { config } from '../config.ts';
import type { StudentRow } from '../db/schema.ts';

export async function currentStudent(): Promise<StudentRow | null> {
  const jar = await cookies();
  const sessionId = jar.get(config.session.cookieName)?.value;
  if (!sessionId) return null;
  return findSessionStudent(getDatabase().db, sessionId);
}
