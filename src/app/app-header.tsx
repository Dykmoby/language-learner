// The chrome the application did not have.
//
// Before this every screen was a bare `main`, and navigation was whatever
// back-link its author had added at the bottom. Two things followed, and both
// were live defects rather than untidiness:
//
// A Student could not sign out. The control existed on one screen — the home
// screen — and the home screen redirects a Student who has a Current Course
// straight into that Course. The one screen carrying the button was the one
// screen an enrolled Student was never allowed to stay on.
//
// And the back-link from a Course went nowhere: it pointed at the home screen,
// which redirected to the Current Course, which was the screen the Student had
// just left. Working in a Course is what sets it as the Current Course, so that
// was the ordinary path rather than an edge case.
//
// It renders from the root layout, so it wraps every screen rather than being
// something each screen remembers to include — which is the same mistake in a
// new place. The sign-in screen is the exception and gets it for free: there is
// no session, so there is nothing to show and nowhere to go, and this returns
// null.

import { headers } from 'next/headers';
import { ru } from '../ru.ts';
import { currentStudent } from '../auth/current-student.ts';
import { getDatabase } from '../db/index.ts';
import { openCourse } from './shared/open-course.ts';
import { PATHNAME_HEADER } from './shared/request-path.ts';

export async function AppHeader() {
  const student = await currentStudent();
  if (student === null) return null;

  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';

  // An account still holding a Temporary Password can reach exactly one screen,
  // and every link this header would otherwise offer bounces straight back to
  // it. So it offers none of them: the name is text rather than a link, no
  // Course is named — the Course query is not even run, because there is nothing
  // it could produce that this header may show — and the one control left is the
  // one that still leads somewhere. A nav full of links that return you to the
  // page you clicked them on is worse than no nav.
  if (student.passwordIsTemporary) {
    return (
      <header className="appHeader">
        <div>
          <span className="appName">{ru.appName}</span>
          <nav aria-label={ru.chrome.navLabel}>
            <form method="post" action="/api/logout">
              <button type="submit" className="secondary">{ru.common.signOut}</button>
            </form>
          </nav>
        </div>
      </header>
    );
  }

  const { db } = getDatabase();
  const course = openCourse(db, student, pathname);

  // The Admin section is set on a wider measure than the Student's screens, and a
  // header that stayed narrow above it would be a column that stops where the
  // page does not.
  const wide = pathname.startsWith('/admin');

  return (
    <header className={wide ? 'appHeader wide' : 'appHeader'}>
      <div>
        {/* The way out, and deliberately not `/` — `/` redirects into the
            Current Course, so an application name pointing at it would be a
            link that leads back to the screen it was clicked on. */}
        <a className="appName" href="/courses">{ru.appName}</a>

        {course === null ? null : (
          <a className="openCourse" href={`/courses/${course.id}`}>{course.title}</a>
        )}

        <nav aria-label={ru.chrome.navLabel}>
          {/* Only for a Student holding the Admin role. Not merely hidden: a
              Student who is not an Admin is answered with a 404 by the section
              itself, and this is the half of that a person sees. */}
          {student.isAdmin ? <a href="/admin">{ru.chrome.admin}</a> : null}
          <form method="post" action="/api/logout">
            <button type="submit" className="secondary">{ru.common.signOut}</button>
          </form>
        </nav>
      </div>
    </header>
  );
}
