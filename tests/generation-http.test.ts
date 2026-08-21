// Seam 1 — Generation, Refinement and the publish confirmation over HTTP.
//
// Two claims are worth a booted application here.
//
// The first is the guard: the authoring section is only as gated as its least
// gated endpoint, and two new ones have just been added to it.
//
// The second is the failure path, tested the way the Grader's already is —
// against an application that genuinely cannot reach a model, with no mock
// anywhere. What is asserted is the shape of the failure and, more importantly,
// what it did **not** write: a Generation that fails must leave the Draft that
// was there exactly as it was, and an Admin must never be left unsure whether
// what they are reading came from Claude or was already on the screen.
//
// The happy path is not automated, for the reason step 2's healthy check is not:
// it needs real credentials and a real paid call, and it is a minutes-long one.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { bootApp, Client, ADMIN, STUDENT, type BootedApp } from './helpers/app.ts';
import { withDatabase } from './helpers/inspect.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { lessons, lessonDrafts } from '../src/db/schema.ts';
import { takeFrames, type AuthoringResultFrame } from '../src/authoring/wire.ts';
import type { LessonDocument } from '../src/content/lesson-document.ts';

const AUTHORING_ENDPOINTS = ['/api/admin/lessons/1/generate', '/api/admin/lessons/1/refine'];

const A_DOCUMENT: LessonDocument = {
  title: 'Артикль a/an',
  grammarFocus: 'Indefinite article',
  theoryMarkdown: 'Теория.',
  exercises: [{
    kind: 'translation',
    prompt: 'Переведите: У меня есть кошка.',
    referenceAnswer: 'I have a cat.',
    acceptedAnswers: [],
    caseSensitive: false,
    choices: [],
  }],
};

const A_GENERATION = {
  topic: 'Неопределённый артикль',
  vocabulary: ['cat', 'apple'],
  exerciseCount: 3,
  kindMix: { translation: 2 },
  wishes: '',
  continueFromLessonId: null,
  model: 'claude-sonnet-5',
  effort: 'low',
};

let app: BootedApp;

// HOME is broken on purpose, so the SDK cannot authenticate and every authoring
// call fails. What is under test is the shape of the failure, not the model.
before(async () => {
  app = await bootApp({ content: [ENGLISH_A1], env: { HOME: '/nonexistent-home-for-this-test' } });
}, { timeout: 180_000 });

after(async () => { await app?.stop(); });

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

/** Every frame of an authoring stream, read to the end. */
async function framesOf(response: Response): Promise<AuthoringResultFrame[]> {
  const text = await response.text();
  const { frames } = takeFrames(`${text}\n`);
  return frames.filter((frame): frame is AuthoringResultFrame => frame.t === 'result');
}

function draftsOf(lessonId: number) {
  return withDatabase(app.databasePath, (db) =>
    db.select().from(lessonDrafts).where(eq(lessonDrafts.lessonId, lessonId)).all());
}

function firstLessonId(): number {
  return withDatabase(app.databasePath, (db) => db.select().from(lessons).all()[0]!.id);
}

// --- The guard ---------------------------------------------------------------

test('the authoring endpoints are closed to a Student who is not an Admin', async () => {
  // 404 rather than a "forbidden" screen, the same choice the rest of the section
  // makes: a Student who is not an Admin should not learn that an authoring
  // surface exists at all.
  const client = await signedIn(STUDENT);
  for (const path of AUTHORING_ENDPOINTS) {
    assert.equal((await postJson(client, path, A_GENERATION)).status, 404, path);
  }
});

test('the authoring endpoints are closed to nobody at all', async () => {
  const anonymous = new Client(app.baseUrl);
  for (const path of AUTHORING_ENDPOINTS) {
    const response = await postJson(anonymous, path, A_GENERATION);
    assert.ok(response.status === 401 || response.status === 404 || response.status === 307, path);
  }
});

test('a Lesson that does not exist is not found, whoever asks', async () => {
  const admin = await signedIn(ADMIN);
  assert.equal((await postJson(admin, '/api/admin/lessons/9999/generate', A_GENERATION)).status, 404);
});

// --- Refused before it costs anything ----------------------------------------

test('an impossible request is refused as a fault an Admin can read', async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();
  const before = draftsOf(lessonId).length;

  const response = await postJson(admin, `/api/admin/lessons/${lessonId}/generate`, {
    ...A_GENERATION, topic: '   ',
  });

  // 422, not 400: the request was understood, and the Admin is told which input
  // is impossible rather than that their Generation "failed".
  assert.equal(response.status, 422);
  const body = await response.json() as { faults: { code: string }[] };
  assert.deepEqual(body.faults.map((fault) => fault.code), ['topic_empty']);
  assert.equal(draftsOf(lessonId).length, before, 'and nothing was written');
});

test('a body that is not the form at all is malformed', async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();

  for (const body of [
    { ...A_GENERATION, model: 'claude-haiku-4-5' },
    { ...A_GENERATION, effort: 'maximum' },
    { ...A_GENERATION, kindMix: { essay: 2 } },
  ]) {
    assert.equal((await postJson(admin, `/api/admin/lessons/${lessonId}/generate`, body)).status, 400);
  }
});

// --- The failure path --------------------------------------------------------

