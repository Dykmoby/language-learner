import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../db/index.ts';
import { students } from '../../../db/schema.ts';
import { verifyPassword } from '../../../auth/password.ts';
import { createSession, deleteExpiredSessions } from '../../../auth/session.ts';
import { checkThrottle, recordFailure, recordSuccess } from '../../../auth/throttle.ts';
import { config } from '../../../config.ts';

function redirect(request: Request, path: string): NextResponse {
  // 303 so the browser follows with GET rather than re-posting the credentials.
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');

  const { db } = getDatabase();

  // Checked before the password is even looked at, and checked for usernames
  // that do not exist too — otherwise the throttle would answer the question the
  // login form refuses to.
  const decision = checkThrottle(db, username);
  if (!decision.allowed) {
    return decision.kind === 'locked'
      ? redirect(request, `/login?error=locked&minutes=${Math.ceil(decision.secondsRemaining / 60)}`)
      : redirect(request, `/login?error=slow&seconds=${decision.secondsRemaining}`);
  }

  const student = db.select().from(students).where(eq(students.username, username)).get();

  // An unknown username and a wrong password must be indistinguishable to the
  // caller, so the same message comes back either way.
  const ok = student ? await verifyPassword(student.passwordHash, password) : false;

  if (!ok || !student) {
    const failure = recordFailure(db, username);
    if (failure.lockedUntil) {
      // The failure that locks says so itself. Answering "wrong password" here
      // would leave the Student to discover the lockout on their next attempt.
      const seconds = Math.max(1, Math.ceil((failure.lockedUntil.getTime() - Date.now()) / 1000));
      return redirect(request, `/login?error=locked&minutes=${Math.ceil(seconds / 60)}`);
    }
    return redirect(request, '/login?error=invalid');
  }

  recordSuccess(db, username);
  deleteExpiredSessions(db);
  const session = createSession(db, student.id, config.session.ttlDays);

  const response = redirect(request, '/');
  response.cookies.set({
    name: config.session.cookieName,
    value: session.id,
    httpOnly: true,           // page scripts cannot read it
    secure: config.session.secureCookie,
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt, // survives closing the browser
  });
  return response;
}
