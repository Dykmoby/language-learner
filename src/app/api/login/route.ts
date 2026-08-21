import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../../../db/index.ts';
import { students } from '../../../db/schema.ts';
import { verifyPassword } from '../../../auth/password.ts';
import { createSession, deleteExpiredSessions } from '../../../auth/session.ts';
import { checkThrottle, recordFailure, recordSuccess } from '../../../auth/throttle.ts';
import { config } from '../../../config.ts';

function redirect(path: string): NextResponse {
  // 303 so the browser follows with GET rather than re-posting the credentials.
  //
  // The Location is **relative**, and that is the whole point. `request.url`
  // inside a Route Handler is built from the address this process bound to —
  // 127.0.0.1:4100 — and not from the host the browser actually asked for. It is
  // not a proxy misconfiguration and no Caddy setting fixes it: measured on
  // 2026-08-21, a request arriving with `Host: language-learner.duckdns.org`
  // still produced `http://localhost:4100/`. So `new URL(path, request.url)`
  // sent every signed-in Student to an address that exists only on the Pi.
  //
  // A redirect to a path needs no origin at all. RFC 7231 has allowed a relative
  // Location for a decade, every browser follows it against the address bar, and
  // the middleware's own redirect has always been one.
  return new NextResponse(null, { status: 303, headers: { location: path } });
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
      ? redirect(`/login?error=locked&minutes=${Math.ceil(decision.secondsRemaining / 60)}`)
      : redirect(`/login?error=slow&seconds=${decision.secondsRemaining}`);
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
      return redirect(`/login?error=locked&minutes=${Math.ceil(seconds / 60)}`);
    }
    return redirect('/login?error=invalid');
  }

  recordSuccess(db, username);
  deleteExpiredSessions(db);
  const session = createSession(db, student.id, config.session.ttlDays);

  const response = redirect('/');
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
