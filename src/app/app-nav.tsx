// The chrome: a column rather than a bar.
//
// What it replaced was a header, and the header had a problem a row cannot
// solve. It had to carry every way out of every screen on one line, so each
// screen had grown its own back-link at the bottom as well — «К курсу», «К
// списку уроков», «К черновику» — and a way back that exists in two places is a
// way back that can disagree with itself. A column has room for the way out and
// for where you are at the same time, so the back-links are gone rather than
// duplicated.
//
// The two live defects the header was built to fix are still fixed here, and
// `tests/app-chrome-http.test.ts` still holds them: a Student can sign out from
// every signed-in screen, and the application name points at `/courses` rather
// than at `/`, because `/` redirects into the Current Course and would send a
// Student back to the screen they clicked it on.
//
// It renders from the root layout, so it wraps every screen rather than being
// something each screen remembers to include — which is the same mistake in a
// new place.

import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { ru } from '../ru.ts';
import type { StudentRow } from '../db/schema.ts';
import { getDatabase } from '../db/index.ts';
import { courseOutline } from '../practice/lessons.ts';
import { pendingDisputes } from '../admin/disputes.ts';
import { openCourse } from './shared/open-course.ts';
import { PATHNAME_HEADER } from './shared/request-path.ts';
import { stateClass } from './shared/verdict-state.ts';
import { ColorSchemeToggle } from './color-scheme-toggle.tsx';

/* --- Icons -------------------------------------------------------------------
   Drawn rather than set as glyphs: an emoji is a different picture on every
   machine that opens it, and half of them are not drawn for a dark ground.
   One weight, one grid, `currentColor` throughout, so a link's icon follows the
   link's colour without either being told about the other. */

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const BookIcon = <Icon><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v16H5.5A1.5 1.5 0 0 1 4 18.5z" /><path d="M8 4v16" /></Icon>;
const TestIcon = <Icon><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Icon>;
const ChartIcon = <Icon><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15l4-5 3 3 4-6" /></Icon>;
const ShieldIcon = <Icon><path d="M12 3l7 4v6c0 4-3 7-7 8-4-1-7-4-7-8V7z" /><path d="M9.5 12l2 2 3.5-4" /></Icon>;
const PeopleIcon = <Icon><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 8.5h5" /><path d="M16 12h5" /></Icon>;
const FlagIcon = <Icon><path d="M12 3l9 16H3z" /><path d="M12 9v4" /><path d="M12 16v.01" /></Icon>;
const NoteIcon = <Icon><path d="M5 5h14v11H8l-3 3z" /><path d="M9 9h6" /><path d="M9 12.5h4" /></Icon>;
const PulseIcon = <Icon><path d="M3 12h4l2.5-6 5 12L17 12h4" /></Icon>;
const BackIcon = <Icon><path d="M10 6l-6 6 6 6" /><path d="M20 12H4" /></Icon>;
const SignOutIcon = <Icon><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h9" /></Icon>;

/** The mark beside a Lesson: pass, finished with help, or here. */
const TickIcon = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);
/* --- Pieces ------------------------------------------------------------------ */

function NavLink({ href, icon, label, here, count }: {
  href: string;
  icon: ReactNode;
  label: string;
  here?: boolean;
  count?: number;
}) {
  return (
    <a href={href} className={here ? 'here' : undefined} aria-current={here ? 'page' : undefined}>
      {icon}
      {label}
      {/* A queue's length, and the only number in this column. It wears the
          Disputed state class so the hue comes from the state system rather than
          from a rule of its own — see `globals.css`. */}
      {count === undefined || count === 0
        ? null
        : <span className={`count ${stateClass('disputed')}`}>{count}</span>}
    </a>
  );
}

function SignOut() {
  return (
    <form method="post" action="/api/logout">
      <button type="submit" className="secondary" aria-label={ru.common.signOut}>
        {SignOutIcon}
      </button>
    </form>
  );
}

/**
 * The foot of the column: who is signed in, the way out, and the theme.
 *
 * The theme control sits here rather than on a settings screen because this
 * application has no settings screen, and because the two things a person wants
 * from the chrome once they are done reading are the same two things: leave, or
 * turn the lights down.
 */
function Account({ username }: { username: string }) {
  return (
    <div className="accountBlock">
      <ColorSchemeToggle />
      <div className="account">
        <span className="avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</span>
        <span className="who">{username}</span>
        <SignOut />
      </div>
    </div>
  );
}

