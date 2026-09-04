// The Course: its Lessons in order, each showing whether it is open, in
// progress or finished. Working here records the Course as the Current Course,
// which is what makes the next sign-in land straight back in it.

import { notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { getDatabase } from '../../../db/index.ts';
import { courseOutline, enrolledCourses, rememberCurrentCourse } from '../../../practice/lessons.ts';
import { courseTests } from '../../../tests/taking.ts';
import { courseProgress } from '../../../progress/report.ts';
import { ProgressMeter } from '../../shared/progress-meter.tsx';
import { stateClass } from '../../shared/verdict-state.ts';
import { CourseTests } from './tests.tsx';

export const dynamic = 'force-dynamic';

/** The tick a finished Lesson wears, at the size a list row wants. */
const TICK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);
const LOCK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const student = await currentStudent();
  if (!student) notFound();

  const courseId = Number((await params).courseId);
  const { db } = getDatabase();

  // A Course the Student is not enrolled in does not exist as far as they are
  // concerned — the same answer as one that really does not.
  const course = enrolledCourses(db, student.id).find((c) => c.id === courseId);
  if (!course) notFound();

  rememberCurrentCourse(db, student.id, course.id);
  const outline = courseOutline(db, student.id, course.id);
  const report = courseProgress(db, student.id, course.id);
  // Published Tests only, and listed apart from the Lessons: a Test gates
  // nothing, so it does not belong in a list whose order is what unlocks what.
  const tests = courseTests(db, student.id, course.id);

  return (
    <main>
      <div className="pageHead">
        <div>
          <h1>{course.title}</h1>
          <p className="facts">
            <span>{course.level}</span>
            <span>{ru.courses.lessonCount(outline.length)}</span>
          </p>
        </div>
        {/* The one number that answers "how is this going", beside a way to the
            screen that answers it properly. The way there is drawn as a control
            rather than as a run of underlined text: it is the only thing on this
            card that does anything, and a word that has to be aimed at is not
            how anything else in this application offers an action. Quiet rather
            than filled, because the number is what this card is for. */}
        <div className="figure">
          <span>
            <span className="big">{ru.progress.percent(report.course.percent)}</span>
            <span className="under">{ru.progress.courseTotal}</span>
          </span>
          <a className="button secondary" href={`/courses/${course.id}/progress`}>{ru.progress.link}</a>
        </div>
      </div>

      {/* One section, one frame: the Lessons and the Tests are two lists about
          two different things, and a heading between them was the only thing
          saying where one stopped. */}
      <div className="sections">
      <section className="panel">
      <h2>{ru.course.lessonsTitle}</h2>
      <ol className="lessons">
        {outline.map(({ lesson, unlocked, complete, progress }, index) => {
          const withHelp = progress.counts.completedWithHelp > 0;
          const mark = !unlocked
            ? <span className="mark">{LOCK}</span>
            : complete
              ? <span className={`mark ${stateClass(withHelp ? 'help' : 'correct')}`}>{TICK}</span>
              : <span className="mark">{index + 1}</span>;

          const inside = (
            <>
              {mark}
              <span className="body">
                <span className="title">{lesson.title}</span>
                <span className="muted">
                  {!unlocked
                    ? ru.course.locked
                    : complete
                      ? ru.course.complete
                      : `${ru.course.inProgress}: ${progress.counts.completed + progress.counts.completedWithHelp}/${progress.counts.total}`}
                  {/* A disputed Exercise stops holding the Student without having
                      been finished, so a Lesson can read as done while an objection
                      in it is still open. Saying so is the difference between a
                      complete Lesson and one nobody has ruled on yet. */}
                  {progress.counts.disputed > 0
                    ? ` · ${ru.practice.disputedCount(progress.counts.disputed)}`
                    : ''}
                </span>
              </span>
              {unlocked ? <ProgressMeter standing={progress.counts} /> : null}
            </>
          );

          // The whole row is the way in, not the title inside it. A card that
          // looks like one thing and can only be opened by hitting the four
          // words at its top is a card with an invisible target in it — and the
          // rest of it, the mark and the bar, is exactly what a person aims at
          // when they mean "this Lesson". A locked row is a row and not a link,
          // because there is nowhere for it to go.
          return (
            <li key={lesson.id} className={unlocked ? undefined : 'locked'}>
              {unlocked
                ? (
                  <a className="row" href={`/lessons/${lesson.id}`} aria-label={ru.course.openLesson(lesson.title)}>
                    {inside}
                  </a>
                )
                : <span className="row">{inside}</span>}
            </li>
          );
        })}
      </ol>

      </section>

      <section className="panel">
      <h2 id="tests">{ru.test.sectionTitle}</h2>
      <CourseTests
        tests={tests.map(({ test, exerciseCount, attempts }) => ({
          id: test.id,
          title: test.title,
          exerciseCount,
          attempts,
        }))}
      />
      </section>
      </div>
      {/* No back-link. The navigation column carries the way out, and this one
          pointed at the home screen — which redirects to the Current Course, and
          working in a Course is what makes it the Current Course, so it led
          back here. */}
    </main>
  );
}
