// Seam 1 — sitting a Test, driven over HTTP.
//
// Every Exercise here is judged in code, so the whole path — sit, submit, score,
// retake — is provable without a model, exactly as the Practice's progression is.
// What the Grader adds arrives in its own file, against an application that
// cannot reach one.
//
// The claim this file exists for is the one that makes a Test a Test: nothing is
// judged, revealed or said about any answer until the attempt is submitted — and
// that includes what is sitting in the page the browser was handed.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { DETERMINISTIC_COURSE, OTHER_COURSE } from './helpers/fixtures.ts';
import { attemptsOf, courseIdFor, testsOf, unenroll } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';
import type { AttemptView } from '../src/tests/wire.ts';

let app: BootedApp;
let courseId: number;
let testId: number;
let exerciseIds: number[] = [];
// A Test of its own for the multi-gap Exercise: the file's other Test is scored
// out of three, and a fourth Exercise would move every percentage in it.
let gapsTestId: number;
let gapsExerciseId: number;

const EXERCISES = [
  {
    kind: 'fill_gap',
    prompt: 'Вставьте артикль: I have ___ cat.',
    referenceAnswer: 'a',
    acceptedAnswers: [['a']],
    choices: [],
    caseSensitive: false,
  },
  {
    kind: 'multiple_choice',
    prompt: 'Выберите вариант: I have ___ apple.',
    referenceAnswer: 'an',
    acceptedAnswers: [['an']],
    choices: ['a', 'an', 'the'],
    caseSensitive: false,
  },
  {
    kind: 'word_order',
    prompt: 'Составьте предложение: is / a / this / cat',
    referenceAnswer: 'This is a cat',
    acceptedAnswers: [['This is a cat']],
    choices: ['is', 'a', 'this', 'cat'],
    caseSensitive: false,
  },
];

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  await client.signIn(who.username, who.password);
  return client;
}

before(async () => {
  app = await bootApp({ content: [DETERMINISTIC_COURSE, OTHER_COURSE] });
  courseId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);

  const admin = await signedIn(ADMIN);
  const created = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Контрольная работа' }),
  });
  testId = ((await created.json()) as { testId: number }).testId;

  const saved = await admin.fetch(`/api/admin/tests/${testId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Контрольная работа', passThreshold: 80, exercises: EXERCISES }),
  });
  assert.equal(saved.status, 200, 'the Exercises were written');
  await admin.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });

  exerciseIds = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!.exercises.map((exercise) => exercise.id);

  const gapsCreated = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Работа с пропусками' }),
  });
  gapsTestId = ((await gapsCreated.json()) as { testId: number }).testId;

  const gapsSaved = await admin.fetch(`/api/admin/tests/${gapsTestId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Работа с пропусками',
      passThreshold: 80,
      exercises: [{
        kind: 'fill_gap',
        prompt: 'Заполните пропуски: ___ have ___ apple.',
        referenceAnswer: 'I have an apple.',
        acceptedAnswers: [['I'], ['an']],
        choices: [],
        caseSensitive: false,
      }],
    }),
  });
  assert.equal(gapsSaved.status, 200, 'a multi-gap Exercise is saveable in a Test');
  await admin.fetch(`/api/admin/tests/${gapsTestId}/publish`, { method: 'POST' });

  gapsExerciseId = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === gapsTestId)!.exercises[0]!.id;
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

// One value per gap per Exercise. A bare string is the list of one that every
// Exercise with a single place to answer sends.
function answers(
  given: readonly (string | readonly string[])[],
): { answers: Array<{ exerciseId: number; answers: string[] }> } {
  return {
    answers: exerciseIds.map((exerciseId, index) => {
      const written = given[index] ?? '';
      return { exerciseId, answers: typeof written === 'string' ? [written] : [...written] };
    }),
  };
}

async function submit(client: Client, given: readonly string[]): Promise<number> {
  const response = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(answers(given)),
  });
  assert.equal(response.status, 200, 'the attempt was accepted');
  return ((await response.json()) as { attemptId: number }).attemptId;
}

async function attemptView(client: Client, attemptId: number): Promise<AttemptView> {
  const response = await client.fetch(`/api/tests/${testId}/attempts/${attemptId}`);
  assert.equal(response.status, 200);
  return ((await response.json()) as { view: AttemptView }).view;
}

/**
 * Whether any element on the page wears a state class.
 *
 * Anchored to a `class` attribute rather than searched for as a substring,
 * because the token layer's own names contain these: Mantine's variables are
 * resolved onto ours, so `--mantine-color-error: var(--state-incorrect-ink)`
 * appears in the document's inline style block and a plain `includes` matches it
 * on every screen. The question these assertions ask is what an element is drawn
 * as, so they ask about the attribute that decides it.
 */
function wears(html: string, state: string): boolean {
  return new RegExp(`class="[^"]*\\b${state}\\b`).test(html);
}

