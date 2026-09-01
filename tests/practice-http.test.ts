// Seam 1 — the Student's whole path, driven over HTTP against a booted
// application and the seeded fixture.
//
// Every test signs in as its own Student, because progress is per Student: that
// is what keeps a suite that shares one booted application from also sharing one
// Student's history.
//
// Grader-judged Exercises are reached and rendered here but never completed —
// a hermetic suite cannot make a live model return `correct`. Progression is
// proved against Deterministic Check Exercises, and the Grader's own failure
// path has its own file.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, type BootedApp } from './helpers/app.ts';
import type { SeedAccount } from '../src/db/seed.ts';
import { ru } from '../src/ru.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import {
  DETERMINISTIC_COURSE, MULTI_GAP_COURSE, OTHER_COURSE, HOSTILE_THEORY_COURSE,
  KIND_SHOWCASES, kindShowcase,
} from './helpers/fixtures.ts';
import { lessonsOf, submissionsOf, unenroll } from './helpers/inspect.ts';
import type { Frame, ResultFrame, RevealResult } from '../src/practice/wire.ts';

// One account per test. Progress is per Student, so this is the whole of the
// isolation this suite needs.
const STUDENTS: SeedAccount[] = Array.from({ length: 32 }, (_, i) => ({
  username: `student${i + 1}`, password: 'staple monkey trombone', isAdmin: false,
}));

let app: BootedApp;

