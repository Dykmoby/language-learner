// Seam 1 — authoring a Practice by hand, over HTTP.
//
// The claim worth a real server is the round trip: an Exercise typed into a
// Draft, published, and then met by a Student, judged by the half of the system
// its Kind belongs to. A unit test can assert that a document was stored; only a
// booted application can assert that a Student answering it is judged in code
// rather than by the Grader.
//
// The Grader half is proved by provoking it rather than by mocking it: this
// application boots with a broken HOME, so any Exercise that reaches the Grader
// fails to grade — which is exactly the observation that distinguishes the two
// halves without a live model. design.md § Failure behaviour requires that a
// failed grading is never rendered as a wrong answer, so what comes back is a
// failure and not a Verdict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';
import { lessonsOf, submissionsOf } from './helpers/inspect.ts';
import { ru } from '../src/ru.ts';
import type { Frame, ResultFrame } from '../src/practice/wire.ts';
import type { DocumentExercise, LessonDocument } from '../src/content/lesson-document.ts';
import { acceptedPositions } from '../src/content/accepted.ts';

let app: BootedApp;

test.before(async () => {
  app = await bootApp({
    content: [DETERMINISTIC_COURSE],
    // Every Grader call fails, which is what makes "did this Exercise reach the
    // Grader?" an observable question in a hermetic suite.
    env: { HOME: '/nonexistent-home-for-this-test' },
  });
}, { timeout: 180_000 });

test.after(async () => {
  await app.stop();
});

async function signedIn(who: { username: string; password: string }): Promise<Client> {
  const client = new Client(app.baseUrl);
  assert.equal((await client.signIn(who.username, who.password)).status, 303);
  return client;
}