/** The id in `/lessons/123/...`, where the path is inside a Lesson. */
function openLessonId(pathname: string): number | null {
  const match = /^\/lessons\/(\d+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}

/* --- The column -------------------------------------------------------------- */

export async function AppNav({ student }: { student: StudentRow }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';

  // An account still holding a Temporary Password can reach exactly one screen,
  // and every link this column would otherwise offer bounces straight back to
  // it. So it offers none of them: the name is text rather than a link, no
  // Course is named — the Course query is not even run, because there is nothing
  // it could produce that this may show — and the one control left is the one
  // that still leads somewhere.
  if (student.passwordIsTemporary) {
    return (
      <aside className="appNav">
        <span className="appName">{ru.appName}</span>
        <Account username={student.username} />
      </aside>
    );
  }

  const { db } = getDatabase();

  // Only for a Student holding the Admin role, and not merely hidden: a Student
  // who is not an Admin is answered with a 404 by the section itself, and this
  // is the half a person sees.
  const inAdmin = student.isAdmin && pathname.startsWith('/admin');

  if (inAdmin) {
    const waiting = pendingDisputes(db).length;
    return (
      <aside className="appNav admin">
        <div>
          <a className="appName" href="/admin">{ru.admin.title}</a>
          <span className="openCourse">{ru.appName}</span>
        </div>

        <nav aria-label={ru.chrome.navLabel}>
          <NavLink href="/admin" icon={BookIcon} label={ru.admin.coursesTitle} here={pathname === '/admin'} />
          <NavLink href="/admin/students" icon={PeopleIcon} label={ru.admin.accountsLink} here={pathname.startsWith('/admin/students')} />
          <NavLink href="/admin/disputes" icon={FlagIcon} label={ru.disputeReview.link} here={pathname.startsWith('/admin/disputes')} count={waiting} />
          <NavLink href="/admin/guidance" icon={NoteIcon} label={ru.guidance.link} here={pathname.startsWith('/admin/guidance')} />
          <NavLink href="/admin/health" icon={PulseIcon} label={ru.admin.healthLink} here={pathname.startsWith('/admin/health')} />
        </nav>

        <nav aria-label={ru.chrome.backToCourses}>
          <NavLink href="/courses" icon={BackIcon} label={ru.chrome.backToCourses} />
        </nav>

        <Account username={student.username} />
      </aside>
    );
  }

  const course = openCourse(db, student, pathname);

  return (
    <aside className="appNav">
      <div>
        {/* The way out, and deliberately not `/` — `/` redirects into the
            Current Course, so an application name pointing at it would be a
            link that leads back to the screen it was clicked on. */}
        <a className="appName" href="/courses">{ru.appName}</a>
        {course === null
          ? <span className="openCourse">{ru.courses.title}</span>
          : <a className="openCourse" href={`/courses/${course.id}`}>{course.title}</a>}
      </div>

      <nav aria-label={ru.chrome.navLabel}>
        {course === null ? (
          <NavLink href="/courses" icon={BookIcon} label={ru.courses.title} here={pathname === '/courses'} />
        ) : (
          <>
            <NavLink href={`/courses/${course.id}`} icon={BookIcon} label={ru.chrome.course} here={pathname === `/courses/${course.id}`} />
            <NavLink href={`/courses/${course.id}#tests`} icon={TestIcon} label={ru.test.sectionTitle} />
            <NavLink href={`/courses/${course.id}/progress`} icon={ChartIcon} label={ru.progress.link} here={pathname.startsWith(`/courses/${course.id}/progress`)} />
          </>
        )}
        {student.isAdmin ? <NavLink href="/admin" icon={ShieldIcon} label={ru.chrome.admin} /> : null}
      </nav>

      {course === null ? null : <LessonRail courseId={course.id} studentId={student.id} pathname={pathname} />}

      <Account username={student.username} />
    </aside>
  );
}

/**
 * The Lessons of the open Course, with the one being worked opened out.
 *
 * This is the thing a bar had no room for, and the reason the back-links could
 * be removed rather than moved: from inside a Practice, where you are in the
 * Lesson and where the Lesson sits in the Course are both on the screen already.
 */
async function LessonRail({ courseId, studentId, pathname }: {
  courseId: number;
  studentId: number;
  pathname: string;
}) {
  const { db } = getDatabase();
  const outline = courseOutline(db, studentId, courseId);
  if (outline.length === 0) return null;

  const openId = openLessonId(pathname);
  const inPractice = /^\/lessons\/\d+\/practice$/.test(pathname);

  return (
    <div className="lessonRail">
      <span className="groupLabel">{ru.course.lessonsTitle}</span>

      {outline.map(({ lesson, complete, progress }, index) => {
        const here = lesson.id === openId;

        // Which mark a finished Lesson gets. Completed With Help is its own
        // state everywhere else in this application, so it is its own state
        // here: a Lesson finished by revealing four answers is not the same
        // fact as one solved unaided, and the rail says so without a word.
        const finishedWith = progress.counts.completedWithHelp > 0 ? 'help' : 'correct';
        const mark = here
          ? <span className="mark here">{index + 1}</span>
          : complete
            ? <span className={`mark ${stateClass(finishedWith)}`}>{TickIcon}</span>
            : <span className="mark">{index + 1}</span>;

        if (!here) {
          return (
            <a key={lesson.id} href={`/lessons/${lesson.id}`}>
              {mark}
              {lesson.title}
            </a>
          );
        }

        return (
          <div key={lesson.id} className="open">
            <a href={`/lessons/${lesson.id}`}>
              {mark}
              {lesson.title}
            </a>
            <nav aria-label={lesson.title}>
              <a href={`/lessons/${lesson.id}`} className={inPractice ? undefined : 'here'}>
                {ru.lesson.theory}
              </a>
              <a href={`/lessons/${lesson.id}/practice`} className={inPractice ? 'here' : undefined}>
                {ru.practice.title}
              </a>
            </nav>
          </div>
        );
      })}
    </div>
  );
}
