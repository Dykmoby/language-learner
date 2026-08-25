// Seam 2 — Generation and Refinement against a real database, with no HTTP and
// no model in the way.
//
// Everything that happens either side of the call is here: what a request is
// refused for before it costs anything, what context it is given, what a
// Claude-written Draft looks like once it lands, what the conversation reads back
// as, and what a person still has to look at before any of it becomes a Lesson.
//
// The call itself is not here. It is the one part that needs a model, and it is
// covered at the HTTP seam against an application that cannot reach one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { lessons, students, lessonDrafts } from '../src/db/schema.ts';
import {
  claudeAncestor, draftHistory, publishReview, publishedLessonsUpTo,
  refinementThread, restoreDraft, saveDraft,
} from '../src/admin/drafts.ts';
import { createLesson } from '../src/admin/authoring.ts';
import { startGeneration } from '../src/authoring/generation.ts';
import { startRefinement, shouldStartFresh } from '../src/authoring/refinement.ts';
import type { AuthoringOutcome } from '../src/authoring/call.ts';
import { EMPTY_USAGE } from '../src/claude/harness.ts';
import { earlierLessonContext } from '../src/authoring/contract.ts';
import type { LessonDocument } from '../src/content/lesson-document.ts';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [
    { username: 'igor', password: 'correct horse battery', isAdmin: true },
    { username: 'student', password: 'staple monkey trombone', isAdmin: false },
  ]);
  seedCourseContent(handle.db, ENGLISH_A1);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

type Db = ReturnType<typeof freshDatabase>['db'];

const admin = (db: Db) => db.select().from(students).where(eq(students.username, 'igor')).get()!;
const firstLesson = (db: Db) => db.select().from(lessons).orderBy(asc(lessons.position)).all()[0]!;

function document(...referenceAnswers: string[]): LessonDocument {
  return {
    title: 'Артикль a/an',
    grammarFocus: 'Indefinite article',
    theoryMarkdown: 'Теория.',
    exercises: referenceAnswers.map((referenceAnswer, index) => ({
      kind: 'translation' as const,
      prompt: `Переведите предложение ${index + 1}.`,
      referenceAnswer,
      acceptedAnswers: [],
      caseSensitive: false,
      choices: [],
    })),
  };
}

const FORM = {
  topic: 'Артикли',
  vocabulary: ['cat'],
  exerciseCount: 4,
  kindMix: {},
  wishes: '',
  continueFromLessonId: null,
  model: 'claude-sonnet-5',
};

// --- Refused before it costs anything ----------------------------------------

test('a Generation for a Lesson that does not exist is not found', () => {
  const handle = freshDatabase();
  try {
    const started = startGeneration(handle.db, { lessonId: 9999, studentId: admin(handle.db).id, form: FORM });
    assert.equal(started.ok, false);
    if (started.ok) return;
    assert.equal(started.reason, 'not_found');
  } finally { handle.cleanup(); }
});

test('an impossible request is refused before a single token is spent', () => {
  // A Generation is minutes of work. Refusing afterwards spends all of them to
  // say something that was knowable at the moment the button was pressed — and
  // the refusal names the input rather than reporting a failure.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const started = startGeneration(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      form: { ...FORM, topic: '   ', exerciseCount: 0 },
    });

    assert.equal(started.ok, false);
    if (started.ok) return;
    assert.equal(started.reason, 'invalid_request');
    assert.deepEqual(started.faults, ['topic_empty', 'exercise_count_out_of_range']);

    // And nothing was written on the way past.
    assert.equal(draftHistory(handle.db, lesson.id).length, 0);
  } finally { handle.cleanup(); }
});

test('a Refinement with nothing asked is refused, and writes nothing', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const started = startRefinement(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      form: { document: document('I have a cat.'), message: '  ', fromDraftId: null, model: 'claude-sonnet-5' },
    });

    assert.equal(started.ok, false);
    if (started.ok || started.reason !== 'invalid_request') return;
    assert.deepEqual(started.faults, ['message_empty']);
    assert.equal(draftHistory(handle.db, lesson.id).length, 0);
  } finally { handle.cleanup(); }
});

// --- The context a Generation is given ---------------------------------------

