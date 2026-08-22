// Seam 1 — the progress screen, driven over HTTP.
//
// The claim this file exists for is the one #48 settles once for the three
// statistics screens: a Student sees their own, an Admin sees any Student's, and
// everything else is a 404. It is asserted at the HTTP seam because a rule that
// only hides a link is not a rule — the address has to refuse.
//
// The numbers are asserted here too, and the split that matters most is Completed
// With Help as its own segment: a Student who revealed their way through half a
// Course should be able to see that they did.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, type BootedApp } from './helpers/app.ts';
import type { SeedAccount } from '../src/db/seed.ts';
import { ru, errorTypeLabel } from '../src/ru.ts';
import { DETERMINISTIC_COURSE, OTHER_COURSE } from './helpers/fixtures.ts';
import {
  courseIdFor, lessonsOf, studentIdFor, testsOf, unenroll, withDatabase,
} from './helpers/inspect.ts';
import { submissionErrors, submissions } from '../src/db/schema.ts';
import { readFileSync } from 'node:fs';
import type { Frame, ResultFrame } from '../src/practice/wire.ts';

const STUDENTS: SeedAccount[] = Array.from({ length: 26 }, (_, i) => ({
  username: `walker${i + 1}`, password: 'staple monkey trombone', isAdmin: false,
}));

let app: BootedApp;
let courseId: number;

before(async () => {
  app = await bootApp({
    accounts: [ADMIN, ...STUDENTS],
    content: [DETERMINISTIC_COURSE, OTHER_COURSE],
  });
  courseId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

let nextAccount = 0;
type SignedIn = Client & { username: string };

async function signedIn(): Promise<SignedIn> {
  const account = STUDENTS[nextAccount++];
  if (!account) throw new Error('the suite ran out of Students — add more to STUDENTS');
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(account.username, account.password)).status, 303);
  return Object.assign(client, { username: account.username });
}

async function asAdmin(): Promise<Client> {
  const admin = new Client(app.baseUrl);
  assert.equal((await admin.signIn(ADMIN.username, ADMIN.password)).status, 303);
  return admin;
}

function firstLesson() {
  return lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[0]!;
}

async function answer(client: Client, exerciseId: number, text: string): Promise<ResultFrame> {
  const response = await client.fetch(`/api/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: text }),
  });
  assert.ok(response.ok, `answering was refused with ${response.status}`);
  const frames = (await response.text()).split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Frame);
  const result = frames.find((f): f is ResultFrame => f.t === 'result');
  assert.ok(result);
  return result;
}

async function progressHtml(client: Client, student?: number): Promise<string> {
  const suffix = student === undefined ? '' : `?student=${student}`;
  const response = await client.fetch(`/courses/${courseId}/progress${suffix}`);
  assert.equal(response.status, 200, 'the progress screen opened');
  return response.text();
}

test('a Student can open a progress screen for a Course they are enrolled in', async () => {
  const client = await signedIn();
  const html = await progressHtml(client);

  assert.ok(html.includes(ru.progress.title));
  for (const lesson of DETERMINISTIC_COURSE.lessons) {
    assert.ok(html.includes(lesson.title), `${lesson.title} is listed`);
  }
});

test('each Lesson shows completion as a percentage', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();

  // One of three, unaided.
  await answer(client, exercises[0]!.id, 'a');

  const html = await progressHtml(client);
  assert.ok(html.includes(ru.progress.percent(33)), 'one of three is 33%');
});

test('Completed With Help is its own segment rather than folded in', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();

  // Three failures, then Reveal — the only way to reach Completed With Help.
  for (let i = 0; i < 3; i += 1) await answer(client, exercises[0]!.id, 'zzz');
  assert.ok((await client.fetch(`/api/exercises/${exercises[0]!.id}/reveal`, { method: 'POST' })).ok);

  const html = await progressHtml(client);
  assert.ok(
    html.includes(ru.progress.breakdown(0, 1, 3)),
    'nothing unaided, one with help — counted apart, not added together',
  );
  assert.match(html, /segment completed_with_help/, 'and drawn apart on the bar too');
});

test('the Course as a whole is shown on the same terms', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();
  await answer(client, exercises[0]!.id, 'a');

  const html = await progressHtml(client);
  assert.ok(html.includes(ru.progress.courseTotal));
  // Four Exercises across the fixture's two Lessons, one of them done.
  assert.ok(html.includes(ru.progress.breakdown(1, 0, 4)), 'the Course, summed from the Lessons');
});

test('Test attempts are summarised beside the Lessons, each with its score', async () => {
  const admin = await asAdmin();
  const created = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Контрольная по прогрессу' }),
  });
  const { testId } = await created.json() as { testId: number };

  await admin.fetch(`/api/admin/tests/${testId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Контрольная по прогрессу',
      passThreshold: 80,
      exercises: [{
        kind: 'fill_gap',
        prompt: 'Вставьте артикль: I saw ___ bird.',
        referenceAnswer: 'a',
        acceptedAnswers: ['a'],
        choices: [],
        caseSensitive: false,
      }],
    }),
  });
  await admin.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });

  const exerciseId = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!.exercises[0]!.id;

  const client = await signedIn();
  const sat = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [{ exerciseId, answer: 'a' }] }),
  });
  assert.equal(sat.status, 200, 'the attempt was accepted');

  const html = await progressHtml(client);
  assert.ok(html.includes(ru.progress.attemptLine('Контрольная по прогрессу', 1)));
  assert.ok(html.includes(ru.test.score(1, 1, 100)), 'with its score');
});

