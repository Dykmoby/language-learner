// Seam 1 — objecting to a Verdict, driven over HTTP against a booted application.
//
// The claims here are the ones a Student can actually observe: that the Exercise
// stops holding them, that a second objection is refused, that somebody else's
// answer is not theirs to object to, and — the load-bearing one — that nothing
// the Grader wrote was touched by any of it.
//
// Deterministic Check Exercises throughout: a hermetic suite cannot make a live
// model return a chosen Verdict, and every rule under test is about the objection
// rather than about what produced the judgement.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, Client, ADMIN, type BootedApp } from './helpers/app.ts';
import type { SeedAccount } from '../src/db/seed.ts';
import { ru } from '../src/ru.ts';
import { DETERMINISTIC_COURSE, MULTI_GAP_COURSE } from './helpers/fixtures.ts';
import {
  courseIdFor, lessonsOf, submissionsOf, errorsOf, testsOf, withDatabase,
} from './helpers/inspect.ts';
import { disputes } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';
import type { Frame, ResultFrame } from '../src/practice/wire.ts';
import { MAX_COMMENT_LENGTH } from '../src/practice/disputes.ts';
import type { AttemptView } from '../src/tests/wire.ts';

const STUDENTS: SeedAccount[] = Array.from({ length: 30 }, (_, i) => ({
  username: `objector${i + 1}`, password: 'staple monkey trombone', isAdmin: false,
}));

let app: BootedApp;
// A Test, so the other half of ADR 0005 is exercised: its answers are Submissions
// too, and the same objection has to reach them.
let testId: number;
let testExerciseIds: number[] = [];

const TEST_EXERCISES = [
  {
    kind: 'fill_gap',
    prompt: 'Вставьте артикль: I have ___ dog.',
    referenceAnswer: 'a',
    acceptedAnswers: [['a']],
    choices: [],
    caseSensitive: false,
  },
  {
    kind: 'multiple_choice',
    prompt: 'Выберите вариант: I have ___ orange.',
    referenceAnswer: 'an',
    acceptedAnswers: [['an']],
    choices: ['a', 'an', 'the'],
    caseSensitive: false,
  },
];

before(async () => {
  app = await bootApp({
    accounts: [ADMIN, ...STUDENTS],
    // The multi-gap Course too, because #85's question — which Gap is this
    // answer confirmed for — cannot be asked of an Exercise with one place to
    // answer.
    content: [DETERMINISTIC_COURSE, MULTI_GAP_COURSE],
  });

  const courseId = courseIdFor(app.databasePath, DETERMINISTIC_COURSE.title);
  const admin = new Client(app.baseUrl);
  await admin.signIn(ADMIN.username, ADMIN.password);

  const created = await admin.fetch(`/api/admin/courses/${courseId}/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Контрольная для возражений' }),
  });
  testId = ((await created.json()) as { testId: number }).testId;

  await admin.fetch(`/api/admin/tests/${testId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Контрольная для возражений', passThreshold: 80, exercises: TEST_EXERCISES,
    }),
  });
  await admin.fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });

  testExerciseIds = testsOf(app.databasePath, DETERMINISTIC_COURSE.title)
    .find((entry) => entry.test.id === testId)!.exercises.map((exercise) => exercise.id);
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

let nextAccount = 0;
type SignedIn = Client & { username: string };

async function signedIn(): Promise<SignedIn> {
  const account = STUDENTS[nextAccount++];
  if (!account) throw new Error('the suite ran out of Students — add more to STUDENTS');
  const client = new Client(app.baseUrl);
  const response = await client.signIn(account.username, account.password);
  assert.equal(response.status, 303, `${account.username} could not sign in`);
  return Object.assign(client, { username: account.username });
}

function firstLesson() {
  const [lesson] = lessonsOf(app.databasePath, DETERMINISTIC_COURSE.title);
  if (!lesson) throw new Error('the fixture seeded no Lesson');
  return lesson;
}

