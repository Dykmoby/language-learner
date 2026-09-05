'use client';

// The Lessons of a Course, with a way to put the finished ones out of sight.
//
// Late in a Course the list is mostly work that is behind the Student, and the
// two rows that are not are at the bottom of it. The toggle lives in this frame
// and answers for this list alone — the Tests have their own, because a Student
// who has finished every Lesson and no Test wants exactly one of the two lists
// cleared.
//
// A Lesson keeps the number it has in the Course, not the number it has in what
// is being shown: hiding four Lessons must not renumber the fifth. That is why
// the number arrives as a field rather than as an index into this array.

import { Switch } from '@mantine/core';
import { ru } from '../../../ru.ts';
import type { Standing } from '../../shared/progress-meter.tsx';
import { ProgressMeter } from '../../shared/progress-meter.tsx';
import { useRememberedFlag } from '../../shared/remembered-flag.ts';
import { stateClass } from '../../shared/verdict-state.ts';

/** The tick a finished Lesson wears, at the size a list row wants. */
const TICK = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 13l4 4L19 7" />
  </svg>
);

export type CourseLesson = {
  id: number;
  /** Its place in the Course, which is not its place in what is on screen. */
  number: number;
  title: string;
  /**
   * Every Exercise is behind the Student, however it got there — solved,
   * revealed or disputed. The same fact the tick reports, and the one the toggle
   * hides by.
   */
  complete: boolean;
  counts: Standing;
};

export function CourseLessons({ lessons }: { lessons: CourseLesson[] }) {
  const [hideFinished, setHideFinished] = useRememberedFlag('course.hideFinishedLessons');
  const shown = hideFinished ? lessons.filter((lesson) => !lesson.complete) : lessons;

  return (
    <>
      <div className="panelHead">
        <h2>{ru.course.lessonsTitle}</h2>
        <Switch
          size="sm"
          checked={hideFinished}
          onChange={(event) => setHideFinished(event.currentTarget.checked)}
          label={ru.course.hideFinished}
        />
      </div>

      {/* An empty frame reads as a fault, so the one case where this list can
          empty itself says which of the two it is. The toggle stays where it
          was: whatever hid the rows has to be within reach of whoever wants
          them back. */}
      {shown.length === 0 ? (
        <p className="muted">
          {lessons.length === 0 ? ru.course.noLessons : ru.course.allFinishedHidden}
        </p>
      ) : (
        <ol className="lessons">
          {shown.map(({ id, number, title, complete, counts }) => {
            const withHelp = counts.completedWithHelp > 0;
            const mark = complete
              ? <span className={`mark ${stateClass(withHelp ? 'help' : 'correct')}`}>{TICK}</span>
              : <span className="mark">{number}</span>;

            // The whole row is the way in, not the title inside it. A card that
            // looks like one thing and can only be opened by hitting the four
            // words at its top is a card with an invisible target in it — and the
            // rest of it, the mark and the bar, is exactly what a person aims at
            // when they mean "this Lesson".
            return (
              <li key={id}>
                <a className="row" href={`/lessons/${id}`} aria-label={ru.course.openLesson(title)}>
                  {mark}
                  <span className="body">
                    <span className="title">{title}</span>
                    <span className="muted">
                      {complete
                        ? ru.course.complete
                        : `${ru.course.inProgress}: ${counts.completed + counts.completedWithHelp}/${counts.total}`}
                      {/* A disputed Exercise stops holding the Student without
                          having been finished, so a Lesson can read as done while
                          an objection in it is still open. Saying so is the
                          difference between a complete Lesson and one nobody has
                          ruled on yet. */}
                      {counts.disputed > 0 ? ` · ${ru.practice.disputedCount(counts.disputed)}` : ''}
                    </span>
                  </span>
                  <ProgressMeter standing={counts} />
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
