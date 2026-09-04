'use client';

// Change over time: the Error Types of a chosen span of Lessons, drawn.
//
// **Hand-rolled inline SVG, and no charting library.** Four screens on a
// single-tenant ARM box do not justify a dependency, a bundle and an upgrade
// path — and every chart here is a handful of rectangles and a line. design.md
// § Interface's restraint is the same argument from the other side.
//
// **Never colour alone.** The error-highlight states already have to hold in
// light and dark beside Cyrillic and Latin; a chart with several series has that
// problem twice over. Each line therefore carries three separate distinctions —
// its own hue, its own dash pattern, and its own marker shape — and is labelled
// at its right-hand end, so it is readable in monochrome, in either theme, and by
// somebody who cannot tell two of the hues apart.
//
// **And the numbers stay available as text.** A picture is not a report and a
// screen reader cannot read a `<path>`, so the counts are tabulated underneath
// rather than replaced by the drawing.

import { useState } from 'react';
import { ru, errorTypeLabel } from '../../../../ru.ts';
import type { LessonErrorCounts } from '../../../../progress/errors.ts';
import type { LessonActivity } from '../../../../progress/activity.ts';
import { spanChart, type Series } from '../../../../progress/series.ts';
import { LessonPicker, type PickableLesson } from './lesson-picker.tsx';

// The viewBox the chart is drawn in. Fixed units, scaled by CSS: the shape is
// arithmetic and the size is a layout question, and mixing the two is what makes
// a hand-rolled chart hard to change.
// The viewBox is what everything on the chart is measured in, including the
// type — the SVG fills the frame's width whatever these say, so a wider box is a
// *smaller* picture on screen. That is the constraint the gutter is traded
// against: the labels are Russian, «Согласование подлежащего и сказуемого» is
// thirty-six characters, and the old 116-unit gutter cut it off mid-word. 190
// holds a readable prefix of the longest of them while costing about a tenth of
// the drawing's apparent size, and the height goes up rather than down so the
// plot does not end up a letterbox.
const WIDTH = 700;
const HEIGHT = 300;
const PAD = { top: 16, right: 190, bottom: 34, left: 40 };

const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;

/**
 * The least vertical room two labels may have between them.
 *
 * A label is set at `--text-xs`, which is 13 of these units; 15 is that plus
 * enough of a gap to read as two lines rather than as one smudge.
 */
const LABEL_GAP = 15;

/**
 * How many characters of an Error Type's name are set at the end of its line.
 *
 * The full name is always in the table underneath — which is why the cap costs
 * nothing and why it is a cap rather than a smaller type size. Sized to the
 * gutter above at roughly seven units a character.
 */
const LABEL_CHARS = 26;

function shortLabel(label: string): string {
  return label.length <= LABEL_CHARS ? label : `${label.slice(0, LABEL_CHARS - 1).trimEnd()}…`;
}

/**
 * Where each label actually goes, given where each would like to go.
 *
 * Two Error Types that end the span on the same count end their lines at the
 * same height, and two labels at the same height are one unreadable label. So
 * the wanted positions are swept in order and pushed apart to `LABEL_GAP`, then
 * the whole column is shifted back inside the plot if the sweep ran it off the
 * bottom. Order is preserved throughout: a label that belongs to the higher line
 * stays above one that belongs to the lower, which is what keeps the picture
 * honest after the nudging.
 */
function spread(wanted: readonly number[]): number[] {
  const order = wanted.map((y, index) => ({ y, index }))
    .sort((a, b) => a.y - b.y);

  let previous = -Infinity;
  const placed = order.map(({ y, index }) => {
    const at = Math.max(y, previous + LABEL_GAP);
    previous = at;
    return { at, index };
  });

  // The sweep only ever pushes downwards, so it can run past the bottom of the
  // plot. Sliding the whole column up by the overflow keeps every gap it just
  // made while bringing it back inside the frame.
  const overflow = (placed.at(-1)?.at ?? 0) - (HEIGHT - PAD.bottom);
  const shift = overflow > 0 ? overflow : 0;

  const result = new Array<number>(wanted.length);
  for (const { at, index } of placed) result[index] = Math.max(PAD.top, at - shift);
  return result;
}

