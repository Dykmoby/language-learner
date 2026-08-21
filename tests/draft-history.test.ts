// Seam 2/3 — the Draft history against a real database.
//
// The rule the whole surface rests on is that restoring appends. A restore that
// truncated would let an Admin destroy work by browsing, and the point of
// keeping every turn is that Generation will soon be producing versions nobody
// chose. So: the history only grows, and restoring is itself undoable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { lessons, students, lessonDrafts, submissions, exercises, exerciseSets } from '../src/db/schema.ts';
import {
  draftHistory, latestDraft, publishDraft, publishedDocument, restoreDraft, saveDraft,
  submissionCounts,
} from '../src/admin/drafts.ts';
import { createCourse, createLesson } from '../src/admin/authoring.ts';
import { DEFAULT_GRADER_MODEL } from '../src/content/course-options.ts';

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

function saved(db: Db, lessonId: number, theoryMarkdown: string) {
  const document = { ...publishedDocument(db, lessonId)!, theoryMarkdown };
  const result = saveDraft(db, { lessonId, studentId: admin(db).id, document });
  if (!result.ok) throw new Error(`the Draft was refused: ${result.faults.map((f) => f.code).join(', ')}`);
  return result.draft;
}

test('every Draft is in the history, newest first, with its origin and its author', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const lesson = firstLesson(db);

    saved(db, lesson.id, '# Первая правка');
    saved(db, lesson.id, '# Вторая правка');

    const history = draftHistory(db, lesson.id);
    assert.equal(history.length, 2);
    assert.deepEqual(
      history.map((entry) => entry.origin),
      ['manual', 'manual'],
      'manual editing is the only origin in use so far',
    );
    assert.deepEqual(history.map((entry) => entry.authorUsername), ['igor', 'igor']);
    assert.ok(history[0]!.id > history[1]!.id, 'newest first');
    assert.deepEqual(history.map((entry) => entry.publishedAt), [null, null]);
  } finally {
    handle.cleanup();
  }
});

test('a Lesson whose only Draft is its first renders the history without a special case', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const created = createCourse(db, {
      language: 'en', level: 'A1', graderModel: DEFAULT_GRADER_MODEL.en, title: 'Новый курс',
    });
    if (!created.ok) throw new Error('the Course was refused');
    const lesson = createLesson(db, { courseId: created.course.id, title: 'Урок', studentId: admin(db).id });
    if (!lesson.ok) throw new Error('the Lesson was refused');

    const history = draftHistory(db, lesson.lesson.id);
    assert.equal(history.length, 1, 'the Draft a Lesson starts as');
    assert.equal(history[0]!.origin, 'manual');
    assert.equal(history[0]!.exerciseCount, 0);
  } finally {
    handle.cleanup();
  }
});

test('a published Draft says so in the history, and the others do not', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const lesson = firstLesson(db);

    const first = saved(db, lesson.id, '# Опубликованная правка');
    assert.equal(publishDraft(db, first.id).ok, true);
    saved(db, lesson.id, '# Ещё не опубликованная правка');

    const history = draftHistory(db, lesson.id);
    assert.equal(history[0]!.publishedAt, null, 'the newest is not live');
    assert.notEqual(history[1]!.publishedAt, null, 'the one that was published records when');
  } finally {
    handle.cleanup();
  }
});

test('restoring appends a new Draft and deletes nothing', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const lesson = firstLesson(db);

    const first = saved(db, lesson.id, '# Первая правка');
    saved(db, lesson.id, '# Вторая правка');
    const before = db.select().from(lessonDrafts).where(eq(lessonDrafts.lessonId, lesson.id)).all();

    const restored = restoreDraft(db, { lessonId: lesson.id, draftId: first.id, studentId: admin(db).id });
    assert.equal(restored.ok, true);
    if (!restored.ok) return;

    assert.equal(restored.draft.document.theoryMarkdown, '# Первая правка', 'it holds what it held');
    assert.equal(restored.draft.origin, 'restore', 'and says that is where it came from');
    assert.equal(latestDraft(db, lesson.id)!.id, restored.draft.id, 'it is now the newest');

    const after = db.select().from(lessonDrafts).where(eq(lessonDrafts.lessonId, lesson.id)).all();
    assert.equal(after.length, before.length + 1, 'the history only grows');
    for (const draft of before) {
      assert.ok(after.some((row) => row.id === draft.id), `Draft ${draft.id} is still there`);
    }

    // Restoring is itself an undoable act: the version that was newest before
    // the restore is still there to be restored in turn.
    const undone = restoreDraft(db, { lessonId: lesson.id, draftId: before[1]!.id, studentId: admin(db).id });
    assert.equal(undone.ok, true);
    assert.equal(latestDraft(db, lesson.id)!.document.theoryMarkdown, '# Вторая правка');
  } finally {
    handle.cleanup();
  }
});

test('restoring does not change what a Student reads', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const lesson = firstLesson(db);

    const original = saved(db, lesson.id, '# Опубликованная теория');
    assert.equal(publishDraft(db, original.id).ok, true);
    const live = db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;

    const draft = saved(db, lesson.id, '# Совсем другая теория');
    assert.equal(restoreDraft(db, { lessonId: lesson.id, draftId: draft.id, studentId: admin(db).id }).ok, true);

    assert.deepEqual(
      db.select().from(lessons).where(eq(lessons.id, lesson.id)).get(),
      live,
      'what a Student reads changes only through the deliberate Publish',
    );
  } finally {
    handle.cleanup();
  }
});

test('a Draft belonging to another Lesson is not restorable through this one', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const all = db.select().from(lessons).orderBy(asc(lessons.position)).all();
    const elsewhere = saved(db, all[1]!.id, '# Правка другого урока');

    assert.deepEqual(
      restoreDraft(db, { lessonId: all[0]!.id, draftId: elsewhere.id, studentId: admin(db).id }),
      { ok: false, reason: 'not_found' },
    );
    assert.deepEqual(
      restoreDraft(db, { lessonId: all[0]!.id, draftId: 9999, studentId: admin(db).id }),
      { ok: false, reason: 'not_found' },
    );
  } finally {
    handle.cleanup();
  }
});

// --- What removing an Exercise would destroy ---------------------------------

test('a Draft knows how many Submissions each of its Exercises already has', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const lesson = firstLesson(db);
    const studentId = db.select().from(students).where(eq(students.username, 'student')).get()!.id;
    const set = db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lesson.id)).get()!;
    const own = db.select().from(exercises)
      .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all();

    assert.deepEqual(submissionCounts(db, lesson.id), {}, 'nothing has been answered yet');

    for (const attempt of [1, 2]) {
      db.insert(submissions).values({
        studentId, exerciseId: own[0]!.id, attempt, answer: 'a',
        status: 'graded', proposedVerdict: 'incorrect', guardedVerdict: 'incorrect',
        feedbackRu: 'Неверно', corrected: null, failureReason: null, createdAt: new Date(),
      }).run();
    }

    // What the form warns with before it throws a Student's work away.
    assert.deepEqual(submissionCounts(db, lesson.id), { [own[0]!.id]: 2 });
  } finally {
    handle.cleanup();
  }
});