function postJson(client: Client, path: string, body: unknown): Promise<Response> {
  return client.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function theSecondLesson() {
  // The second Lesson of the fixture: editing it cannot disturb the first, which
  // is what the other suites work against.
  return lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!;
}

function documentFor(exercises: DocumentExercise[]): LessonDocument {
  return {
    title: 'Второй урок',
    grammarFocus: 'Present Simple third person -s.',
    theoryMarkdown: '## Второй урок\n\nВ третьем лице добавляется **-s**.',
    exercises,
  };
}

async function saveAndPublish(admin: Client, lessonId: number, document: LessonDocument): Promise<void> {
  const saved = await postJson(admin, `/api/admin/lessons/${lessonId}/draft`, document);
  assert.equal(saved.status, 200, 'the Draft was saved');
  const draftId = (await json(saved)).draftId as number;

  const published = await postJson(admin, `/api/admin/lessons/${lessonId}/publish`, { draftId });
  assert.equal(published.status, 200, 'and published');
}

async function answer(client: Client, exerciseId: number, given: string): Promise<ResultFrame> {
  const response = await client.fetch(`/api/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer: given }),
  });
  assert.equal(response.status, 200);

  const frames = (await response.text()).split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Frame);
  const result = frames.find((frame): frame is ResultFrame => frame.t === 'result');
  assert.ok(result, 'the terminal frame arrives');
  return result;
}

test('the editor offers a form for the Exercises, not a note that it cannot', async () => {
  const admin = await signedIn(ADMIN);
  const { lesson } = theSecondLesson();

  const html = await (await admin.fetch(`/admin/lessons/${lesson.id}`)).text();
  assert.match(html, new RegExp(ru.draft.exercisesTitle), 'the Practice is on the page');
  assert.match(html, new RegExp(ru.draft.addExercise), 'and another Exercise can be added');
  assert.match(html, new RegExp(ru.exerciseKinds.fill_gap!), 'with the Kinds named in Russian');
  assert.match(html, new RegExp(ru.draft.historyTitle), 'and the history is linked');
});

test('an incoherent Exercise is refused with the Russian message for its rule, and never stored', async () => {
  const admin = await signedIn(ADMIN);
  const { lesson } = theSecondLesson();

  const before = await (await admin.fetch(`/admin/lessons/${lesson.id}`)).text();

  // A multiple choice whose Reference Answer is not among its options: on Reveal
  // the Student would be shown something they were never offered.
  const refused = await postJson(admin, `/api/admin/lessons/${lesson.id}/draft`, documentFor([{
    kind: 'multiple_choice',
    prompt: 'Выберите вариант: She ___ (work).',
    referenceAnswer: 'working',
    acceptedAnswers: [['works']],
    choices: ['work', 'works', 'worked'],
  }]));

  assert.equal(refused.status, 422, 'refused rather than stored and complained about later');
  const body = await json(refused);
  assert.deepEqual(
    (body.faults as Array<{ code: string; exercisePosition: number }>).map((f) => [f.code, f.exercisePosition]),
    [['reference_answer_not_a_choice', 1]],
    'named, and pointed at the Exercise it is about',
  );
  // The rule reaches the Admin as a sentence rather than as a code.
  assert.ok(ru.exerciseFaults.reference_answer_not_a_choice.length > 0);

  const after = await (await admin.fetch(`/admin/lessons/${lesson.id}`)).text();
  assert.equal(after, before, 'and the Draft is exactly as it was');
});

test('a Deterministic Check Exercise authored here is judged in code', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);
  const { lesson } = theSecondLesson();

  await saveAndPublish(admin, lesson.id, documentFor([{
    kind: 'fill_gap',
    prompt: 'Поставьте форму: He ___ (go) to school.',
    referenceAnswer: 'goes',
    acceptedAnswers: [['goes']],
    caseSensitive: false,
  }]));

  // The Student has to finish the first Lesson before the second unlocks.
  const [first] = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title);
  for (const [index, exercise] of first!.exercises.entries()) {
    const given = ['a', 'an', 'This is a cat'][index]!;
    const result = await answer(student, exercise.id, given);
    assert.equal(result.verdict, 'correct', `exercise ${index + 1} of the first Lesson`);
  }

  const authored = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!.exercises[0]!;
  assert.equal(authored.kind, 'fill_gap', 'the authored Exercise is what the Student meets');

  const wrong = await answer(student, authored.id, 'go');
  assert.equal(wrong.status, 'graded', 'judged in code, with no Grader involved');
  assert.equal(wrong.verdict, 'incorrect');

  const right = await answer(student, authored.id, 'goes');
  assert.equal(right.status, 'graded');
  assert.equal(right.verdict, 'correct');
});

test('a Grader-judged Exercise authored here reaches the Grader', async () => {
  const admin = await signedIn(ADMIN);
  const student = await signedIn(STUDENT);
  const { lesson } = theSecondLesson();

  await saveAndPublish(admin, lesson.id, documentFor([{
    kind: 'translation',
    prompt: 'Переведите: Он ходит в школу.',
    referenceAnswer: 'He goes to school.',
  }]));

  const authored = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!.exercises[0]!;
  assert.equal(authored.kind, 'translation');

  const result = await answer(student, authored.id, 'He go to school.');
  // This application cannot reach its credentials, so anything that reaches the
  // Grader fails to grade. A Deterministic Check would have answered
  // `incorrect` instead, which is what makes this the distinguishing assertion.
  assert.equal(result.status, 'grading_failed', 'it went to the Grader, not to a Deterministic Check');
  assert.equal(result.verdict, null, 'and a failure is never rendered as a wrong answer');
});

test('Exercises publish in the authored order, however they were reordered in the Draft', async () => {
  const admin = await signedIn(ADMIN);
  const { lesson } = theSecondLesson();

  const three: DocumentExercise[] = ['первое', 'второе', 'третье'].map((which) => ({
    kind: 'fill_gap',
    prompt: `Задание ${which}: I have ___ cat.`,
    referenceAnswer: 'a',
    acceptedAnswers: [['a']],
  }));
  await saveAndPublish(admin, lesson.id, documentFor(three));

  const published = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!.exercises;
  const ids = published.map((exercise) => exercise.id);
  assert.deepEqual(published.map((e) => e.position), [1, 2, 3]);

  // Reversed, which is the case a publish that wrote positions one at a time in
  // place would collide on: positions are unique within an Exercise Set.
  const reversed = [...published].reverse().map((exercise) => ({
    id: exercise.id,
    kind: exercise.kind,
    prompt: exercise.prompt,
    referenceAnswer: exercise.referenceAnswer,
    acceptedAnswers: acceptedPositions(exercise),
    caseSensitive: exercise.caseSensitive,
    choices: exercise.choices,
  }));
  await saveAndPublish(admin, lesson.id, documentFor(reversed));

  const after = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title)[1]!.exercises;
  assert.deepEqual(after.map((e) => e.position), [1, 2, 3], 'no two share a position');
  assert.deepEqual(after.map((e) => e.id), [...ids].reverse(), 'and they are the same rows, reordered');
});

test('the editor is told what removing an Exercise would destroy', async () => {
  const admin = await signedIn(ADMIN);
  const [first] = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title);
  const answered = first!.exercises[0]!;

  // Answered by the Student earlier in this file. Read back rather than assumed,
  // so the number asserted below is the number that actually exists.
  const made = submissionsOf(app.databasePath, STUDENT.username, answered.id).length;
  assert.ok(made > 0, 'the Exercise has work against it');

  // The counts reach the browser, which is what lets the form warn before it
  // throws a Student's work away rather than after. Removing an Exercise
  // cascades to every Submission made against it, and that is not something to
  // do quietly.
  const html = await (await admin.fetch(`/admin/lessons/${first!.lesson.id}`)).text();
  assert.ok(
    html.includes(ru.draft.hasSubmissions(made)),
    'the Exercise says how much work removing it would destroy',
  );
  assert.match(html, new RegExp(ru.draft.removeExercise), 'beside the removal that would do it');

  // The Exercise that has no Submissions does not carry the warning, so the
  // notice means something rather than sitting on everything.
  const untouched = first!.exercises[2]!;
  assert.equal(
    submissionsOf(app.databasePath, STUDENT.username, untouched.id).length > 0,
    true,
    'the fixture Student answered every Exercise of the first Lesson',
  );
});