test('a published Test is listed in the Course and opens with nothing that answers it', async () => {
  const client = await signedIn(STUDENT);

  const course = await client.fetch(`/courses/${courseId}`);
  assert.equal(course.status, 200);
  assert.match(await course.text(), /Контрольная работа/, 'the Test is listed beside the Lessons');

  const page = await client.fetch(`/tests/${testId}`);
  assert.equal(page.status, 200);
  const html = await page.text();

  for (const exercise of EXERCISES) {
    assert.ok(html.includes(exercise.prompt), 'every Exercise is asked at once');
  }
  assert.ok(html.includes('the'), 'the options of a multiple choice are shown');
  // The answer key must not travel with the questions. `an` is an option and so
  // is on the page legitimately; what must not be there is any mark saying which
  // option is right, and no Reference Answer that is not itself an option.
  assert.ok(!html.includes('This is a cat'), 'no Reference Answer is in the page');
  assert.ok(!html.includes('acceptedAnswers'), 'and no accepted answers either');
  assert.ok(html.includes(ru.test.noFeedbackUntilSubmit), 'and the Student is told nothing is judged yet');
});

test('submitting scores the attempt in code, against the Test threshold', async () => {
  const client = await signedIn(STUDENT);
  const attemptId = await submit(client, ['a', 'the', 'This is a cat']);

  const view = await attemptView(client, attemptId);
  assert.equal(view.state, 'scored', 'every Exercise here is judged in code, so nothing is pending');
  assert.equal(view.correct, 2);
  assert.equal(view.total, 3);
  assert.equal(view.scorePercent, 67);
  assert.equal(view.passed, false, '67 does not clear 80');

  const wrong = view.exercises.find((exercise) => exercise.exerciseId === exerciseIds[1])!;
  assert.equal(wrong.correct, false);
  assert.equal(wrong.answer, 'the');
  assert.deepEqual(wrong.acceptedAnswers, [['an']], 'the review can mark the right option');
  assert.equal(wrong.referenceAnswer, 'an');

  const stored = attemptsOf(app.databasePath, STUDENT.username, testId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]!.submissions.length, 3, 'one Submission per Exercise, bound to the attempt');
  assert.equal(stored[0]!.attempt.passThreshold, 80, 'the threshold it was taken under, copied');
  assert.ok(stored[0]!.submissions.every((row) => row.status === 'graded'));
});

test('a faultless attempt reviews with every Exercise collapsed', async () => {
  const client = await signedIn(STUDENT);
  const attemptId = await submit(client, ['a', 'an', 'This is a cat']);

  const page = await client.fetch(`/tests/${testId}/attempts/${attemptId}`);
  assert.equal(page.status, 200);
  const html = await page.text();

  assert.ok(html.includes(ru.test.passed), '100% clears the threshold');
  assert.ok(html.includes(ru.states.correct), 'each Exercise says it was right');
  assert.ok(html.includes(ru.test.showExercise), 'and offers to open it');
  assert.ok(
    !html.includes(ru.test.hideExercise),
    'nothing is open: a review that makes a Student scroll past right answers is one nobody reads',
  );
});

test('a wrong Exercise reviews open, marked, and with the right option beside it', async () => {
  const client = await signedIn(STUDENT);
  // The multiple choice answered with an option that is not the accepted one.
  const attemptId = await submit(client, ['a', 'the', 'This is a cat']);

  const page = await client.fetch(`/tests/${testId}/attempts/${attemptId}`);
  const html = await page.text();

  assert.ok(html.includes(ru.states.incorrect), 'it says which one went wrong');
  assert.ok(html.includes(ru.test.hideExercise), 'and that one is open');
  assert.ok(html.includes(EXERCISES[1]!.prompt), 'so its prompt is rendered');
  // The chosen option is marked wrong and the accepted one right — the shape a
  // Deterministic Exercise fails in, where the token is exactly the point.
  assert.match(html, /class="state-incorrect">the</, 'the option that was chosen is marked');
  assert.match(html, /class="state-correct">an</, 'and the one that was correct is too');
  assert.ok(html.includes(ru.test.referenceAnswer), 'the attempt is closed, so the answer is shown');
});

test('retaking adds an attempt beside the earlier ones rather than replacing them', async () => {
  const client = await signedIn(STUDENT);
  await submit(client, ['a', 'an', 'This is a cat']);

  const stored = attemptsOf(app.databasePath, STUDENT.username, testId);
  assert.ok(stored.length >= 2, 'every attempt is kept');
  assert.deepEqual(
    stored.map((entry) => entry.attempt.attempt),
    stored.map((_, index) => index + 1),
    'numbered per Student and per Test',
  );

  const page = await client.fetch(`/tests/${testId}`);
  const html = await page.text();
  assert.ok(html.includes(ru.test.attemptNumber(1)));
  assert.ok(html.includes(ru.test.attemptNumber(stored.length)));
});

test('an unanswered Exercise is judged, not skipped', async () => {
  const client = await signedIn(STUDENT);
  const attemptId = await submit(client, ['', '', '']);

  const view = await attemptView(client, attemptId);
  assert.equal(view.correct, 0);
  assert.equal(view.scorePercent, 0);
  assert.equal(view.state, 'scored', 'submitting nothing is not answering, and needs no model to say so');
});