async function answer(client: Client, exerciseId: number, text: string): Promise<ResultFrame> {
  const response = await client.fetch(`/api/exercises/${exerciseId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: [text] }),
  });
  assert.ok(response.ok, `answering ${exerciseId} was refused with ${response.status}`);

  const frames = (await response.text()).split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Frame);
  const result = frames.find((f): f is ResultFrame => f.t === 'result');
  assert.ok(result, 'the stream carried no result frame');
  return result;
}

async function dispute(
  client: Client,
  submissionId: number,
  comment = 'Так тоже говорят, я встречал этот оборот.',
): Promise<{ status: number; error: string | null }> {
  const response = await client.fetch(`/api/submissions/${submissionId}/dispute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return { status: response.status, error: body?.error ?? null };
}

// A distinct wrong answer per objection, and that is not fussiness: upholding a
// Dispute makes the answer an Accepted Variant of that Exercise for everybody
// afterwards. Sharing one wrong answer across the suite would mean the first
// upheld test silently made every later Student's answer correct — which is the
// feature working, and would look like a broken fixture.
let wrongAnswers = 0;

/** A Student who has just been told they are wrong on the first Exercise. */
async function toldTheyAreWrong(): Promise<{ client: SignedIn; result: ResultFrame }> {
  const client = await signedIn();
  const { exercises } = firstLesson();
  wrongAnswers += 1;
  const result = await answer(client, exercises[0]!.id, `wrong${wrongAnswers}`);
  assert.equal(result.verdict, 'incorrect', 'the fixture answer must be judged wrong');
  return { client, result };
}

test('a result frame names the Submission, so there is something to object to', async () => {
  const { result } = await toldTheyAreWrong();
  assert.equal(typeof result.submissionId, 'number');
});

test('a Student can dispute the Verdict on an Exercise they answered', async () => {
  const { client, result } = await toldTheyAreWrong();
  const outcome = await dispute(client, result.submissionId!);
  assert.equal(outcome.status, 200);
});

test('disputing unblocks progression immediately: the next Exercise is available', async () => {
  const { client, result } = await toldTheyAreWrong();
  const { exercises } = firstLesson();

  // Before: the second Exercise is not the current one, and the endpoint says so
  // rather than merely the screen hiding it.
  const early = await client.fetch(`/api/exercises/${exercises[1]!.id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: ['an'] }),
  });
  assert.equal(early.status, 409, 'Exercises are worked in order until something moves');

  assert.equal((await dispute(client, result.submissionId!)).status, 200);

  // After: without waiting for anybody.
  const now = await answer(client, exercises[1]!.id, 'an');
  assert.equal(now.verdict, 'correct');
});

test('a disputed Exercise renders as disputed — not as passed, not as failed', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);

  const page = await client.fetch(`/lessons/${firstLesson().lesson.id}/practice`);
  const html = await page.text();

  assert.match(html, /segment state-disputed/, 'the progress bar tells it apart from both');
  assert.ok(
    html.includes(ru.practice.disputedCount(1)),
    'and the counts beside the bar say so in words',
  );
});

test('a second Dispute against the same Submission is refused', async () => {
  const { client, result } = await toldTheyAreWrong();
  assert.equal((await dispute(client, result.submissionId!)).status, 200);

  const again = await dispute(client, result.submissionId!, 'Всё-таки я прав.');
  assert.equal(again.status, 409, 'saying it twice is not saying it louder');
  assert.equal(again.error, ru.dispute.already);
});

test('an objection with no reason is not an objection', async () => {
  const { client, result } = await toldTheyAreWrong();
  const outcome = await dispute(client, result.submissionId!, '   ');
  assert.equal(outcome.status, 400);
  assert.equal(outcome.error, ru.dispute.emptyComment);
});

test('a Submission that was never judged cannot be disputed', async () => {
  const client = await signedIn();
  const { exercises } = firstLesson();

  // Three failures, then Reveal: the row that lands is a Reveal rather than a
  // judgement, and a Reveal was never a Verdict.
  for (let i = 0; i < 3; i += 1) await answer(client, exercises[0]!.id, 'the');
  const revealed = await client.fetch(`/api/exercises/${exercises[0]!.id}/reveal`, { method: 'POST' });
  assert.ok(revealed.ok);

  const rows = submissionsOf(app.databasePath, client.username, exercises[0]!.id);
  const reveal = rows.find((row) => row.status === 'revealed');
  assert.ok(reveal, 'the Reveal was recorded as a Submission');

  const outcome = await dispute(client, reveal.id);
  assert.equal(outcome.status, 409);
  assert.equal(outcome.error, ru.dispute.notJudged);
});

test('an objection past the length cap is refused, and does not use up the one objection', async () => {
  const { client, result } = await toldTheyAreWrong();

  const essay = 'а'.repeat(MAX_COMMENT_LENGTH + 1);
  const refused = await dispute(client, result.submissionId!, essay);
  assert.equal(refused.status, 400);
  assert.equal(refused.error, ru.dispute.tooLong(MAX_COMMENT_LENGTH));

  // Nothing was written, so shortening it and sending it again works — rather
  // than the Student discovering they have already spent their one objection on
  // a request the server threw away.
  assert.equal((await dispute(client, result.submissionId!, 'Коротко.')).status, 200);
});

test('only the Student who wrote the answer can dispute it — anyone else gets a 404', async () => {
  const { result } = await toldTheyAreWrong();

  const other = await signedIn();
  const outcome = await dispute(other, result.submissionId!);
  assert.equal(outcome.status, 404, 'and it is missing rather than forbidden');
  assert.equal(outcome.error, ru.errors.notFound);
});

test('an Admin has no special right to object on a Student’s behalf', async () => {
  const { result } = await toldTheyAreWrong();

  const admin = new Client(app.baseUrl);
  assert.equal((await admin.signIn(ADMIN.username, ADMIN.password)).status, 303);

  // The Admin resolves Disputes; they do not make them for other people.
  assert.equal((await dispute(admin, result.submissionId!)).status, 404);
});

test('a Submission that does not exist is a 404, not a crash', async () => {
  const client = await signedIn();
  assert.equal((await dispute(client, 999_999)).status, 404);
  assert.equal((await dispute(client, Number.NaN)).status, 404);
});

test('disputing alters neither Verdict, no Error and not the answer', async () => {
  const { client, result } = await toldTheyAreWrong();
  const { exercises } = firstLesson();

  const before = submissionsOf(app.databasePath, client.username, exercises[0]!.id);
  const errorsBefore = before.flatMap((row) => errorsOf(app.databasePath, row.id));

  assert.equal((await dispute(client, result.submissionId!)).status, 200);

  const after = submissionsOf(app.databasePath, client.username, exercises[0]!.id);
  const errorsAfter = after.flatMap((row) => errorsOf(app.databasePath, row.id));

  // ADR 0003 keeps both Verdicts so the Grader's run-to-run instability stays
  // measurable. Overwriting either after an objection would destroy the one
  // number that says whether the Grader is improving.
  assert.deepEqual(
    after.map((row) => [row.answer, row.proposedVerdict, row.guardedVerdict, row.status]),
    before.map((row) => [row.answer, row.proposedVerdict, row.guardedVerdict, row.status]),
  );
  assert.deepEqual(errorsAfter, errorsBefore);
});

// --- A Test's Verdict --------------------------------------------------------
//
// Since ADR 0005 a Test's answers are Submissions, so the same row carries the
// objection and the same review will resolve it. What does not carry over is the
// unblocking: a Test gates nothing, so disputing one changes the record and
// nothing else.

async function sitAndFail(client: Client): Promise<AttemptView> {
  const response = await client.fetch(`/api/tests/${testId}/attempts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      answers: [
        { exerciseId: testExerciseIds[0]!, answers: ['a'] },
        { exerciseId: testExerciseIds[1]!, answers: ['the'] },
      ],
    }),
  });
  assert.equal(response.status, 200, 'the attempt was accepted');
  const { attemptId } = await response.json() as { attemptId: number };

  const view = await client.fetch(`/api/tests/${testId}/attempts/${attemptId}`);
  return ((await view.json()) as { view: AttemptView }).view;
}

