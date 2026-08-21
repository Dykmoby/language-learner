import { NextResponse } from 'next/server';
import { getDatabase } from '../../../db/index.ts';
import { deleteSession } from '../../../auth/session.ts';
import { config } from '../../../config.ts';

export async function POST(request: Request): Promise<NextResponse> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${config.session.cookieName}=([^;]+)`).exec(cookieHeader);

  // Deleting the row is the point: the cookie may well still be in the browser,
  // and it must stop authenticating the moment this returns.
  if (match?.[1]) deleteSession(getDatabase().db, decodeURIComponent(match[1]));

  // Relative, for the reason the login route sets out: `request.url` names the
  // address this process bound to, not the one the browser is looking at.
  const response = new NextResponse(null, { status: 303, headers: { location: '/login' } });
  response.cookies.set({
    name: config.session.cookieName,
    value: '',
    httpOnly: true,
    secure: config.session.secureCookie,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
