'use client';

// Choosing one end of the span, in a panel rather than in a drop-down.
//
// The two ends used to be `<Select>`s. That works at three Lessons and stops
// working somewhere around fifteen: a native-shaped list of a hundred titles,
// each truncated to the width of the control, is a list you scroll rather than
// one you search — and the thing a person actually knows about the Lesson they
// want is rarely its full title. They know it was «где-то в начале сентября», or
// they know it was number 41.
//
// So all three of the ways a Lesson is identified in this application are
// offered at once, over the same list: its number, its name, and when it was
// worked. The number is the one in the circle everywhere else; the dates come
// from the Submissions the Student actually wrote.
//
// The calendar is a range rather than two separate day fields, and it is folded
// away until it is asked for. A month grid is the largest thing in this panel and
// the least often wanted — most spans are chosen by number, in the list, without
// ever opening it.

import { useId, useMemo, useState } from 'react';
import { Modal, TextInput } from '@mantine/core';
import { ru } from '../../../../ru.ts';

export type PickableLesson = {
  /** Where the Lesson sits in the array the chart spans over. */
  index: number;
  /** The Lesson's number in the Course — the one drawn in the circle. */
  position: number;
  title: string;
  /** The first and last moments the Student answered in it, or null for neither. */
  firstAt: number | null;
  lastAt: number | null;
};