test('a Generation that cannot reach a model reports a failure and writes nothing', { timeout: 180_000 }, async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();
  const before = draftsOf(lessonId);

  const response = await postJson(admin, `/api/admin/lessons/${lessonId}/generate`, A_GENERATION);
  // The stream itself succeeded — a failed Generation is a result on the wire,
  // not an error status, exactly as a failed grading is.
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /x-ndjson/);

  const results = await framesOf(response);
  assert.equal(results.length, 1, 'exactly one terminal frame');
  const result = results[0]!;
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'call_failed');

  // The claim that matters: the Draft that was there is exactly as it was.
  assert.deepEqual(draftsOf(lessonId).map((d) => d.id), before.map((d) => d.id));
});

test('a Refinement that cannot reach a model leaves the Draft and the thread alone', { timeout: 180_000 }, async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();

  // A Draft to converse about, saved through the endpoint an Admin would use.
  const saved = await postJson(admin, `/api/admin/lessons/${lessonId}/draft`, A_DOCUMENT);
  assert.equal(saved.status, 200);
  const { draftId } = await saved.json() as { draftId: number };
  const before = draftsOf(lessonId);

  const response = await postJson(admin, `/api/admin/lessons/${lessonId}/refine`, {
    document: A_DOCUMENT,
    message: 'Третье упражнение слишком лёгкое.',
    fromDraftId: draftId,
    model: 'claude-sonnet-5',
    effort: 'low',
  });
  assert.equal(response.status, 200);

  const results = await framesOf(response);
  assert.equal(results[0]?.ok, false);
  assert.deepEqual(
    draftsOf(lessonId).map((d) => d.id), before.map((d) => d.id),
    'a failed turn appends no Draft, so the thread is where it was',
  );
});

test('a Refinement with nothing asked is refused before the call', async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();

  const response = await postJson(admin, `/api/admin/lessons/${lessonId}/refine`, {
    document: A_DOCUMENT, message: '   ', fromDraftId: null, model: 'claude-sonnet-5',
  });
  assert.equal(response.status, 422);
  const body = await response.json() as { faults: { code: string }[] };
  assert.deepEqual(body.faults.map((f) => f.code), ['message_empty']);
});

// --- Publishing what Claude wrote --------------------------------------------
//
// A Claude-written Draft is planted directly, because producing one over HTTP
// needs a live model and this is not what that would be testing. What is under
// test is the gate in front of Publish, and the gate reads rows.

function plantGeneratedDraft(lessonId: number, document: LessonDocument): number {
  return withDatabase(app.databasePath, (db) => db.insert(lessonDrafts).values({
    lessonId,
    document,
    origin: 'generation',
    sessionId: 'planted-session',
    refinementRequest: null,
    publishedAt: null,
    createdBy: null,
    createdAt: new Date(),
  }).returning().get().id);
}

test('publishing a Draft that came from Claude asks first, and cancelling publishes nothing', async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();
  const draftId = plantGeneratedDraft(lessonId, A_DOCUMENT);
  const liveBefore = withDatabase(app.databasePath, (db) =>
    db.select().from(lessons).where(eq(lessons.id, lessonId)).get()!);

  const asked = await postJson(admin, `/api/admin/lessons/${lessonId}/publish`, { draftId });

  // 409, not 422: nothing is wrong with the Draft. It is a question.
  assert.equal(asked.status, 409);
  const body = await asked.json() as { reason: string; unreviewed: number };
  assert.equal(body.reason, 'unreviewed');
  assert.equal(body.unreviewed, 1, 'and it says how many, because a count is what makes it answerable');

  // Cancelling is simply not answering: nothing was published by asking.
  const live = withDatabase(app.databasePath, (db) =>
    db.select().from(lessons).where(eq(lessons.id, lessonId)).get()!);
  assert.equal(live.title, liveBefore.title);
  assert.equal(live.theoryMarkdown, liveBefore.theoryMarkdown);
  assert.equal(
    withDatabase(app.databasePath, (db) =>
      db.select().from(lessonDrafts).where(eq(lessonDrafts.id, draftId)).get()!.publishedAt),
    null,
  );
});

test('confirming publishes exactly the Draft that was asked about', async () => {
  const admin = await signedIn(ADMIN);
  const lessonId = firstLessonId();
  const draftId = plantGeneratedDraft(lessonId, { ...A_DOCUMENT, title: 'Подтверждённый урок' });

  const published = await postJson(admin, `/api/admin/lessons/${lessonId}/publish`, {
    draftId, confirmed: true,
  });
  assert.equal(published.status, 200);

  assert.equal(
    withDatabase(app.databasePath, (db) =>
      db.select().from(lessons).where(eq(lessons.id, lessonId)).get()!.title),
    'Подтверждённый урок',
  );
});

test('a Draft whose Reference Answers have all been rewritten publishes with no question', async () => {
  // The criterion that stops the confirmation being a click tax: it falls silent
  // for somebody who did the work.
  const admin = await signedIn(ADMIN);
  const lessonId = withDatabase(app.databasePath, (db) => db.select().from(lessons).all()[1]!.id);

  plantGeneratedDraft(lessonId, A_DOCUMENT);
  const reviewed = await postJson(admin, `/api/admin/lessons/${lessonId}/draft`, {
    ...A_DOCUMENT,
    title: 'Проверенный урок',
    exercises: [{ ...A_DOCUMENT.exercises[0], referenceAnswer: 'I have got a cat.' }],
  });
  assert.equal(reviewed.status, 200);
  const { draftId } = await reviewed.json() as { draftId: number };

  const published = await postJson(admin, `/api/admin/lessons/${lessonId}/publish`, { draftId });
  assert.equal(published.status, 200, 'no confirmation was asked for');
});
