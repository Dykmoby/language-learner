// Replacing your own password.
//
// A form post rather than JSON, because the screen in front of it is a plain
// server-rendered form: the one act that must keep working when nothing else
// does should not need a bundle to reach its endpoint. Refusals travel back as
// query parameters the same way the sign-in screen's do.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDatabase } from '../../../db/index.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { changePassword } from '../../../auth/accounts.ts';
import { config } from '../../../config.ts';

// Relative, for the reason the sign-in route sets out at length: `request.url`
// names the address this process bound to, not the one the browser is looking at.
function redirect(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session. This is
  // what makes that irrelevant: a session can expire between the two checks, and
  // an endpoint that relied on another layer having looked is an endpoint anyone
  // can call.
  if (!student) return redirect('/login');

  const sessionId = (await cookies()).get(config.session.cookieName)?.value;
  if (!sessionId) return redirect('/login');

  const form = await request.formData();

  const result = await changePassword(getDatabase().db, {
    studentId: student.id,
    currentPassword: String(form.get('current') ?? ''),
    newPassword: String(form.get('next') ?? ''),
    confirmation: String(form.get('confirmation') ?? ''),
    sessionId,
  });

  if (!result.ok) {
    const query = new URLSearchParams(result.faults.map((code) => ['error', code]));
    return redirect(`/password?${query.toString()}`);
  }

  // Back to the same screen rather than onward into the application. A Student
  // who came here on purpose gets the one thing they came for — being told it
  // worked — and a Student who was sent here is no longer being sent here, so the
  // link on the page now goes somewhere.
  return redirect('/password?changed=1');
}
