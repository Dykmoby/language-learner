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
import { PATHNAME_HEADER } from './app/shared/request-path.ts';

const PUBLIC_PATHS = new Set(['/login', '/api/login']);

// The only three things an account holding a Temporary Password may reach.
//
// A Temporary Password is known to the Admin who generated it as well as to the
// Student it was given to, so the account is not yet anybody's in particular.
// Until that stops being true it can do exactly three things: read the screen
// that says so, replace the password, and leave. Everything else — a Lesson, a
// Submission, the Admin section — is answered with a redirect to the first.
//
// Enforced here rather than on each screen for the reason the session check is:
// a rule that every page has to remember is a rule the next page will forget.
const PASSWORD_CHANGE_PATHS = new Set(['/password', '/api/password', '/api/logout']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const sessionId = request.cookies.get(appConfig.session.cookieName)?.value;
  const student = sessionId ? findSessionStudent(getDatabase().db, sessionId) : null;

  if (student) {
    if (student.passwordIsTemporary && !PASSWORD_CHANGE_PATHS.has(pathname)) {
      const change = request.nextUrl.clone();
      change.pathname = '/password';
      change.search = '';
      return NextResponse.redirect(change);
    }

    // The header wraps every signed-in screen from the root layout, which
    // receives no route parameters and so cannot know which Course is open. The
    // path is the one thing this function certainly knows, so it hands it on.
    //
    // `set` rather than `append`: a client sending this header of its own has it
    // overwritten here, so what the layout reads is always what was requested.
    // It is still treated as a claim on the other side — enrolment decides what
    // a Student is shown, not a header.
    const forwarded = new Headers(request.headers);
    forwarded.set(PATHNAME_HEADER, pathname);
    return NextResponse.next({ request: { headers: forwarded } });
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
  //
  // `icon.svg` is here for exactly that reason and was missing it: a browser
  // asks for a tab icon on its own schedule, often before any session exists and
  // never as a navigation, so the redirect handed it the sign-in page as
  // `text/html` — which is not an image, so the tab stayed blank. Worse, the
  // browser then caches that answer, so signing in did not fix it either.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|fonts/).*)'],
};
