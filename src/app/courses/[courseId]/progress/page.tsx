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
import { ErrorHistogram } from './histogram.tsx';
import { ChangeOverTime } from './chart.tsx';
import { ProgressBar } from '../../../shared/progress-bar.tsx';
import { StudentPicker } from './student-picker.tsx';

export const dynamic = 'force-dynamic';

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

  return (
    <main>
      <p className="muted"><a href={`/courses/${courseId}`}>{view.course.title}</a></p>
      <h1>{ru.progress.title}</h1>

      {/* An Admin looking at somebody else's record is told whose it is, every
          time — a screen that does not say invites a decision about the wrong
          person. */}
      {view.onBehalf ? (
        <p className="viewingStudent">{ru.progress.viewingStudent(view.student.username)}</p>
      ) : null}

      {viewer.isAdmin ? (
        <StudentPicker
          courseId={courseId}
          students={studentsInCourse(db, courseId).map((s) => ({ id: s.id, username: s.username }))}
          selected={view.student.id}
        />
      ) : null}

      <h2>{ru.progress.lessonsTitle}</h2>
      {report.lessons.length === 0 ? (
        <p className="muted">{ru.progress.noLessons}</p>
      ) : (
        <ol className="progressLessons">
          {report.lessons.map((lesson) => (
            <li key={lesson.lessonId}>
              <p>
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

      <h2>{ru.progress.courseTotal}</h2>
      {/* The Course on exactly the same terms as one Lesson, summed from the same
          tallies rather than derived a second time. */}
      <p className="score">{ru.progress.percent(report.course.percent)}</p>
      <p className="muted">
        {ru.progress.breakdown(
          report.course.completed, report.course.completedWithHelp, report.course.total,
        )}
        {report.course.disputed > 0
          ? ` · ${ru.practice.disputedCount(report.course.disputed)}`
          : ''}
      </p>

      <h2>{ru.errorStats.title}</h2>
      <ErrorHistogram counts={histogram} />

      <h2>{ru.changeOverTime.title}</h2>
      <ChangeOverTime lessons={perLesson} />

      <h2>{ru.progress.attemptsTitle}</h2>
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
                  : attempt.state === 'grading_failed' ? ru.progress.attemptFailedGrading
                  : ru.test.score(attempt.correct, attempt.total, attempt.scorePercent ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