test('"continue from Lesson N" reads the published Lessons up to it, and only those', () => {
  // Published, not Drafts. The point is continuity with what the Student has
  // actually worked through — building on a Draft nobody published would produce
  // a Lesson referencing material the Student has never seen.
  const handle = freshDatabase();
  try {
    const all = handle.db.select().from(lessons).orderBy(asc(lessons.position)).all();
    assert.ok(all.length >= 2, 'the fixture seeds more than one Lesson');

    const unpublished = createLesson(handle.db, {
      courseId: all[0]!.courseId,
      title: 'Ещё не опубликован',
      studentId: admin(handle.db).id,
    });
    assert.equal(unpublished.ok, true);

    const upToFirst = publishedLessonsUpTo(handle.db, all[0]!.id);
    assert.deepEqual(upToFirst.map((l) => l.id), [all[0]!.id], 'nothing after it, and nothing unpublished');

    const upToLast = publishedLessonsUpTo(handle.db, all.at(-1)!.id);
    assert.deepEqual(upToLast.map((l) => l.id), all.map((l) => l.id));

    if (!unpublished.ok) return;
    assert.deepEqual(
      publishedLessonsUpTo(handle.db, unpublished.lesson.id).map((l) => l.id),
      all.map((l) => l.id),
      'an unpublished Lesson can still continue from the published ones before it',
    );
  } finally { handle.cleanup(); }
});

test('the earlier-Lesson context is bounded before it reaches a prompt', () => {
  // How much context is worth paying for is the Author\'s contract\'s decision,
  // not the database\'s — the query returns whole Theories and the bounding
  // happens on the way into the prompt.
  const handle = freshDatabase();
  try {
    const published = publishedLessonsUpTo(handle.db, firstLesson(handle.db).id);
    const context = earlierLessonContext(published);
    assert.equal(context.length, published.length);
    assert.equal(context[0]!.title, published[0]!.title);
    assert.ok(context[0]!.summary.length > 0);
  } finally { handle.cleanup(); }
});

// --- What a Claude-written Draft looks like once it lands ---------------------

test('a generated Draft is appended, marked, and invisible to a Student', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    const first = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a cat.'),
      origin: 'generation', sessionId: 'session-one',
    });
    const second = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a dog.'),
      origin: 'generation', sessionId: 'session-two',
    });
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;

    // Generating twice appends twice; neither overwrites the Draft before it.
    const history = draftHistory(handle.db, lesson.id);
    assert.deepEqual(history.map((entry) => entry.id), [second.draft.id, first.draft.id]);
    assert.deepEqual(history.map((entry) => entry.origin), ['generation', 'generation']);

    // And nothing a Student reads has moved.
    assert.equal(first.draft.publishedAt, null);
    assert.equal(second.draft.publishedAt, null);
    assert.equal(
      handle.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!.title,
      lesson.title,
      'the published Lesson is untouched until somebody publishes',
    );
  } finally { handle.cleanup(); }
});

test('a Draft records the session it came out of, so a restore forks rather than rewinds', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    const turn = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a cat.'),
      origin: 'refinement', sessionId: 'session-abc', refinementRequest: 'Добавь упражнение.',
    });
    assert.equal(turn.ok, true);
    if (!turn.ok) return;

    const stored = handle.db.select().from(lessonDrafts).where(eq(lessonDrafts.id, turn.draft.id)).get()!;
    assert.equal(stored.sessionId, 'session-abc');
    assert.equal(stored.refinementRequest, 'Добавь упражнение.');
  } finally { handle.cleanup(); }
});

test('restoring an earlier Draft brings its conversation back with it', () => {
  // The whole of what makes an old Draft more than old text. Going back three
  // turns and carrying on has to be a fork of the conversation at that point; a
  // restore that dropped the session would leave the text without the thread that
  // produced it, which is the rewind the append-only history exists to avoid.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    const firstTurn = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a cat.'),
      origin: 'refinement', sessionId: 'session-one', refinementRequest: 'Первая просьба.',
    });
    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a dog.'),
      origin: 'refinement', sessionId: 'session-two', refinementRequest: 'Вторая просьба.',
    });
    assert.equal(firstTurn.ok, true);
    if (!firstTurn.ok) return;

    const restored = restoreDraft(handle.db, {
      lessonId: lesson.id, draftId: firstTurn.draft.id, studentId,
    });
    assert.equal(restored.ok, true);
    if (!restored.ok) return;

    assert.equal(restored.draft.origin, 'restore');
    assert.equal(
      restored.draft.sessionId, 'session-one',
      'refining from here forks the first turn, not the last',
    );
    assert.equal(
      restored.draft.refinementRequest, null,
      'a restore is not a turn, and must not put words in an Admin\'s mouth',
    );
  } finally { handle.cleanup(); }
});