before(async () => {
  app = await bootApp({
    accounts: [ADMIN, ...STUDENTS],
    content: [
      ENGLISH_A1,
      DETERMINISTIC_COURSE,
      MULTI_GAP_COURSE,
      OTHER_COURSE,
      HOSTILE_THEORY_COURSE,
      ...KIND_SHOWCASES.map(kindShowcase),
    ],
  });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

let nextAccount = 0;
async function signedIn(): Promise<Client> {
  const account = STUDENTS[nextAccount++];
  if (!account) throw new Error('the suite ran out of Students — add more to STUDENTS');
  const client = new Client(app.baseUrl);
  const response = await client.signIn(account.username, account.password);
  assert.equal(response.status, 303, `${account.username} could not sign in`);
  return Object.assign(client, { username: account.username });
}

type Answering = { status: number; frames: Frame[]; result: ResultFrame | null; error: string | null };

// One value per gap, which for every Exercise with a single place to answer is a
// list of one — written here as a bare string, because that is what almost every
// row below is about.
async function answer(
  client: Client,
  exerciseId: number,
  text: string | readonly string[],
): Promise<Answering> {
  const response = await client.fetch(`/api/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: typeof text === 'string' ? [text] : text }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    return { status: response.status, frames: [], result: null, error: body?.error ?? null };
  }

  const frames = (await response.text()).split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Frame);
  const result = frames.find((f): f is ResultFrame => f.t === 'result') ?? null;
  return { status: response.status, frames, result, error: null };
}

function course(title: string) {
  return lessonsOf(app.databasePath, title);
}

// --- #17: the screens a Student works in -------------------------------------

test('a Student with no Current Course lands on their Courses rather than an error', async () => {
  const client = await signedIn();
  const response = await client.fetch('/');
  assert.equal(response.status, 307, 'the home screen is a signpost, not a screen');
  assert.equal(new URL(response.headers.get('location')!, app.baseUrl).pathname, '/courses');

  const html = await (await client.fetch('/courses')).text();
  assert.ok(html.includes(ru.courses.title), 'the landing names what it is showing');
  assert.ok(html.includes(ENGLISH_A1.title), 'and lists the Course they are enrolled in');
});

test('working in a Course records it as the Current Course, and the next visit lands there', async () => {
  const client = await signedIn();
  const [first] = course(ENGLISH_A1.title);
  const courseId = first!.lesson.courseId;

  assert.equal((await client.fetch(`/courses/${courseId}`)).status, 200);

  const home = await client.fetch('/');
  assert.equal(home.status, 307, 'signing in no longer stops at a menu');
  assert.equal(new URL(home.headers.get('location')!, app.baseUrl).pathname, `/courses/${courseId}`);
});

test('a Lesson\'s Theory renders as formatted HTML, not as raw markdown', async () => {
  const client = await signedIn();
  const [first] = course(ENGLISH_A1.title);

  const response = await client.fetch(`/lessons/${first!.lesson.id}`);
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.ok(html.includes('<h2>'), 'the headings are headings');
  assert.ok(html.includes('<table>'), 'and the table in the Theory is a table');
  assert.ok(!html.includes('## Артикли'), 'nothing is left as markdown source');
  assert.ok(html.includes(ru.lesson.toPractice), 'a control moves the Student into Practice');
});

test('raw HTML in Theory markdown cannot inject script into the page', async () => {
  const client = await signedIn();
  const [only] = course(HOSTILE_THEORY_COURSE.title);

  const html = await (await client.fetch(`/lessons/${only!.lesson.id}`)).text();
  const theory = html.slice(html.indexOf('<article'), html.indexOf('</article>'));

  assert.ok(theory.length > 0, 'the Theory rendered at all');
  assert.ok(!/<script/i.test(theory), 'no script tag');
  assert.ok(!/<img/i.test(theory), 'no img tag');
  assert.ok(!/onerror/i.test(theory.replace(/&quot;|&#x27;|&#39;/g, '')) || !/<\w+[^>]*onerror/i.test(theory),
    'no event handler on a real tag');
  assert.ok(!/href="javascript:/i.test(theory), 'and nothing navigable to a script URL');
  assert.ok(theory.includes('&lt;script'), 'it is shown to the Student as text instead');
});

test('Practice presents one Exercise at a time, in the Exercise Set\'s order', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const [one, two] = first!.exercises;

  const html = await (await client.fetch(`/lessons/${first!.lesson.id}/practice`)).text();
  assert.ok(html.includes(one!.prompt), 'the first Exercise is the one being asked');
  assert.ok(!html.includes(two!.prompt), 'and the second is not on the page at all');
  assert.ok(html.includes(ru.practice.position(1, first!.exercises.length)), 'the Student can see where they are');
});

test('each of the six Exercise Kinds renders an input appropriate to it', async () => {
  // One Course per Kind: Practice shows one Exercise at a time and Lessons unlock
  // sequentially, so this is the only way to have all six reachable at once.
  const expected: Record<string, (html: string) => boolean> = {
    fill_gap: (html) => html.includes('type="text"'),
    multiple_choice: (html) => html.includes('type="radio"') && html.includes('>an<'),
    word_order: (html) => html.includes(ru.practice.buildSentence) && html.includes('>cat<'),
    composition: (html) => html.includes('<textarea'),
    translation: (html) => html.includes('<textarea'),
    open_writing: (html) => html.includes('<textarea'),
  };

  const client = await signedIn();
  for (const kind of KIND_SHOWCASES) {
    const [only] = course(kindShowcase(kind).title);
    const html = await (await client.fetch(`/lessons/${only!.lesson.id}/practice`)).text();
    assert.ok(html.includes(`Задание вида ${kind}`), `${kind}: the Exercise is shown`);
    assert.ok(expected[kind]!(html), `${kind}: its input is not the right one`);
  }
});

test('a Student cannot reach a Lesson in a Course they are not enrolled in', async () => {
  const client = await signedIn();
  const [only] = course(OTHER_COURSE.title);
  const exercise = only!.exercises[0]!;

  // Enrolled by the content seed, then dropped: this is the state a Student is in
  // for every Course that is not theirs.
  unenroll(app.databasePath, (client as Client & { username: string }).username, OTHER_COURSE.title);

  assert.equal((await client.fetch(`/lessons/${only!.lesson.id}`)).status, 404,
    'the Lesson is not merely unlinked');
  assert.equal((await client.fetch(`/lessons/${only!.lesson.id}/practice`)).status, 404);
  assert.equal((await client.fetch(`/courses/${only!.lesson.courseId}`)).status, 404);
  assert.equal((await answer(client, exercise.id, 'worked')).status, 404,
    'and neither is the Exercise inside it');
});

// --- #18: submitting ----------------------------------------------------------

test('a Deterministic Check answer is judged in code at submission and answers at once', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  const outcome = await answer(client, exercise.id, 'a');
  assert.equal(outcome.status, 200);
  assert.equal(outcome.result?.status, 'graded');
  assert.equal(outcome.result?.verdict, 'correct');
  assert.deepEqual(outcome.result?.errors, [], 'nothing invented one');
  assert.equal(outcome.frames.filter((f) => f.t === 'delta').length, 0,
    'and nothing was streamed — no Grader was involved');
});

test('every attempt writes a Submission row with both Verdicts and its attempt number', async () => {
  const client = await signedIn();
  const username = (client as Client & { username: string }).username;
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  await answer(client, exercise.id, 'the');
  await answer(client, exercise.id, 'an');
  await answer(client, exercise.id, 'a');

  const rows = submissionsOf(app.databasePath, username, exercise.id);
  assert.deepEqual(rows.map((r) => r.attempt), [1, 2, 3], 'numbered per Student and per Exercise');
  // The sentence, not the word: a fill-gap's answer is stored as a person reads
  // it, so every screen that shows one shows a sentence without having to
  // reassemble it. What was written in each gap is kept beside it.
  assert.deepEqual(
    rows.map((r) => r.answer),
    [
      'Вставьте артикль: I have the cat.',
      'Вставьте артикль: I have an cat.',
      'Вставьте артикль: I have a cat.',
    ],
    'and the answers are kept',
  );
  assert.deepEqual(rows.map((r) => r.answerGaps), [['the'], ['an'], ['a']],
    'gap by gap, which is what a Dispute promotes and what marks a wrong gap');
  assert.deepEqual(rows.map((r) => r.status), ['graded', 'graded', 'graded']);
  assert.deepEqual(rows.map((r) => r.guardedVerdict), ['incorrect', 'incorrect', 'correct']);
  assert.deepEqual(
    rows.map((r) => r.proposedVerdict), rows.map((r) => r.guardedVerdict),
    'both Verdicts are stored on a Deterministic Check too, per ADR 0003',
  );
});

test('attempt numbering is per Student, not global', async () => {
  const one = await signedIn();
  const two = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  await answer(one, exercise.id, 'the');
  await answer(two, exercise.id, 'the');

  for (const client of [one, two]) {
    const rows = submissionsOf(app.databasePath, (client as Client & { username: string }).username, exercise.id);
    assert.deepEqual(rows.map((r) => r.attempt), [1], 'each Student starts at one');
  }
});

test('a wrong answer is never told the Reference Answer', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  const outcome = await answer(client, exercise.id, 'the');
  assert.equal(outcome.result?.verdict, 'incorrect');
  assert.equal(outcome.result?.corrected, null, 'that is what Reveal is for, after three attempts');
});

test('an empty answer is refused rather than recorded as an attempt', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  const outcome = await answer(client, exercise.id, '   ');
  assert.equal(outcome.status, 400);
  assert.equal(outcome.error, ru.practice.emptyAnswer);
  assert.equal(
    submissionsOf(app.databasePath, (client as Client & { username: string }).username, exercise.id).length, 0,
  );
});

// --- #19: progression ---------------------------------------------------------

test('a correct Verdict advances and an incorrect one keeps the Student on the Exercise', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const [one, two] = first!.exercises;

  const wrong = await answer(client, one!.id, 'the');
  assert.equal(wrong.result?.progression.advanced, false);
  assert.equal(wrong.result?.progression.nextExerciseId, one!.id, 'still the same Exercise');

  const right = await answer(client, one!.id, 'a');
  assert.equal(right.result?.progression.advanced, true);
  assert.equal(right.result?.progression.nextExerciseId, two!.id);

  const html = await (await client.fetch(`/lessons/${first!.lesson.id}/practice`)).text();
  assert.ok(html.includes(two!.prompt), 'and the Practice screen has moved on');
  assert.ok(!html.includes(one!.prompt));
});

test('an Exercise the Student has not reached yet cannot be answered ahead of the order', async () => {
  // Presenting one Exercise at a time is worth nothing if the endpoint behind it
  // accepts an answer to any of them: a Student could complete a Practice
  // backwards, and the Lesson would be finished without the order being worked.
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const [, two, three] = first!.exercises;

  const ahead = await answer(client, three!.id, 'this is a cat');
  assert.equal(ahead.status, 409);
  assert.equal(ahead.error, ru.practice.notCurrent);

  assert.equal(
    (await client.fetch(`/api/exercises/${two!.id}/reveal`, { method: 'POST' })).status, 409,
    'and it cannot be revealed ahead of the order either',
  );

  const username = (client as Client & { username: string }).username;
  assert.equal(submissionsOf(app.databasePath, username, three!.id).length, 0,
    'nothing was recorded against it');
});

test('an Exercise already behind the Student cannot be answered again', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  await answer(client, exercise.id, 'a');
  assert.equal((await answer(client, exercise.id, 'a')).status, 409);
});

test('Reveal is refused before three failed attempts and offered after the third', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  const reveal = () => client.fetch(`/api/exercises/${exercise.id}/reveal`, { method: 'POST' });

  assert.equal((await reveal()).status, 409, 'not before a single attempt');

  const failures = [];
  for (const wrong of ['the', 'an', 'some']) failures.push(await answer(client, exercise.id, wrong));

  assert.deepEqual(failures.map((f) => f.result?.progression.failedAttempts), [1, 2, 3]);
  assert.deepEqual(failures.map((f) => f.result?.progression.revealOffered), [false, false, true]);

  const html = await (await client.fetch(`/lessons/${first!.lesson.id}/practice`)).text();
  assert.ok(html.includes(ru.practice.reveal), 'and the Student is offered it on the screen');
});

test('a Student may keep attempting instead of revealing', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  for (const wrong of ['the', 'an', 'some']) await answer(client, exercise.id, wrong);

  const fourth = await answer(client, exercise.id, 'a');
  assert.equal(fourth.result?.verdict, 'correct', 'Reveal is offered, not forced');
  assert.equal(fourth.result?.progression.advanced, true);
});

test('Reveal shows the Reference Answer, moves the Student on, and records Completed With Help', async () => {
  const client = await signedIn();
  const username = (client as Client & { username: string }).username;
  const [first] = course(DETERMINISTIC_COURSE.title);
  const [one, two] = first!.exercises;

  for (const wrong of ['the', 'an', 'some']) await answer(client, one!.id, wrong);

  const response = await client.fetch(`/api/exercises/${one!.id}/reveal`, { method: 'POST' });
  assert.equal(response.status, 200);
  const revealed = await response.json() as RevealResult;

  assert.equal(revealed.referenceAnswer, one!.referenceAnswer);
  assert.equal(revealed.progression.advanced, true);
  assert.equal(revealed.progression.nextExerciseId, two!.id);

  const rows = submissionsOf(app.databasePath, username, one!.id);
  assert.equal(rows.at(-1)?.status, 'revealed', 'completion stays derived from Submissions');
  assert.equal(rows.at(-1)?.guardedVerdict, null, 'a revealed Exercise was never judged correct');

  const html = await (await client.fetch(`/lessons/${first!.lesson.id}/practice`)).text();
  assert.ok(html.includes('segment state-help'),
    'and it is its own segment in the progress bar, not folded in with the rest');
  assert.ok(html.includes(ru.states.help),
    'named on the segment too — the wording has to carry it on its own');
  assert.ok(html.includes(ru.practice.withHelpCount(1)));
});

// --- #20: unlocking -----------------------------------------------------------

test('the first Lesson is unlocked on enrollment and the next one is not', async () => {
  const client = await signedIn();
  const [first, second] = course(DETERMINISTIC_COURSE.title);

  assert.equal((await client.fetch(`/lessons/${first!.lesson.id}`)).status, 200);

  const locked = await client.fetch(`/lessons/${second!.lesson.id}`);
  assert.equal(locked.status, 403, 'typing the URL is refused, not merely unlinked');
  assert.ok((await locked.text()).includes(ru.course.lockedRefusal), 'and refused in Russian');

  assert.equal((await client.fetch(`/lessons/${second!.lesson.id}/practice`)).status, 403);
  assert.equal(
    (await answer(client, second!.exercises[0]!.id, 'works')).status, 403,
    'nor can its Exercises be answered around the front door',
  );
});

test('completing every Exercise completes the Lesson and unlocks the next', async () => {
  const client = await signedIn();
  const [first, second] = course(DETERMINISTIC_COURSE.title);

  const answers = ['a', 'an', 'this is a cat'];
  let last: Answering | null = null;
  for (const [index, exercise] of first!.exercises.entries()) {
    last = await answer(client, exercise.id, answers[index]!);
    assert.equal(last.result?.verdict, 'correct', `${exercise.prompt} was answered correctly`);
  }

  assert.equal(last?.result?.progression.lessonComplete, true);
  assert.equal(last?.result?.progression.nextExerciseId, null, 'there is nothing left in this Lesson');

  const practice = await (await client.fetch(`/lessons/${first!.lesson.id}/practice`)).text();
  assert.ok(practice.includes(ru.practice.lessonComplete));
  assert.ok(practice.includes(ru.practice.nextLesson), 'and the next Lesson is offered');

  assert.equal((await client.fetch(`/lessons/${second!.lesson.id}`)).status, 200, 'which is now open');

  const overview = await (await client.fetch(`/courses/${first!.lesson.courseId}`)).text();
  assert.ok(overview.includes(ru.course.complete), 'the Course screen agrees');
});

test('completion is derived from Submissions, not from a flag that can disagree with them', async () => {
  // Written straight into the Submissions table, with nothing else touched: if
  // completion were stored anywhere else, the Lesson would still look unfinished.
  const client = await signedIn();
  const username = (client as Client & { username: string }).username;
  const [first, second] = course(DETERMINISTIC_COURSE.title);

  const { withDatabase } = await import('./helpers/inspect.ts');
  const { submissions, students } = await import('../src/db/schema.ts');
  const { eq } = await import('drizzle-orm');

  withDatabase(app.databasePath, (db) => {
    const student = db.select().from(students).where(eq(students.username, username)).get()!;
    for (const exercise of first!.exercises) {
      db.insert(submissions).values({
        studentId: student.id, exerciseId: exercise.id, attempt: 1, answer: 'a',
        status: 'graded', proposedVerdict: 'correct', guardedVerdict: 'correct',
        feedbackRu: null, corrected: null, createdAt: new Date(),
      }).run();
    }
  });

  assert.equal((await client.fetch(`/lessons/${second!.lesson.id}`)).status, 200,
    'the next Lesson unlocked with no other write anywhere');
});

// --- #83: a fill-gap Exercise with several gaps -------------------------------

/** The multi-gap Lesson's first Exercise: «___ have ___ apple and ___ cat.» */
function threeGaps() {
  const [only] = course(MULTI_GAP_COURSE.title);
  return { lessonId: only!.lesson.id, exercises: only!.exercises };
}

test('a prompt with three gaps renders three inputs, in the sentence', async () => {
  const client = await signedIn();
  const { lessonId } = threeGaps();

  const html = await (await client.fetch(`/lessons/${lessonId}/practice`)).text();

  assert.equal(
    (html.match(/class="gap"/g) ?? []).length, 3,
    'one input per gap, and no more',
  );
  // The pieces of the prompt sit around the inputs rather than the prompt being
  // printed whole with the inputs underneath it.
  assert.ok(html.includes('Заполните пропуски: '), 'the text before the first gap');
  assert.ok(html.includes(' have '), 'the text between the first two');
  assert.ok(html.includes(' cat.'), 'the text after the last');
  // Inside the prompt itself: the page also carries the props the component was
  // rendered from, and the raw prompt lives there whatever the screen shows.
  const promptHtml = html.match(/<p class="prompt">[\s\S]*?<\/p>/)![0];
  assert.ok(!promptHtml.includes('___'), 'and no gap is left printed as literal text');
});

test('every gap accepted is correct; some is partially correct; none is incorrect', async () => {
  const client = await signedIn();
  const { exercises } = threeGaps();
  const first = exercises[0]!;

  const none = await answer(client, first.id, ['the', 'the', 'the']);
  assert.equal(none.result?.verdict, 'incorrect');
  assert.deepEqual(none.result?.gaps, [false, false, false]);

  const some = await answer(client, first.id, ['I', 'the', 'a']);
  assert.equal(some.result?.verdict, 'partially_correct',
    'a partly right answer says so rather than being called wrong');
  assert.deepEqual(some.result?.gaps, [true, false, true],
    'and says which gap it was, or the next attempt is a re-guess of all three');
  assert.equal(some.result?.corrected, null,
    'never the missing word: that is what Reveal is for, after three attempts');

  const all = await answer(client, first.id, ['I', 'an', 'a']);
  assert.equal(all.result?.verdict, 'correct');
  assert.deepEqual(all.result?.gaps, [true, true, true]);
  assert.equal(all.result?.corrected, 'Заполните пропуски: I have an apple and a cat.',
    'the correction is the sentence, not the three words');
});

test('a value accepted at one gap is not thereby accepted at another', async () => {
  // The whole reason the accepted answers are per gap. «a» is right at the third
  // gap and wrong at the second, and an Exercise that took it at either would be
  // teaching the mistake.
  const client = await signedIn();
  const { exercises } = threeGaps();

  const swapped = await answer(client, exercises[0]!.id, ['I', 'a', 'an']);
  assert.equal(swapped.result?.verdict, 'partially_correct');
  assert.deepEqual(swapped.result?.gaps, [true, false, false]);
});

test('a partly right answer counts as a failed attempt, and Reveal shows the whole sentence', async () => {
  const client = await signedIn();
  const { exercises } = threeGaps();
  const first = exercises[0]!;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const outcome = await answer(client, first.id, ['I', 'a', 'the']);
    assert.equal(outcome.result?.verdict, 'partially_correct');
    assert.equal(outcome.result?.progression.failedAttempts, attempt,
      'partially correct is not correct, so it counts against the Student');
    assert.equal(outcome.result?.progression.advanced, false, 'and does not advance');
  }

  const revealed = await client.fetch(`/api/exercises/${first.id}/reveal`, { method: 'POST' });
  assert.equal(revealed.status, 200, 'Reveal is offered after three, as it always was');
  const body = await revealed.json() as RevealResult;
  assert.equal(body.referenceAnswer, 'I have an apple and a cat.',
    'the complete sentence, not the words that were missing');
});

test('an answer with nothing in any gap is refused, the way a blank one always was', async () => {
  const client = await signedIn();
  const { exercises } = threeGaps();

  const empty = await answer(client, exercises[0]!.id, ['', '  ', '']);
  assert.equal(empty.status, 400);
  assert.equal(empty.error, ru.practice.emptyAnswer,
    'asked of the gaps: the sentence they build still reads as the prompt');
});

test('the same word at two gaps is judged at both, and marked at both', async () => {
  // The second Exercise accepts «is» at either gap. Nothing about per-gap
  // judgement makes that harder to author or to answer.
  const client = await signedIn();
  const { exercises } = threeGaps();
  const second = exercises[1]!;

  // The Practice presents one Exercise at a time, so the first has to be
  // finished before the second is current.
  assert.equal((await answer(client, exercises[0]!.id, ['I', 'an', 'a'])).result?.verdict, 'correct');

  const half = await answer(client, second.id, ['is', 'are']);
  assert.equal(half.result?.verdict, 'partially_correct');
  assert.deepEqual(half.result?.gaps, [true, false]);

  const both = await answer(client, second.id, ['is', 'is']);
  assert.equal(both.result?.verdict, 'correct');
});

test('a single-gap Exercise answers exactly as it did before gaps were counted', async () => {
  const client = await signedIn();
  const [first] = course(DETERMINISTIC_COURSE.title);
  const exercise = first!.exercises[0]!;

  const wrong = await answer(client, exercise.id, 'the');
  assert.equal(wrong.result?.verdict, 'incorrect',
    'one gap wrong is incorrect, never partially correct');
  assert.deepEqual(wrong.result?.gaps, [false]);

  const right = await answer(client, exercise.id, 'a');
  assert.equal(right.result?.verdict, 'correct');
  assert.equal(right.result?.corrected, 'Вставьте артикль: I have a cat.',
    'the sentence, which is what every screen showing an answer now shows');
});