test('a Verdict reached in a Test can be disputed from its review', async () => {
  const client = await signedIn();
  const view = await sitAndFail(client);

  const wrong = view.exercises.find((exercise) => !exercise.correct);
  assert.ok(wrong, 'the attempt has something to object to');
  assert.equal(wrong.dispute, null, 'and nothing has been objected to yet');

  assert.equal((await dispute(client, wrong.submissionId)).status, 200);
});

test('disputing a Test moves no score and reopens no attempt', async () => {
  const client = await signedIn();
  const before = await sitAndFail(client);
  const wrong = before.exercises.find((exercise) => !exercise.correct)!;

  assert.equal((await dispute(client, wrong.submissionId)).status, 200);

  const response = await client.fetch(`/api/tests/${testId}/attempts/${before.attemptId}`);
  const after = ((await response.json()) as { view: AttemptView }).view;

  assert.equal(after.scorePercent, before.scorePercent, 'a Test is a mirror, not a gate');
  assert.equal(after.correct, before.correct);
  assert.equal(after.state, before.state, 'the attempt is not reopened');

  const reviewed = after.exercises.find((e) => e.submissionId === wrong.submissionId)!;
  assert.deepEqual(reviewed.dispute, { ruling: null }, 'but the objection is on the record');
  assert.equal(reviewed.verdict, wrong.verdict, 'and the Verdict is exactly as it was');
});

