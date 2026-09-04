// Where a Student stands in a Course — Lesson by Lesson, the Course as a whole,
// and every Test attempt with its score.
//
// One screen, so "how is this going" is answered without three. Who may open it
// is settled in ../../../../progress/viewing.ts and answered there once, because
// all three sections below show more and more of the same data and must not each
// answer it differently.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { currentStudent } from '../../../../auth/current-student.ts';
import { getDatabase } from '../../../../db/index.ts';
import { resolveProgressView, studentsInCourse } from '../../../../progress/viewing.ts';
import { courseProgress } from '../../../../progress/report.ts';
import { errorHistogram, errorsByLesson } from '../../../../progress/errors.ts';
import { lessonActivity } from '../../../../progress/activity.ts';
import { ErrorHistogram } from './histogram.tsx';
import { ChangeOverTime } from './chart.tsx';
import { ProgressBar } from '../../../shared/progress-bar.tsx';
import { stateClass } from '../../../shared/verdict-state.ts';
import { StudentPicker } from './student-picker.tsx';

export const dynamic = 'force-dynamic';

/**
 * How long a list may be and still be shown open.
 *
 * Eight is about a screen of rows on a laptop. Below it the fold costs a click
 * and saves nothing; above it the list is the reason the statistics underneath
 * were never reached.
 */
const OPEN_UP_TO = 8;

/** A `?student=` that is not a number names nobody, which is "my own". */
function requestedStudent(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return null;
  const id = Number(value);
  return Number.isInteger(id) ? id : null;
}

