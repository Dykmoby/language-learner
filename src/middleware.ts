// The single choke point. Everything except the login screen, the login endpoint
// and static assets requires a valid session.
//
// It runs in the Node runtime so it can resolve the session against SQLite here
// rather than merely noticing that a cookie exists. That distinction matters:
// after sign-out the cookie is still in the browser, and a choke point that only
// checked for its presence would wave it through.

import { NextResponse, type NextRequest } from 'next/server';
import { getDatabase } from './db/index.ts';
import { findSessionStudent } from './auth/session.ts';
import { config as appConfig } from './config.ts';

const PUBLIC_PATHS = new Set(['/login', '/api/login']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const sessionId = request.cookies.get(appConfig.session.cookieName)?.value;
  if (sessionId && findSessionStudent(getDatabase().db, sessionId)) {
    return NextResponse.next();
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  return NextResponse.redirect(login);
}

export const config = {
  runtime: 'nodejs',
  // Static assets stay reachable; everything else goes through the check above.
  //
  // The typeface is among them, and deliberately so. The sign-in screen is the
  // one screen served to somebody with no session, and a font gated behind the
  // session would be answered with a redirect to the sign-in screen — leaving
  // the sign-in screen as the only screen in the application not set in the
  // application's own typeface.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)'],
};