test('a hand edit stays inside the conversation', () => {
  // ADR 0004 has manual edits and conversation interleaving with no merge step
  // anywhere. That only holds if saving a typo fix keeps the thread: otherwise
  // fixing one character silently ends the discussion.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a cat.'),
      origin: 'generation', sessionId: 'session-one',
    });
    const edited = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I have a cat!'),
    });

    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.draft.origin, 'manual', 'it is still a hand edit');
    assert.equal(edited.draft.sessionId, 'session-one', 'and still the same conversation');
  } finally { handle.cleanup(); }
});

test('a Lesson that has never been conversed about has no session to inherit', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const saved = saveDraft(handle.db, {
      lessonId: lesson.id, studentId: admin(handle.db).id, document: document('I have a cat.'),
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.draft.origin, 'manual');
    assert.equal(saved.draft.sessionId, null);
    assert.equal(saved.draft.refinementRequest, null);
  } finally { handle.cleanup(); }
});

// --- The conversation, read back out of the rows -----------------------------

test('the thread is the Drafts, in order, and survives anything that reloads a page', () => {
  // Read back out of the rows rather than out of a table of its own: every turn
  // already appends one carrying the request, the document it produced and the
  // session it came from. A separate transcript would be a second history that
  // could disagree with this one.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    saveDraft(handle.db, { lessonId: lesson.id, studentId, document: document('a') });
    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('b'),
      origin: 'refinement', sessionId: 's1', refinementRequest: 'Первая просьба.',
    });
    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('c'),
      origin: 'refinement', sessionId: 's2', refinementRequest: 'Вторая просьба.',
    });

    const thread = refinementThread(handle.db, lesson.id);
    assert.deepEqual(thread.map((turn) => turn.message), ['Первая просьба.', 'Вторая просьба.']);
    assert.deepEqual(thread.map((turn) => turn.sessionId), ['s1', 's2']);
    assert.ok(thread[0]!.draftId < thread[1]!.draftId, 'oldest first');
  } finally { handle.cleanup(); }
});

// --- What a person still has to look at --------------------------------------

test('a Draft an Admin typed publishes with no confirmation, as it does today', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const saved = saveDraft(handle.db, {
      lessonId: lesson.id, studentId: admin(handle.db).id, document: document('I have a cat.'),
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    assert.equal(claudeAncestor(handle.db, saved.draft.id), null);
    assert.deepEqual(publishReview(handle.db, saved.draft.id), { fromClaude: false, unreviewed: 0 });
  } finally { handle.cleanup(); }
});

test('a Draft descended from Claude names how many Reference Answers nobody has read', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    const generated = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, origin: 'generation', sessionId: 's1',
      document: document('I have a cat.', 'She is an artist.', 'We need an apple.'),
    });
    // The Admin went through one Exercise by hand and saved.
    const edited = saveDraft(handle.db, {
      lessonId: lesson.id, studentId,
      document: document('I have got a cat.', 'She is an artist.', 'We need an apple.'),
    });
    assert.equal(generated.ok && edited.ok, true);
    if (!generated.ok || !edited.ok) return;

    assert.equal(claudeAncestor(handle.db, edited.draft.id)?.id, generated.draft.id);
    assert.deepEqual(publishReview(handle.db, edited.draft.id), { fromClaude: true, unreviewed: 2 });
  } finally { handle.cleanup(); }
});

test('a Draft whose every Exercise has since been edited asks nothing', () => {
  // The criterion that stops this being a click tax: it has to fall silent for
  // somebody who did the work.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, origin: 'generation', sessionId: 's1',
      document: document('I have a cat.', 'She is an artist.'),
    });
    const reviewed = saveDraft(handle.db, {
      lessonId: lesson.id, studentId,
      document: document('I have got a cat.', 'She works as an artist.'),
    });
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;

    assert.deepEqual(publishReview(handle.db, reviewed.draft.id), { fromClaude: true, unreviewed: 0 });
  } finally { handle.cleanup(); }
});