export default async function ProgressPage({
  params, searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await currentStudent();
  if (!viewer) notFound();

  const courseId = Number((await params).courseId);
  if (!Number.isInteger(courseId)) notFound();

  const { db } = getDatabase();
  const view = resolveProgressView(db, viewer, courseId, requestedStudent((await searchParams).student));
  // Another Student's record, or a Course they are not enrolled in: missing
  // rather than forbidden, and the two are deliberately the same answer.
  if (!view) notFound();

  const report = courseProgress(db, view.student.id, courseId);
  // Scoped to the Course, which is what makes the Language single-valued: the
  // two enums share Russian words for different grammar, and only the stable enum
  // value is ever grouped on.
  const histogram = errorHistogram(db, view.student.id, courseId, view.course.language);
  // Per Lesson, so a span can be chosen in the browser without a round trip: the
  // whole Course is a few dozen numbers, and the span is a slice of them.
  const perLesson = errorsByLesson(db, view.student.id, courseId, view.course.language);
  // When each of them was worked, so a span can be chosen by date as well as by
  // number. Same shape of trip as the counts above — a few dozen rows, read once
  // and filtered in the browser.
  const worked = lessonActivity(db, view.student.id, courseId);

  return (
    <main>
      <div className="pageHead">
        <div>
          <p className="muted">{view.course.title}</p>
          <h1>{ru.progress.title}</h1>
        </div>
        {viewer.isAdmin ? (
          <StudentPicker
            courseId={courseId}
            students={studentsInCourse(db, courseId).map((s) => ({ id: s.id, username: s.username }))}
            selected={view.student.id}
          />
        ) : null}
      </div>

      {/* An Admin looking at somebody else's record is told whose it is, every
          time — a screen that does not say invites a decision about the wrong
          person. */}
      {view.onBehalf ? (
        <p className="viewingStudent">{ru.progress.viewingStudent(view.student.username)}</p>
      ) : null}

      {/* One section, one frame — the folding ones included. A `<details>` that
          drew only a rule under its summary was a section on a screen whose
          neighbours are framed, so the fold now happens inside a frame like
          everything else here. The figure joins the stack rather than sitting
          above it: it is already a framed block, and outside the stack it had
          no air under it and ran straight into the Lessons panel. */}
      <div className="sections">

      {/* The Course on exactly the same terms as one Lesson, summed from the same
          tallies rather than derived a second time. */}
      <div className="figure">
        <span>
          <span className="big">{ru.progress.percent(report.course.percent)}</span>
          <span className="under">{ru.progress.courseTotal}</span>
        </span>
        <span className="muted">
          {ru.progress.breakdown(
            report.course.completed, report.course.completedWithHelp, report.course.total,
          )}
          {report.course.disputed > 0
            ? ` · ${ru.practice.disputedCount(report.course.disputed)}`
            : ''}
        </span>
      </div>

      {/* The two long lists fold, and the two short summaries do not. A Course
          of a hundred Lessons put a hundred bars between the header and the
          statistics — the numbers this screen exists for were below the fold on
          the only Course big enough to need them.

          Open where the list is short enough to be read at a glance, folded
          where it is not, rather than always one or always the other: the fold
          is there for the hundred-Lesson case, and making a Course of three
          Lessons open with nothing showing would be paying its cost for it.
          `<details>` rather than a toggle in JavaScript, because this screen is
          rendered on the server and a list that needs a bundle before it can be
          opened is a list that is sometimes not there. */}
      <details className="section panel" open={report.lessons.length <= OPEN_UP_TO}>
        <summary>
          <h2>{ru.progress.lessonsTitle}</h2>
          <span className="muted">{ru.progress.lessonsCount(report.lessons.length)}</span>
        </summary>
        {report.lessons.length === 0 ? (
          <p className="muted">{ru.progress.noLessons}</p>
        ) : (
          <ol className="progressLessons">
            {report.lessons.map((lesson) => (
              <li key={lesson.lessonId}>
                {/* The same circled number the navigation column and the Course
                    listing draw. A Lesson is referred to by its number in three
                    other places on this screen — the chart's axis, its table,
                    the span pickers — and this was the one list that made the
                    reader match on the title instead. */}
                <p className="lessonName">
                  {/* Not hidden from a screen reader, and the number is not
                      repeated in the title beside it: the circle *is* how the
                      Lesson is numbered, read out as «1 Артикли…» exactly the
                      way the navigation column already reads it. */}
                  <span className="mark">{lesson.position}</span>
                  <strong>{lesson.title}</strong>
                  {lesson.unlocked ? null : <span className="muted">{' — '}{ru.progress.locked}</span>}
                </p>
                <ProgressBar
                  segments={lesson.states.map((state, index) => ({ position: index + 1, state }))}
                />
                <p className="muted">
                  {ru.progress.percent(lesson.percent)}
                  {' · '}
                  {ru.progress.breakdown(
                    lesson.tally.completed, lesson.tally.completedWithHelp, lesson.tally.total,
                  )}
                  {lesson.tally.disputed > 0
                    ? ` · ${ru.practice.disputedCount(lesson.tally.disputed)}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </details>

      <section className="panel">
      <h2>{ru.errorStats.title}</h2>
      <ErrorHistogram counts={histogram} />
      </section>

      <section className="panel">
      <h2>{ru.changeOverTime.title}</h2>
      <ChangeOverTime lessons={perLesson} worked={worked} />
      </section>

      <details className="section panel" open={report.attempts.length <= OPEN_UP_TO}>
        <summary>
          <h2>{ru.progress.attemptsTitle}</h2>
          <span className="muted">{ru.progress.attemptsCount(report.attempts.length)}</span>
        </summary>
        {report.attempts.length === 0 ? (
          <p className="muted">{ru.progress.noAttempts}</p>
        ) : (
          <ul className="attempts">
            {report.attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                <a href={`/tests/${attempt.testId}/attempts/${attempt.attemptId}`}>
                  {ru.progress.attemptLine(attempt.testTitle, attempt.attempt)}
                </a>
                <span className="muted">
                  {' — '}{new Date(attempt.submittedAt).toLocaleString(ru.locale)}
                  {' · '}
                  {attempt.state === 'grading' ? ru.progress.attemptPending
                    : attempt.state === 'grading_failed'
                      // Marked rather than left as one more grey clause: a failed
                      // grading is not a low score, and this list is where the two
                      // are easiest to read as the same thing.
                      ? <span className={`stateName ${stateClass('failed')}`}>{ru.progress.attemptFailedGrading}</span>
                      : ru.test.score(attempt.correct, attempt.total, attempt.scorePercent ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
      </div>
    </main>
  );
}