test('a Course with nothing done yet is 0%, not a blank or a NaN', async () => {
  const client = await signedIn();
  const html = await progressHtml(client);
  assert.ok(html.includes(ru.progress.percent(0)));
  assert.ok(!html.includes('NaN'));
});

// --- Who sees whose ----------------------------------------------------------

test('a Student cannot open anyone else’s', async () => {
  const mine = await signedIn();
  const theirs = await signedIn();
  const theirId = studentIdFor(app.databasePath, theirs.username);

  const response = await mine.fetch(`/courses/${courseId}/progress?student=${theirId}`);
  assert.equal(response.status, 404, 'and it is missing rather than forbidden');
});

test('a Student naming themselves is naming nobody', async () => {
  const client = await signedIn();
  const ownId = studentIdFor(app.databasePath, client.username);

  const response = await client.fetch(`/courses/${courseId}/progress?student=${ownId}`);
  assert.equal(response.status, 200);
});

test('a Student who names an account that does not exist gets the same 404', async () => {
  const client = await signedIn();
  const response = await client.fetch(`/courses/${courseId}/progress?student=999999`);
  // Deliberately the same answer as naming a real account: the refusal must not
  // be a way of finding out which accounts exist.
  assert.equal(response.status, 404);
});

test('a Course the Student is not enrolled in is a 404', async () => {
  const client = await signedIn();
  const otherId = courseIdFor(app.databasePath, OTHER_COURSE.title);
  unenroll(app.databasePath, client.username, OTHER_COURSE.title);

  assert.equal((await client.fetch(`/courses/${otherId}/progress`)).status, 404);
});

test('an Admin can open the same screen for any Student, and it names whose it is', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();
  await answer(client, exercises[0]!.id, 'a');

  const admin = await asAdmin();
  const theirId = studentIdFor(app.databasePath, client.username);
  const html = await progressHtml(admin, theirId);

  assert.ok(
    html.includes(ru.progress.viewingStudent(client.username)),
    'a screen that does not say whose it is invites a decision about the wrong person',
  );
  assert.ok(html.includes(ru.progress.percent(33)), 'and it is their numbers, not the Admin’s');
});