// --- The Admin's half --------------------------------------------------------
//
// The queue and the two decisions, at the seam where the narrowing lives. A
// non-Admin is answered with a 404 rather than a refusal, the rule the whole
// Admin section keeps: a 404 says nothing about what is behind it, and a Student
// who is not an Admin should not learn that a review queue exists at all.

function disputeIdFor(submissionId: number): number {
  return withDatabase(app.databasePath, (db) => {
    const row = db.select().from(disputes).where(eq(disputes.submissionId, submissionId)).get();
    if (!row) throw new Error(`no Dispute was recorded against Submission ${submissionId}`);
    return row.id;
  });
}

async function asAdmin(): Promise<Client> {
  const admin = new Client(app.baseUrl);
  assert.equal((await admin.signIn(ADMIN.username, ADMIN.password)).status, 303);
  return admin;
}

async function resolve(client: Client, disputeId: number, ruling: string): Promise<Response> {
  return client.fetch(`/api/admin/disputes/${disputeId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ruling }),
  });
}

test('an Admin sees every Dispute awaiting a decision, with the Student and the Course', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);

  const admin = await asAdmin();
  const page = await admin.fetch('/admin/disputes');
  assert.equal(page.status, 200);

  const html = await page.text();
  assert.ok(html.includes(client.username), 'which Student it came from');
  assert.ok(html.includes(DETERMINISTIC_COURSE.title), 'and which Course');
});

test('the queue also says how often the Coherence Guard fired', async () => {
  // Beside the Dispute figures rather than on a screen of its own: a guard
  // firing and an upheld objection are the two ways this system records that the
  // Grader was wrong.
  //
  // Every Submission this suite can make is a Deterministic Check — a hermetic
  // test cannot make a live model disagree with its own error list — so what is
  // asserted here is the reading an application in that state must give: the
  // panel is present and says plainly that nothing has been judged, rather than
  // rendering empty or claiming a rate over answers the guard never saw. The
  // counting itself is pinned in `guard-firings.test.ts`, over rows.
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);

  const admin = await asAdmin();
  const html = await (await admin.fetch('/admin/disputes')).text();

  assert.ok(html.includes(ru.coherenceGuard.title), 'the panel is on the queue screen');
  assert.ok(html.includes(ru.coherenceGuard.nothingJudged),
    'and an application the Grader has judged nothing in says so');
});

test('one Dispute opens with everything the decision has to be made against', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!, 'Я уверен, что «the» здесь допустимо.');

  const admin = await asAdmin();
  const page = await admin.fetch(`/admin/disputes/${disputeIdFor(result.submissionId!)}`);
  assert.equal(page.status, 200);

  const html = await page.text();
  assert.ok(html.includes('Я уверен, что «the» здесь допустимо.'), 'the Student’s comment');
  assert.ok(html.includes(ru.disputeReview.referenceAnswer), 'the Reference Answer');
  assert.ok(html.includes(ru.disputeReview.studentAnswer), 'the Student’s answer');
  assert.ok(html.includes(ru.disputeReview.uphold), 'and both decisions');
  assert.ok(html.includes(ru.disputeReview.reject));
});

test('only an Admin can reach the queue — a Student gets a 404', async () => {
  const client = await signedIn();

  assert.equal((await client.fetch('/admin/disputes')).status, 404);
  assert.equal((await client.fetch('/admin/disputes/1')).status, 404);
});

test('only an Admin can resolve anything — a Student gets a 404', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);
  const disputeId = disputeIdFor(result.submissionId!);

  // The Student who made it has no more right to decide it than anyone else.
  assert.equal((await resolve(client, disputeId, 'upheld')).status, 404);

  const other = await signedIn();
  assert.equal((await resolve(other, disputeId, 'upheld')).status, 404);

  // And it is still waiting, so the refusal refused rather than merely hid.
  const admin = await asAdmin();
  const queue = await (await admin.fetch('/admin/disputes')).text();
  assert.ok(queue.includes(`/admin/disputes/${disputeId}`), 'still in the queue');
});

test('upholding through the endpoint promotes the answer and empties the row from the queue', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);
  const disputeId = disputeIdFor(result.submissionId!);

  const admin = await asAdmin();
  const response = await resolve(admin, disputeId, 'upheld');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ruling: 'upheld', variantAdded: true });

  const page = await admin.fetch(`/admin/disputes/${disputeId}`);
  assert.ok((await page.text()).includes(ru.dispute.upheld), 'and it still reads as decided');
});

// --- #85: an upheld Dispute confirms one answer, at one Gap ------------------

/** The multi-gap Lesson's first Exercise: «___ have ___ apple and ___ cat.» */
function multiGapExercise() {
  const [lesson] = lessonsOf(app.databasePath, MULTI_GAP_COURSE.title);
  if (!lesson) throw new Error('the multi-gap fixture seeded no Lesson');
  return lesson.exercises[0]!;
}

/** One answer to it, written gap by gap. */
async function answerGaps(client: SignedIn, written: string[]): Promise<ResultFrame> {
  const response = await client.fetch(`/api/exercises/${multiGapExercise().id}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: written }),
  });
  assert.ok(response.ok, `answering was refused with ${response.status}`);
  const frames = (await response.text()).split('\n').filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Frame);
  const result = frames.find((f): f is ResultFrame => f.t === 'result');
  assert.ok(result, 'the stream carried no result frame');
  return result;
}