/**
 * Six ways of being a different line, and each of the three properties is enough
 * on its own. The order matches the order the series arrive in, so the busiest
 * Error Type is always the solid one.
 */
const STYLES = [
  { dash: 'none', marker: 'circle' },
  { dash: '7 4', marker: 'square' },
  { dash: '2 3', marker: 'triangle' },
  { dash: '10 3 2 3', marker: 'diamond' },
  { dash: '5 3 1 3', marker: 'cross' },
  { dash: '1 4', marker: 'wedge' },
] as const;

type Marker = (typeof STYLES)[number]['marker'];

/** A shape at a data point, drawn about its centre. */
function Point({ x, y, marker }: { x: number; y: number; marker: Marker }) {
  const r = 4;
  switch (marker) {
    case 'square':
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} />;
    case 'triangle':
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y + r} ${x - r - 1},${y + r}`} />;
    case 'diamond':
      return <polygon points={`${x},${y - r - 1} ${x + r + 1},${y} ${x},${y + r + 1} ${x - r - 1},${y}`} />;
    case 'cross':
      return (
        <path
          d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}`}
          strokeWidth={2}
          fill="none"
        />
      );
    case 'wedge':
      return <polygon points={`${x - r - 1},${y - r} ${x + r + 1},${y - r} ${x},${y + r + 1}`} />;
    default:
      return <circle cx={x} cy={y} r={r} />;
  }
}