test('an Admin looking at a Student not enrolled in the Course still gets a 404', async () => {
  const client = await signedIn();
  unenroll(app.databasePath, client.username, DETERMINISTIC_COURSE.title);
  const theirId = studentIdFor(app.databasePath, client.username);

  const admin = await asAdmin();
  // The *viewed* Student's Enrollment is what decides it, never the viewer's: a
  // record of a Course nobody is enrolled in is a record of nothing.
  const response = await admin.fetch(`/courses/${courseId}/progress?student=${theirId}`);
  assert.equal(response.status, 404);
});

// --- The Error Type histogram, and the chart over a span ---------------------
//
// Both sections are rendered from the same counts and both are asserted on the
// page, because #49 and #50 are screens rather than functions — the arithmetic
// behind them has its own files at seam 2.

/**
 * Errors on a Practice answer, written straight into the booted application's
 * database.
 *
 * Every Exercise in this fixture is judged in code, and a Deterministic Check
 * produces no Errors at all — so a hermetic suite has no other way to put one
 * there. What is under test is the counting and the drawing, not what produced
 * the rows.
 */
function giveErrors(username: string, exerciseId: number, types: readonly string[]): void {
  const whose = studentIdFor(app.databasePath, username);
  withDatabase(app.databasePath, (db) => {
    const highest = db.select().from(submissions).all()
      .filter((row) => row.studentId === whose && row.exerciseId === exerciseId)
      .reduce((most, row) => Math.max(most, row.attempt), 0);

    const submission = db.insert(submissions).values({
      studentId: whose,
      exerciseId,
      attempt: highest + 1,
      answer: 'что-то не то',
      testAttemptId: null,
      status: 'graded',
      failureReason: null,
      proposedVerdict: 'incorrect',
      guardedVerdict: 'incorrect',
      feedbackRu: 'Есть ошибки.',
      corrected: null,
      createdAt: new Date(),
    }).returning().get();

    types.forEach((type, index) => {
      db.insert(submissionErrors).values({
        submissionId: submission.id, position: index + 1,
        type, span: 'фрагмент', explanationRu: 'Объяснение.',
      }).run();
    });
  });
}

test('a Course with no Errors yet says so rather than rendering an empty table', async () => {
  const client = await signedIn();
  const html = await progressHtml(client);

  assert.ok(html.includes(ru.errorStats.none));
  assert.ok(!html.includes('<table'), 'and draws no table at all');
});

test('a Student sees their Errors counted by Error Type, largest count first', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();

  giveErrors(client.username, exercises[0]!.id, ['article', 'article', 'tense']);
  giveErrors(client.username, exercises[0]!.id, ['article']);

  const html = await progressHtml(client);

  assert.ok(html.includes(ru.errorStats.count(3)), '«артикли — 3 ошибки»');
  assert.ok(html.includes(errorTypeLabel('article')), 'and the label is resolved at display time');
  assert.ok(
    html.indexOf(errorTypeLabel('article')) < html.indexOf(errorTypeLabel('tense')),
    'largest count first: the question this answers is what to work on next',
  );
});

test('an Error Type outside the enum reaches the screen as it came', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();
  giveErrors(client.username, exercises[0]!.id, ['небывалый_тип']);

  const html = await progressHtml(client);
  assert.ok(html.includes('небывалый_тип'), 'dropping it would hide a real fault');
});

test('a span with no Errors says so rather than rendering as a broken chart', async () => {
  const client = await signedIn();
  const html = await progressHtml(client);

  assert.ok(html.includes(ru.changeOverTime.noErrors));
  assert.ok(!html.includes('<svg'), 'and nothing is drawn');
});

test('a span of Lessons can be chosen, and its Error Types are charted', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();
  giveErrors(client.username, exercises[0]!.id, ['article', 'tense']);
  giveErrors(client.username, exercises[1]!.id, ['article']);

  const html = await progressHtml(client);

  assert.ok(html.includes(ru.changeOverTime.from), 'the span has two ends to choose');
  assert.ok(html.includes(ru.changeOverTime.to));
  assert.ok(html.includes('<svg'), 'and the span is drawn');
  assert.ok(html.includes(ru.changeOverTime.tableCaption), 'with the same numbers as text beside it');
});