test('a Test gates nothing: Lesson unlocking is untouched by any of it', async () => {
  const client = await signedIn(STUDENT);
  await submit(client, ['a', 'an', 'This is a cat']);

  const course = await client.fetch(`/courses/${courseId}`);
  const html = await course.text();

  assert.ok(
    html.includes(ru.course.locked),
    'the second Lesson is still locked behind the first, whatever the Test says',
  );

  const secondLesson = await client.fetch('/lessons/2');
  assert.ok([403, 404].includes(secondLesson.status), 'and is still refused');
});

test('another Student’s attempt, an unpublished Test and a Course not theirs are all missing', async () => {
  const admin = await signedIn(ADMIN);
  const unpublished = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Ещё не опубликована' }),
  });
  const unpublishedId = ((await unpublished.json()) as { testId: number }).testId;

  const client = await signedIn(STUDENT);
  const hidden = await client.fetch(`/tests/${unpublishedId}`);
  assert.equal(hidden.status, 404, 'an unpublished Test is absent, not forbidden');

  const submitted = await client.fetch(`/api/tests/${unpublishedId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [] }),
  });
  assert.equal(submitted.status, 404, 'and cannot be sat through the endpoint either');

  // A Test in a Course this Student is not enrolled in.
  const otherCourseId = courseIdFor(app.databasePath, OTHER_COURSE.title);
  const other = await admin.fetch(`/api/admin/courses/${otherCourseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Чужая работа' }),
  });
  const otherId = ((await other.json()) as { testId: number }).testId;
  await admin.fetch(`/api/admin/tests/${otherId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Чужая работа', passThreshold: 80, exercises: [EXERCISES[0]] }),
  });
  await admin.fetch(`/api/admin/tests/${otherId}/publish`, { method: 'POST' });
  unenroll(app.databasePath, STUDENT.username, OTHER_COURSE.title);

  assert.equal((await client.fetch(`/tests/${otherId}`)).status, 404, 'its existence is not theirs to know');

  // And one Student's attempt is not another's to read.
  const mine = await submit(client, ['a', 'an', 'This is a cat']);
  const asAdmin = await admin.fetch(`/tests/${testId}/attempts/${mine}`);
  assert.equal(asAdmin.status, 404, 'even an Admin reads their own attempts only');
});

// --- #83: a multi-gap Exercise inside a Test ----------------------------------

async function sitGapsTest(client: Client, written: readonly string[]): Promise<AttemptView> {
  const response = await client.fetch(`/api/tests/${gapsTestId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [{ exerciseId: gapsExerciseId, answers: [...written] }] }),
  });
  assert.equal(response.status, 200);
  const { attemptId } = await response.json() as { attemptId: number };

  const review = await client.fetch(`/api/tests/${gapsTestId}/attempts/${attemptId}`);
  assert.equal(review.status, 200);
  return ((await review.json()) as { view: AttemptView }).view;
}

test('a multi-gap Exercise is answered in a Test and judged gap by gap', async () => {
  const client = await signedIn(STUDENT);

  // The same component asks the question in a Test as in a Practice, so the
  // inputs are the prompt's gaps here too.
  const page = await (await client.fetch(`/tests/${gapsTestId}`)).text();
  assert.equal((page.match(/class="gap"/g) ?? []).length, 2, 'one input per gap');
  const promptHtml = page.match(/<p class="prompt">[\s\S]*?<\/p>/)![0];
  assert.ok(!promptHtml.includes('___'), 'and no gap printed as literal text');

  const partly = await sitGapsTest(client, ['I', 'the']);
  const [answered] = partly.exercises;
  assert.equal(answered!.verdict, 'partially_correct');
  assert.deepEqual(answered!.gaps, [true, false], 'which gap was not accepted');
  assert.deepEqual(answered!.answerGaps, ['I', 'the']);
  assert.equal(answered!.answer, 'Заполните пропуски: I have the apple.',
    'the answer is stored and shown as the sentence, never as the two words');
  assert.equal(answered!.correct, false, 'partially correct does not score as correct');
  assert.equal(partly.scorePercent, 0);

  const whole = await sitGapsTest(client, ['I', 'an']);
  assert.equal(whole.exercises[0]!.verdict, 'correct');
  assert.deepEqual(whole.exercises[0]!.gaps, [true, true]);
  assert.equal(whole.scorePercent, 100);
});

test('the review shows a multi-gap answer as a sentence, with the wrong gap marked', async () => {
  const client = await signedIn(STUDENT);
  const view = await sitGapsTest(client, ['I', 'the']);

  const html = await (await client.fetch(`/tests/${gapsTestId}/attempts/${view.attemptId}`)).text();

  assert.ok(wears(html, 'state-correct'), 'the gap that was accepted');
  assert.ok(wears(html, 'state-incorrect'), 'and the one that was not');
  // The pieces of the sentence, with the answers in place of the gaps.
  assert.ok(html.includes(' have '), 'the sentence is rebuilt around the answers');
  assert.ok(html.includes('I have an apple.'), 'and the Reference Answer is shown whole');
});