test('the newest Claude-written ancestor is the one reviewed against', () => {
  // An Admin who has refined three times is reviewing the third turn's answers,
  // not the first turn's — the first turn's may not be in the document at all.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, origin: 'generation', sessionId: 's1',
      document: document('First draft answer.'),
    });
    const refined = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, origin: 'refinement', sessionId: 's2',
      refinementRequest: 'Перепиши.',
      document: document('Second draft answer.'),
    });
    assert.equal(refined.ok, true);
    if (!refined.ok) return;

    assert.equal(claudeAncestor(handle.db, refined.draft.id)?.id, refined.draft.id);
    assert.deepEqual(publishReview(handle.db, refined.draft.id), { fromClaude: true, unreviewed: 1 });
  } finally { handle.cleanup(); }
});

test('a Draft written before its Lesson ever saw Claude is judged on its own ancestry', () => {
  // Ancestry is "at or before it", because the history only ever grows. A Draft
  // typed on Monday is not retroactively suspect because a Generation ran on
  // Tuesday.
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;

    const typed = saveDraft(handle.db, {
      lessonId: lesson.id, studentId, document: document('I typed this myself.'),
    });
    saveDraft(handle.db, {
      lessonId: lesson.id, studentId, origin: 'generation', sessionId: 's1',
      document: document('Claude wrote this.'),
    });
    assert.equal(typed.ok, true);
    if (!typed.ok) return;

    assert.deepEqual(publishReview(handle.db, typed.draft.id), { fromClaude: false, unreviewed: 0 });
  } finally { handle.cleanup(); }
});

test('a Draft of another Lesson is never anybody\'s ancestor', () => {
  const handle = freshDatabase();
  try {
    const all = handle.db.select().from(lessons).orderBy(asc(lessons.position)).all();
    const studentId = admin(handle.db).id;

    saveDraft(handle.db, {
      lessonId: all[0]!.id, studentId, origin: 'generation', sessionId: 's1',
      document: document('Claude wrote this for the first Lesson.'),
    });
    const other = saveDraft(handle.db, {
      lessonId: all[1]!.id, studentId,
      document: document('Claude wrote this for the first Lesson.'),
    });
    assert.equal(other.ok, true);
    if (!other.ok) return;

    assert.equal(claudeAncestor(handle.db, other.draft.id), null);
    assert.equal(publishReview(handle.db, other.draft.id).fromClaude, false);
  } finally { handle.cleanup(); }
});

// --- When a lost conversation is started again -------------------------------
//
// The judgement in the Refinement module, and the one part of it that cannot be
// provoked from a live call on demand: a session file that has gone is not
// something a test can arrange by asking a model nicely.

function callFailed(
  kind: 'sdk' | 'timeout' | 'aborted',
  raw: string | null = null,
): AuthoringOutcome {
  return {
    ok: false,
    sessionId: null,
    usage: EMPTY_USAGE,
    wallMs: 1,
    failure: {
      kind: 'call',
      call: {
        kind, reason: 'no', raw,
        likelyCredentials: false, likelyEgress: false, likelyRateLimit: false,
      },
    },
  };
}

test('a session that could not be resumed is started again, fresh', () => {
  // The shape a resume failure has: it fails before the model is reached, so no
  // text arrives at all.
  assert.equal(shouldStartFresh('session-abc', callFailed('sdk')), true);
});

test('a turn that never named a session has nothing to fall back from', () => {
  // A second identical call would fail identically. Retrying would double the
  // wait to say the same thing.
  assert.equal(shouldStartFresh(undefined, callFailed('sdk')), false);
});

test('a timeout is not retried, and neither is an abandonment', () => {
  // A timeout means the call ran and ran; retrying doubles a wait that was
  // already too long. An abandonment is a decision the Admin has already made.
  assert.equal(shouldStartFresh('session-abc', callFailed('timeout')), false);
  assert.equal(shouldStartFresh('session-abc', callFailed('aborted')), false);
});

test('a call that had begun writing is never restarted', () => {
  // Restarting after half a document had streamed would put a second beginning
  // after a first middle — precisely the "half a Lesson" the failure rules exist
  // to prevent.
  assert.equal(shouldStartFresh('session-abc', callFailed('sdk', '{"title": "Артик')), false);
});

test('a turn that worked is not retried for any reason', () => {
  assert.equal(
    shouldStartFresh('session-abc', {
      ok: true,
      document: document('I have a cat.'),
      mismatches: [],
      sessionId: 'session-abc',
      usage: EMPTY_USAGE,
      wallMs: 1,
    }),
    false,
  );
});
