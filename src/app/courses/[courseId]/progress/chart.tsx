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
import { spanChart, type Series } from '../../../../progress/series.ts';

// The viewBox the chart is drawn in. Fixed units, scaled by CSS: the shape is
// arithmetic and the size is a layout question, and mixing the two is what makes
// a hand-rolled chart hard to change.
const WIDTH = 640;
const HEIGHT = 260;
const PAD = { top: 16, right: 116, bottom: 34, left: 40 };

const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;

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

export function ChangeOverTime({ lessons }: { lessons: LessonErrorCounts[] }) {
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, lessons.length - 1));

  if (lessons.length === 0) return <p className="muted">{ru.changeOverTime.noLessons}</p>;

  const chart = spanChart(lessons, from, to);

  const pickers = (
    <p className="actions spanPickers">
      <label className="inline">
        <span>{ru.changeOverTime.from}{': '}</span>
        <select value={String(from)} onChange={(e) => setFrom(Number(e.target.value))}>
          {lessons.map((lesson, index) => (
            <option key={lesson.lessonId} value={index}>{lesson.title}</option>
          ))}
        </select>
      </label>
      <label className="inline">
        <span>{ru.changeOverTime.to}{': '}</span>
        <select value={String(to)} onChange={(e) => setTo(Number(e.target.value))}>
          {lessons.map((lesson, index) => (
            <option key={lesson.lessonId} value={index}>{lesson.title}</option>
          ))}
        </select>
      </label>
    </p>
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
            <SeriesLine key={line.type} line={line} index={index} x={x} y={y} />
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
  line, index, x, y,
}: {
  line: Series;
  index: number;
  x: (index: number) => number;
  y: (value: number) => number;
}) {
  const style = STYLES[index % STYLES.length]!;
  const last = line.points.length - 1;

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
          a swatch to a line is the step where two similar hues get confused. */}
      <text className="seriesLabel" x={x(last) + 10} y={y(line.points[last]!) + 4}>
        {errorTypeLabel(line.type)}
      </text>
    </g>
  );
}