test('series are distinguishable without relying on colour alone', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();
  giveErrors(client.username, exercises[0]!.id, ['article', 'article', 'tense', 'spelling']);

  const html = await progressHtml(client);

  // Three lines, and each carries its own dash pattern and its own marker shape
  // as well as its own hue. Any one of the three is enough on its own, so the
  // chart survives monochrome and a reader who cannot tell two hues apart.
  const dashes = [...html.matchAll(/stroke-dasharray="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(dashes.length >= 2, 'the lines are dashed differently');
  assert.equal(new Set(dashes).size, dashes.length, 'and no two share a pattern');

  assert.ok(/<circle/.test(html) && /<rect/.test(html) && /<polygon/.test(html),
    'and the markers are different shapes');

  // Named at its own end rather than in a legend elsewhere: matching a swatch to
  // a line is the step where two similar hues get confused.
  assert.ok(html.includes('seriesLabel'));
});

test('the chart holds in both themes, and adds no charting dependency', () => {
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  // Every colour the chart draws with is a token, and every token is redefined
  // for the dark theme — the same rule the error-highlight states already keep.
  for (let n = 1; n <= 6; n += 1) {
    const declarations = [...css.matchAll(new RegExp(`--series-${n}:`, 'g'))];
    assert.equal(declarations.length, 2, `--series-${n} is defined for both themes`);
  }
  assert.match(css, /prefers-color-scheme: dark/);

  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies: Record<string, string> };

  // Four screens on a single-tenant ARM box do not justify a dependency, a
  // bundle and an upgrade path — every chart here is a handful of rectangles
  // and a line.
  for (const name of Object.keys(manifest.dependencies)) {
    assert.ok(
      !/chart|d3|plotly|recharts|vega|echarts|nivo|victory/i.test(name),
      `${name} looks like a charting library`,
    );
  }
});

test('an Admin sees the target Student’s Errors, not their own', async () => {
  const theirs = await signedIn();
  const { exercises } = firstLesson();

  // The Student under review has article mistakes; the Admin has a different
  // Error entirely. `errorsOfCourse` takes a studentId as a bare parameter, so
  // this is exactly the swap that would otherwise go unnoticed.
  giveErrors(theirs.username, exercises[0]!.id, ['article', 'article', 'article']);
  giveErrors(ADMIN.username, exercises[0]!.id, ['punctuation']);

  const admin = await asAdmin();
  const theirId = studentIdFor(app.databasePath, theirs.username);
  const html = await progressHtml(admin, theirId);

  assert.ok(html.includes(ru.progress.viewingStudent(theirs.username)), 'and it names whose');
  assert.ok(html.includes(errorTypeLabel('article')), 'their Errors are counted');
  assert.ok(html.includes(ru.errorStats.count(3)));
  assert.ok(
    !html.includes(errorTypeLabel('punctuation')),
    'and the Admin’s own Errors are nowhere on the Student’s record',
  );
});

test('an Admin sees the target Student’s chart, not their own', async () => {
  const theirs = await signedIn();
  const { exercises } = firstLesson();

  giveErrors(theirs.username, exercises[0]!.id, ['tense', 'tense']);
  giveErrors(theirs.username, exercises[1]!.id, ['tense']);

  const admin = await asAdmin();
  const theirId = studentIdFor(app.databasePath, theirs.username);
  const html = await progressHtml(admin, theirId);

  assert.ok(html.includes('<svg'), 'the span is drawn for the Student under review');
  assert.ok(html.includes(errorTypeLabel('tense')), 'from their counts');

  // And the Admin's own record, at the same address without the parameter, is a
  // different chart — which is what makes the one above theirs rather than a
  // coincidence. The Admin's own Error here is the punctuation one the previous
  // test gave them; the tense mistakes are the Student's alone.
  const ownHtml = await progressHtml(admin);
  assert.ok(ownHtml.includes(errorTypeLabel('punctuation')), 'the Admin sees their own');
  assert.ok(!ownHtml.includes(errorTypeLabel('tense')), 'and never the Student’s');
});