export function ChangeOverTime({
  lessons, worked,
}: {
  lessons: LessonErrorCounts[];
  /** When each Lesson was answered in, for the pickers' date filter. */
  worked: LessonActivity[];
}) {
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, lessons.length - 1));

  if (lessons.length === 0) return <p className="muted">{ru.changeOverTime.noLessons}</p>;

  const chart = spanChart(lessons, from, to);

  // The Lessons as the pickers see them: the number in the circle, the title,
  // and the days the Student worked. A Lesson nobody has answered in carries
  // nulls rather than being left out — it is still an end of a span, and a
  // picker that hid every unstarted Lesson would refuse to chart the future.
  const span: PickableLesson[] = lessons.map((lesson, index) => {
    const activity = worked.find((entry) => entry.lessonId === lesson.lessonId);
    return {
      index,
      position: lesson.position,
      title: lesson.title,
      firstAt: activity?.firstAt ?? null,
      lastAt: activity?.lastAt ?? null,
    };
  });

  const pickers = (
    <div className="spanPickers">
      <LessonPicker label={ru.changeOverTime.pickFrom} lessons={span} chosen={from} onChoose={setFrom} />
      <LessonPicker label={ru.changeOverTime.pickTo} lessons={span} chosen={to} onChoose={setTo} />
    </div>
  );

  // Said rather than drawn: an axis with nothing on it looks like a fault, and a
  // Student with no Errors on a span has been told something good.
  if (chart.errorsInSpan === 0) {
    return (
      <>
        <p className="muted">{ru.changeOverTime.hint}</p>
        {pickers}
        <p className="ok" role="status">{ru.changeOverTime.noErrors}</p>
      </>
    );
  }

  // One Lesson is a point rather than a line, so it sits in the middle of the
  // plot instead of hard against the left edge.
  const columns = chart.lessons.length;
  const x = (index: number) =>
    PAD.left + (columns === 1 ? PLOT_WIDTH / 2 : (index / (columns - 1)) * PLOT_WIDTH);
  const y = (value: number) => PAD.top + PLOT_HEIGHT - (value / chart.maximum) * PLOT_HEIGHT;

  // Where each line's name is set. Two Error Types that end the span on the same
  // count would otherwise be labelled at the same height, one on top of the
  // other — which is what «Заглавная буква» and «Пропущено слово» were doing.
  const labelYs = spread(chart.series.map((line) => y(line.points.at(-1)!) + 4));

  // Whole numbers only: half an Error is not a thing that happened.
  const ticks = Array.from(
    { length: Math.min(chart.maximum, 5) + 1 },
    (_, index) => Math.round((index / Math.min(chart.maximum, 5)) * chart.maximum),
  ).filter((value, index, all) => all.indexOf(value) === index);

  return (
    <>
      <p className="muted">{ru.changeOverTime.hint}</p>
      {pickers}

      {chart.series.length < chart.totals.length ? (
        <p className="muted">
          {ru.changeOverTime.shownSeries(chart.series.length, chart.totals.length)}
        </p>
      ) : null}

      <div className="chartFrame">
        <svg
          className="chart"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${ru.changeOverTime.title}. ${ru.changeOverTime.tableCaption}.`}
        >
          {/* The grid, and the counts up the side. Behind everything, and never
              the thing the eye lands on. */}
          {ticks.map((value) => (
            <g key={value} className="grid">
              <line x1={PAD.left} x2={PAD.left + PLOT_WIDTH} y1={y(value)} y2={y(value)} />
              <text x={PAD.left - 8} y={y(value) + 4} textAnchor="end">{value}</text>
            </g>
          ))}

          {chart.lessons.map((lesson, index) => (
            <text
              key={lesson.lessonId}
              className="axis"
              x={x(index)}
              y={HEIGHT - PAD.bottom + 20}
              textAnchor="middle"
            >
              {ru.changeOverTime.lessonShort(lesson.position)}
            </text>
          ))}

          {chart.series.map((line, index) => (
            <SeriesLine
              key={line.type}
              line={line}
              index={index}
              x={x}
              y={y}
              labelY={labelYs[index]!}
            />
          ))}
        </svg>
      </div>

      {/* A picture is not a report: the same numbers, as text. */}
      <table className="histogram spanTable">
        <caption className="muted">{ru.changeOverTime.tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{ru.errorStats.typeHeading}</th>
            {chart.lessons.map((lesson) => (
              <th key={lesson.lessonId} scope="col">{ru.changeOverTime.lessonShort(lesson.position)}</th>
            ))}
            <th scope="col">{ru.changeOverTime.total}</th>
          </tr>
        </thead>
        <tbody>
          {chart.totals.map((entry) => (
            <tr key={entry.type}>
              <th scope="row">{errorTypeLabel(entry.type)}</th>
              {chart.lessons.map((lesson) => (
                <td key={lesson.lessonId}>
                  {lesson.counts.find((count) => count.type === entry.type)?.count ?? 0}
                </td>
              ))}
              <td><strong>{entry.count}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="muted">{ru.changeOverTime.testsExcluded}</p>
    </>
  );
}

function SeriesLine({
  line, index, x, y, labelY,
}: {
  line: Series;
  index: number;
  x: (index: number) => number;
  y: (value: number) => number;
  /** Where this line's name is set, after the labels have been pushed apart. */
  labelY: number;
}) {
  const style = STYLES[index % STYLES.length]!;
  const last = line.points.length - 1;
  const endX = x(last);
  const endY = y(line.points[last]!);
  const full = errorTypeLabel(line.type);
  // Only where the label had to be moved to make room. A leader from a label
  // sitting exactly where its line ends would be a line pointing at itself.
  const moved = Math.abs(labelY - (endY + 4)) > 2;

  return (
    <g className={`series s${index + 1}`}>
      <path
        className="line"
        fill="none"
        strokeDasharray={style.dash}
        d={line.points.map((value, at) => `${at === 0 ? 'M' : 'L'}${x(at)} ${y(value)}`).join(' ')}
      />
      {line.points.map((value, at) => (
        <Point key={at} x={x(at)} y={y(value)} marker={style.marker} />
      ))}
      {/* Labelled at its own end rather than in a legend somewhere else: matching
          a swatch to a line is the step where two similar hues get confused.

          Where the label was nudged clear of a neighbour, a hairline joins it
          back to the point it belongs to — the nudge is what makes two labels
          readable, and this is what stops it making them ambiguous. */}
      {moved ? (
        <path className="leader" fill="none" d={`M${endX + 3} ${endY}L${endX + 8} ${labelY - 4}`} />
      ) : null}
      <text className="seriesLabel" x={endX + 10} y={labelY}>
        {/* The name in full for anyone reading the markup or hovering it; the
            picture gets as much of it as the gutter holds, and the table under
            the chart always carries the whole thing. */}
        <title>{full}</title>
        {shortLabel(full)}
      </text>
    </g>
  );
}