/** Midnight local time, which is the unit a person picks a date in. */
function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function monthOf(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function shiftMonth(month: number, by: number): number {
  const date = new Date(month);
  return new Date(date.getFullYear(), date.getMonth() + by, 1).getTime();
}

/**
 * Monday first, and read out of the browser rather than written down.
 *
 * The dictionary holds what this application says; the names of the days are
 * what the reader's locale says, and `ru.locale` is where the two meet. Written
 * out here they would be seven more strings to translate for no gain.
 */
function weekdayNames(): string[] {
  const format = new Intl.DateTimeFormat(ru.locale, { weekday: 'short' });
  // 2024-01-01 was a Monday, which is what makes this a week rather than seven
  // arbitrary days.
  return Array.from({ length: 7 }, (_, day) =>
    format.format(new Date(Date.UTC(2024, 0, 1 + day))));
}

function formatDay(at: number): string {
  return new Date(at).toLocaleDateString(ru.locale, { day: 'numeric', month: 'long' });
}

function formatMonth(at: number): string {
  return new Date(at).toLocaleDateString(ru.locale, { month: 'long', year: 'numeric' });
}

/** A closed span of days. `to` is the last day itself, not the moment after it. */
type Range = { from: number; to: number };

/**
 * Whether a Lesson was worked at any point inside the chosen days.
 *
 * The Lesson's own span is compared against the chosen one rather than only its
 * first day: a Lesson worked over a fortnight belongs to any week of it, and
 * asking only about the day it was started would hide it from every question
 * about the fortnight's other thirteen days.
 */
function workedWithin(lesson: PickableLesson, range: Range): boolean {
  if (lesson.firstAt === null || lesson.lastAt === null) return false;
  return startOfDay(lesson.firstAt) <= range.to && startOfDay(lesson.lastAt) >= range.from;
}

/**
 * Whether the typed text names this Lesson.
 *
 * Two readings of a query and they are deliberately or-ed rather than chosen
 * between: «12» is a Lesson number, and it is also a substring of «Урок 12 —
 * времена», and a person typing it means whichever of the two turns out to
 * exist. Numbers are matched by prefix so that typing «4» while looking for 41
 * does not empty the list on the way there.
 */
function named(lesson: PickableLesson, query: string): boolean {
  const trimmed = query.trim().toLocaleLowerCase(ru.locale);
  if (trimmed === '') return true;
  if (lesson.title.toLocaleLowerCase(ru.locale).includes(trimmed)) return true;
  const digits = trimmed.replace(/\D/g, '');
  return digits !== '' && String(lesson.position).startsWith(digits);
}

const CHEVRON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

function Arrow({ back }: { back: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={back ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

export function LessonPicker({
  label, lessons, chosen, onChoose,
}: {
  label: string;
  lessons: PickableLesson[];
  chosen: number;
  onChoose: (index: number) => void;
}) {
  // Generated rather than built out of the label: the label is a Russian
  // sentence, and a document id is not the place for one.
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState<Range | null>(null);
  const [showDates, setShowDates] = useState(false);

  const current = lessons.find((lesson) => lesson.index === chosen) ?? lessons[0]!;

  const matching = lessons.filter((lesson) =>
    named(lesson, query) && (range === null || workedWithin(lesson, range)));

  const choose = (index: number) => {
    onChoose(index);
    setOpen(false);
  };

  return (
    <div className="pickerField">
      <span className="pickerLabel" id={`${id}-label`}>{label}</span>
      <button
        type="button"
        className="pickerTrigger"
        onClick={() => setOpen(true)}
        aria-labelledby={`${id}-label ${id}-value`}
      >
        <span className="mark">{current.position}</span>
        <span className="pickerValue" id={`${id}-value`}>{current.title}</span>
        {CHEVRON}
      </button>

      <Modal
        opened={open}
        onClose={() => setOpen(false)}
        title={label}
        centered
        size="lg"
        closeButtonProps={{ 'aria-label': ru.common.close }}
      >
        <div className="pickerPanel">
          <TextInput
            label={ru.changeOverTime.search}
            placeholder={ru.changeOverTime.searchHint}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            data-autofocus
          />

          <div className="dateFilter">
            <button
              type="button"
              className={showDates ? 'dateToggle open' : 'dateToggle'}
              onClick={() => setShowDates((was) => !was)}
              aria-expanded={showDates}
            >
              {CHEVRON}
              <span>{ru.changeOverTime.byDate}</span>
              {range === null ? null : (
                <span className="chosenRange">
                  {range.from === range.to
                    ? formatDay(range.from)
                    : `${formatDay(range.from)} — ${formatDay(range.to)}`}
                </span>
              )}
            </button>

            {showDates ? (
              <RangeCalendar
                lessons={lessons}
                range={range}
                onRange={setRange}
              />
            ) : null}
          </div>

          {matching.length === 0 ? (
            <p className="muted">{ru.changeOverTime.nothingFound}</p>
          ) : (
            <ul className="pickerList">
              {matching.map((lesson) => (
                <li key={lesson.index}>
                  <button
                    type="button"
                    className={lesson.index === chosen ? 'pickerRow here' : 'pickerRow'}
                    onClick={() => choose(lesson.index)}
                    aria-current={lesson.index === chosen ? 'true' : undefined}
                  >
                    <span className="mark">{lesson.position}</span>
                    <span className="body">
                      <span className="title">{lesson.title}</span>
                      <span className="muted">
                        {lesson.firstAt === null || lesson.lastAt === null
                          ? ru.changeOverTime.notWorked
                          : ru.changeOverTime.workedOn(
                            formatDay(lesson.firstAt), formatDay(lesson.lastAt),
                          )}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}

/**
 * One month at a time, with a span drawn across it.
 *
 * The interaction is the one every travel site has taught: the first press sets
 * a start and nothing else, the second closes the span, and a third starts
 * again. Between the first and the second the row under the pointer previews
 * what closing it there would give — which is the part that makes it legible
 * without instructions.
 *
 * Hand-rolled rather than pulled in. The date library this would otherwise want
 * is a dependency, a bundle and an upgrade path for one grid on one screen —
 * the same argument the chart beside it already makes.
 */
function RangeCalendar({
  lessons, range, onRange,
}: {
  lessons: PickableLesson[];
  range: Range | null;
  onRange: (range: Range | null) => void;
}) {
  // The days something was actually answered on. What the grid is for is
  // recognising a stretch of study, and an undotted month is a month to skip.
  const studied = useMemo(() => {
    const days = new Set<number>();
    for (const lesson of lessons) {
      if (lesson.firstAt !== null) days.add(startOfDay(lesson.firstAt));
      if (lesson.lastAt !== null) days.add(startOfDay(lesson.lastAt));
    }
    return days;
  }, [lessons]);

  // Opened where the studying is, not where the calendar happens to be today: a
  // Course finished in March is a Course whose picker should not start in
  // November with eight presses between it and anything.
  const latest = useMemo(() => {
    const days = [...studied];
    return days.length === 0 ? Date.now() : Math.max(...days);
  }, [studied]);

  const [month, setMonth] = useState(() => monthOf(range?.to ?? latest));
  const [anchor, setAnchor] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const first = new Date(month);
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  // Monday-first, so Sunday's 0 becomes the sixth column rather than the first.
  const blanks = (first.getDay() + 6) % 7;

  // What is drawn as filled: the settled span, or the one being drawn now.
  const previewed: Range | null = anchor === null
    ? range
    : hovered === null
      ? { from: anchor, to: anchor }
      : { from: Math.min(anchor, hovered), to: Math.max(anchor, hovered) };

  const press = (day: number) => {
    if (anchor === null) {
      setAnchor(day);
      onRange({ from: day, to: day });
      return;
    }
    onRange({ from: Math.min(anchor, day), to: Math.max(anchor, day) });
    setAnchor(null);
  };

  const clear = () => {
    setAnchor(null);
    setHovered(null);
    onRange(null);
  };

  return (
    <div className="calendar">
      <div className="calHeader">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label={ru.changeOverTime.previousMonth}>
          <Arrow back />
        </button>
        <span aria-live="polite">{formatMonth(month)}</span>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label={ru.changeOverTime.nextMonth}>
          <Arrow back={false} />
        </button>
      </div>

      <div className="calGrid" onMouseLeave={() => setHovered(null)}>
        {weekdayNames().map((name) => (
          <span key={name} className="calHead">{name}</span>
        ))}
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} className="calCell" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = new Date(first.getFullYear(), first.getMonth(), index + 1).getTime();
          const inside = previewed !== null && day >= previewed.from && day <= previewed.to;
          const isStart = previewed !== null && day === previewed.from;
          const isEnd = previewed !== null && day === previewed.to;
          const marks = [
            inside ? 'in' : null,
            isStart ? 'start' : null,
            isEnd ? 'end' : null,
          ].filter((mark) => mark !== null).join(' ');

          return (
            <span key={day} className={`calCell ${marks}`}>
              <button
                type="button"
                className={studied.has(day) ? 'calDay studied' : 'calDay'}
                onClick={() => press(day)}
                onMouseEnter={() => setHovered(day)}
                onFocus={() => setHovered(day)}
                aria-pressed={inside}
                aria-label={studied.has(day)
                  ? `${formatDay(day)} — ${ru.changeOverTime.dayHasWork}`
                  : formatDay(day)}
              >
                {index + 1}
              </button>
            </span>
          );
        })}
      </div>

      <div className="calFoot">
        <span className="muted">
          {range === null
            ? ru.changeOverTime.rangeStart
            : anchor !== null
              ? ru.changeOverTime.rangeEnd
              : range.from === range.to
                ? formatDay(range.from)
                : `${formatDay(range.from)} — ${formatDay(range.to)}`}
        </span>
        <button type="button" className="secondary" onClick={clear} disabled={range === null}>
          {ru.changeOverTime.rangeClear}
        </button>
      </div>
    </div>
  );
}
