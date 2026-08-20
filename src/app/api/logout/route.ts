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

  const response = NextResponse.redirect(new URL('/login', request.url), 303);
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
