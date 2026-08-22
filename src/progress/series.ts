// A span of Lessons, and the Error Types drawn across it.
//
// The same counts as the histogram, read as a shape rather than as a table: the
// question stops being "how many article mistakes are there" and becomes "are
// there fewer of them than there were". It is the only view in the application
// that answers whether the studying is working.
//
// Pure over rows the caller has already read, so the span arithmetic — which is
// the only part with an off-by-one in it — is testable without a database and
// without a browser.

import { byCountThenType, type ErrorCount, type LessonErrorCounts } from './errors.ts';

/**
 * How many Error Types are drawn at once.
 *
 * Six, and the rest are in the table beside the chart. A line per Error Type over
 * an enum of twenty is not a chart, it is a plate of spaghetti — and the reason
 * the numbers stay available as text is exactly so the cap costs nothing.
 */
export const MAX_SERIES = 6;

export type Series = {
  /** The stable enum value. The Russian label is resolved at display time. */
  type: string;
  /** One count per Lesson in the span, in the span's order. Zero where none. */
  points: number[];
  total: number;
};

export type SpanChart = {
  /** The Lessons actually charted, in Course order. */
  lessons: LessonErrorCounts[];
  /** The Error Types drawn, largest total in the span first. */
  series: Series[];
  /** Every Error Type in the span with its total, including the undrawn ones. */
  totals: ErrorCount[];
  /** The top of the Y axis. At least 1, so an all-zero span is not a degenerate scale. */
  maximum: number;
  /** Every Error in the span, added up. Zero is what makes the chart say so. */
  errorsInSpan: number;
};

/**
 * Clamps a requested span to the Lessons that exist, and puts it the right way
 * round.
 *
 * A span chosen from two selects can be back to front, and the honest reading of
 * "from Lesson 5 to Lesson 2" is the same span the other way — refusing it would
 * be refusing a request that has an obvious meaning.
 */
export function normaliseSpan(
  count: number,
  from: number,
  to: number,
): { from: number; to: number } {
  if (count === 0) return { from: 0, to: -1 };

  const clamp = (value: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), count - 1);
  const low = clamp(from);
  const high = clamp(to);
  return low <= high ? { from: low, to: high } : { from: high, to: low };
}

export function spanChart(
  lessons: readonly LessonErrorCounts[],
  from: number,
  to: number,
  limit = MAX_SERIES,
): SpanChart {
  const span = normaliseSpan(lessons.length, from, to);
  const chosen = lessons.slice(span.from, span.to + 1);

  // Every type that occurs anywhere in the span, with its total across it.
  const totals = new Map<string, { language: ErrorCount['language']; count: number }>();
  for (const lesson of chosen) {
    for (const entry of lesson.counts) {
      const current = totals.get(entry.type);
      if (current) current.count += entry.count;
      else totals.set(entry.type, { language: entry.language, count: entry.count });
    }
  }

  // The histogram's order, deliberately: the busiest Error Type must be the same
  // one on both, and it is always the solid line.
  const ordered: ErrorCount[] = [...totals]
    .map(([type, { language, count }]) => ({ type, language, count }))
    .sort(byCountThenType);

  const series: Series[] = ordered.slice(0, limit).map((entry) => ({
    type: entry.type,
    points: chosen.map((lesson) =>
      lesson.counts.find((count) => count.type === entry.type)?.count ?? 0),
    total: entry.count,
  }));

  const maximum = Math.max(1, ...series.flatMap((line) => line.points));
  const errorsInSpan = ordered.reduce((sum, entry) => sum + entry.count, 0);

  return { lessons: chosen, series, totals: ordered, maximum, errorsInSpan };
}
