// Seam 2 — the span arithmetic behind the chart, with no database and no browser.
//
// The chart itself is a handful of rectangles and a line, drawn by hand because
// four screens on a single-tenant ARM box do not justify a charting dependency.
// What is worth testing is not the drawing but the arithmetic under it: which
// Lessons a span covers, which Error Types get a line, and what the axis is
// scaled against. An off-by-one there draws a chart that is wrong and looks fine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SERIES, normaliseSpan, spanChart } from '../src/progress/series.ts';
import type { LessonErrorCounts } from '../src/progress/errors.ts';

function lesson(position: number, counts: Record<string, number>): LessonErrorCounts {
  return {
    lessonId: position * 10,
    position,
    title: `Урок ${position}`,
    counts: Object.entries(counts)
      .map(([type, count]) => ({ type, language: 'en' as const, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

// Article mistakes falling away, tense mistakes holding steady: exactly the
// question the chart exists to answer.
const FOUR = [
  lesson(1, { article: 6, tense: 2 }),
  lesson(2, { article: 4, tense: 2, spelling: 1 }),
  lesson(3, { article: 2, tense: 3 }),
  lesson(4, { article: 1, tense: 2 }),
];

test('a span covers the Lessons between its ends, both included', () => {
  const chart = spanChart(FOUR, 1, 2);
  assert.deepEqual(chart.lessons.map((l) => l.position), [2, 3]);
});

test('the whole Course is a span like any other', () => {
  const chart = spanChart(FOUR, 0, FOUR.length - 1);
  assert.deepEqual(chart.lessons.map((l) => l.position), [1, 2, 3, 4]);
});

test('a span given back to front means the same span', () => {
  // Two selects can be set either way round, and "from Lesson 4 to Lesson 2" has
  // an obvious meaning — refusing it would be refusing a clear request.
  assert.deepEqual(normaliseSpan(4, 3, 1), { from: 1, to: 3 });
  assert.deepEqual(
    spanChart(FOUR, 3, 1).lessons.map((l) => l.position),
    [2, 3, 4],
  );
});

test('a span reaching past the Course is clamped to it', () => {
  assert.deepEqual(normaliseSpan(4, -5, 99), { from: 0, to: 3 });
  assert.deepEqual(normaliseSpan(4, Number.NaN, Number.NaN), { from: 0, to: 0 });
});

test('a Course with no Lessons yields an empty span rather than a negative one', () => {
  const chart = spanChart([], 0, 5);
  assert.deepEqual(chart.lessons, []);
  assert.deepEqual(chart.series, []);
  assert.equal(chart.errorsInSpan, 0);
});

test('each series carries one point per Lesson in the span, zero where there were none', () => {
  const chart = spanChart(FOUR, 0, 3);

  const spelling = chart.series.find((line) => line.type === 'spelling');
  assert.ok(spelling, 'a type that occurs anywhere in the span gets a line');
  assert.deepEqual(
    spelling.points, [0, 1, 0, 0],
    'a Lesson with none of that Error is a zero, not a gap in the line',
  );
});

test('the series are ordered by their total across the span, largest first', () => {
  const chart = spanChart(FOUR, 0, 3);
  assert.deepEqual(
    chart.series.map((line) => [line.type, line.total]),
    [['article', 13], ['tense', 9], ['spelling', 1]],
  );
});

test('the article line falls and the tense line does not — which is the whole point', () => {
  const chart = spanChart(FOUR, 0, 3);
  assert.deepEqual(chart.series.find((l) => l.type === 'article')!.points, [6, 4, 2, 1]);
  assert.deepEqual(chart.series.find((l) => l.type === 'tense')!.points, [2, 2, 3, 2]);
});

test('the axis is scaled to the largest single count in the span', () => {
  assert.equal(spanChart(FOUR, 0, 3).maximum, 6);
  assert.equal(spanChart(FOUR, 2, 3).maximum, 3, 'and to the span, not to the Course');
});

test('an empty span scales to one rather than to zero', () => {
  const chart = spanChart([lesson(1, {}), lesson(2, {})], 0, 1);
  assert.equal(chart.errorsInSpan, 0, 'which is what makes the chart say so instead of drawing');
  assert.equal(chart.maximum, 1, 'and never divides by zero on the way there');
});

test('only the largest few types get a line, and the rest are still counted', () => {
  const crowded = [lesson(1, {
    article: 9, tense: 8, spelling: 7, punctuation: 6, preposition: 5,
    capitalization: 4, missing_word: 3, extra_word: 2,
  })];

  const chart = spanChart(crowded, 0, 0);
  assert.equal(chart.series.length, MAX_SERIES, 'a line per type over an enum of twenty is not a chart');
  assert.equal(chart.totals.length, 8, 'but every type is in the numbers beside it');
  assert.equal(chart.errorsInSpan, 44, 'including the ones with no line');
  assert.deepEqual(
    chart.series.map((line) => line.type),
    ['article', 'tense', 'spelling', 'punctuation', 'preposition', 'capitalization'],
  );
});

test('a single-Lesson span is a span', () => {
  const chart = spanChart(FOUR, 2, 2);
  assert.deepEqual(chart.lessons.map((l) => l.position), [3]);
  assert.deepEqual(chart.series.find((l) => l.type === 'article')!.points, [2]);
});