/** A partly wrong answer to it, and an objection to the Verdict. */
async function objectToGaps(client: SignedIn, written: string[]): Promise<number> {
  const result = await answerGaps(client, written);
  await dispute(client, result.submissionId!, 'Во втором пропуске так тоже можно.');
  return disputeIdFor(result.submissionId!);
}

test('the review screen asks which Gap the confirmed answer is for', async () => {
  const client = await signedIn();
  const disputeId = await objectToGaps(client, ['I', 'one', 'a']);

  const admin = await asAdmin();
  const page = await (await admin.fetch(`/admin/disputes/${disputeId}`)).text();

  assert.ok(page.includes(ru.disputeReview.chooseGap), 'the question is on the screen');
  assert.ok(page.includes(ru.disputeReview.acceptedAtGap(2)), 'and each Gap is named');
});

test('upholding without naming a Gap is refused, and names nothing itself', async () => {
  const client = await signedIn();
  const disputeId = await objectToGaps(client, ['I', 'two', 'a']);

  const admin = await asAdmin();
  const response = await resolve(admin, disputeId, 'upheld');
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { error: string }).error, ru.disputeReview.gapUnspecified);

  // Still waiting, so nothing was recorded on the way past.
  const queue = await (await admin.fetch('/admin/disputes')).text();
  assert.ok(queue.includes(`/admin/disputes/${disputeId}`), 'still in the queue');
});

test('upholding at a named Gap accepts that answer there and nowhere else', async () => {
  const client = await signedIn();
  const disputeId = await objectToGaps(client, ['I', 'three', 'a']);

  const admin = await asAdmin();
  const response = await admin.fetch(`/api/admin/disputes/${disputeId}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ruling: 'upheld', gap: 1 }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ruling: 'upheld', variantAdded: true });

  // What the next Students to answer this Exercise are judged against.
  const atItsOwnGap = await answerGaps(await signedIn(), ['I', 'three', 'a']);
  assert.equal(atItsOwnGap.verdict, 'correct', 'accepted at the Gap it was confirmed for');

  const elsewhere = await answerGaps(await signedIn(), ['three', 'an', 'a']);
  assert.deepEqual(elsewhere.gaps, [false, true, true],
    'and the word confirmed for the second Gap is not accepted in the first');
});

test('a decision that is not one of the two is refused rather than guessed at', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);

  const admin = await asAdmin();
  assert.equal((await resolve(admin, disputeIdFor(result.submissionId!), 'maybe')).status, 400);
});

test('a Dispute already decided is not decided again', async () => {
  const { client, result } = await toldTheyAreWrong();
  await dispute(client, result.submissionId!);
  const disputeId = disputeIdFor(result.submissionId!);

  const admin = await asAdmin();
  assert.equal((await resolve(admin, disputeId, 'rejected')).status, 200);

  const again = await resolve(admin, disputeId, 'upheld');
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { error: string }).error, ru.disputeReview.alreadyResolved);
});
