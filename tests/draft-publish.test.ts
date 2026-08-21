// Seam 2/3 — the Draft against a real database, with no HTTP in the way.
//
// The rule under test throughout is that saving and publishing are different
// acts: a saved Draft changes nothing a Student can read, and only publishing
// does. The other half is identity — an Exercise that survives a publish must be
// the same row afterwards, because a Submission points at it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';
import { lessons, exercises, exerciseSets, students, submissions, lessonDrafts } from '../src/db/schema.ts';
import {
  openDraft, saveDraft, publishDraft, publishedDocument, latestDraft,
  lessonsWithUnpublishedChanges,
} from '../src/admin/drafts.ts';

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

/**
 * saveDraft refuses an incoherent Exercise rather than storing one. Every
 * document here is coherent, so a refusal is a broken test rather than a case to
 * assert — the refusal path has its own test below.
 */
function saved(db: Db, input: Parameters<typeof saveDraft>[1]) {
  const result = saveDraft(db, input);
  if (!result.ok) throw new Error(`the Draft was refused: ${result.faults.map((f) => f.code).join(', ')}`);
  return result.draft;
}

function exercisesOf(db: Db, lessonId: number) {
  const set = db.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lessonId)).get()!;
  return db.select().from(exercises)
    .where(eq(exercises.exerciseSetId, set.id)).orderBy(asc(exercises.position)).all();
}

test('opening a Lesson that has never been edited writes nothing and shows the published content', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const open = openDraft(handle.db, lesson.id)!;

    assert.equal(open.document.title, lesson.title);
    assert.equal(open.document.theoryMarkdown, lesson.theoryMarkdown);
    assert.equal(open.draftId, null, 'no Draft exists yet');
    assert.equal(open.hasUnpublishedChanges, false);

    // Looking at a Lesson is not editing it. A Draft row created on a page view
    // would put a version in the history that nobody wrote.
    assert.deepEqual(handle.db.select().from(lessonDrafts).all(), [], 'nothing was written');
  } finally {
    handle.cleanup();
  }
});

test('saving a Draft leaves the Lesson the Student reads completely unchanged', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const before = publishedDocument(handle.db, lesson.id)!;

    saved(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      document: { ...before, title: 'Совершенно другое название', theoryMarkdown: '# Другая теория' },
    });

    assert.deepEqual(publishedDocument(handle.db, lesson.id), before, 'the published Lesson is untouched');
    assert.equal(openDraft(handle.db, lesson.id)!.hasUnpublishedChanges, true);
  } finally {
    handle.cleanup();
  }
});

test('every save appends a Draft rather than overwriting the last', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;
    const base = publishedDocument(handle.db, lesson.id)!;

    const first = saved(handle.db, { lessonId: lesson.id, studentId, document: { ...base, title: 'Первое' } });
    const second = saved(handle.db, { lessonId: lesson.id, studentId, document: { ...base, title: 'Второе' } });

    const all = handle.db.select().from(lessonDrafts).where(eq(lessonDrafts.lessonId, lesson.id)).all();
    assert.equal(all.length, 2, 'both Drafts are kept');
    assert.notEqual(first.id, second.id);
    assert.equal(latestDraft(handle.db, lesson.id)!.id, second.id, 'the newest is the newest');
    assert.equal(all.find((d) => d.id === first.id)!.document.title, 'Первое', 'the earlier Draft still holds what it held');
  } finally {
    handle.cleanup();
  }
});

test('publishing makes the Draft the Lesson a Student reads', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const base = publishedDocument(handle.db, lesson.id)!;
    const draft = saved(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      document: { ...base, title: 'Новое название', theoryMarkdown: '# Новая теория\n\nТекст.' },
    });

    const result = publishDraft(handle.db, draft.id);
    assert.equal(result.ok, true);

    const after = handle.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;
    assert.equal(after.title, 'Новое название');
    assert.equal(after.theoryMarkdown, '# Новая теория\n\nТекст.');
    assert.equal(openDraft(handle.db, lesson.id)!.hasUnpublishedChanges, false, 'nothing is ahead any more');
  } finally {
    handle.cleanup();
  }
});

test('publishing preserves Exercise identity, so Submissions are never orphaned', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const before = exercisesOf(handle.db, lesson.id);
    const studentId = handle.db.select().from(students).where(eq(students.username, 'student')).get()!.id;

    // A Student's work against the Exercise that is about to survive a publish.
    handle.db.insert(submissions).values({
      studentId, exerciseId: before[0]!.id, attempt: 1, answer: 'an',
      status: 'graded', proposedVerdict: 'correct', guardedVerdict: 'correct',
      feedbackRu: 'Верно', corrected: null, failureReason: null, createdAt: new Date(),
    }).run();

    const draft = saved(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      document: { ...publishedDocument(handle.db, lesson.id)!, theoryMarkdown: '# Правка' },
    });
    assert.equal(publishDraft(handle.db, draft.id).ok, true);

    assert.deepEqual(
      exercisesOf(handle.db, lesson.id).map((e) => e.id),
      before.map((e) => e.id),
      'the same rows, not replacements wearing the same content',
    );
    assert.equal(
      handle.db.select().from(submissions).all().length,
      1,
      'the Submission is still there',
    );
  } finally {
    handle.cleanup();
  }
});

test('a reordered Practice publishes without colliding on position', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const before = exercisesOf(handle.db, lesson.id);
    const document = publishedDocument(handle.db, lesson.id)!;

    // Positions are unique within an Exercise Set, so a publish that wrote them
    // one at a time in place would collide on the first swap.
    const reversed = { ...document, exercises: [...document.exercises].reverse() };
    const draft = saved(handle.db, { lessonId: lesson.id, studentId: admin(handle.db).id, document: reversed });
    assert.equal(publishDraft(handle.db, draft.id).ok, true);

    const after = exercisesOf(handle.db, lesson.id);
    assert.deepEqual(after.map((e) => e.id), [...before].reverse().map((e) => e.id), 'the new order');
    assert.deepEqual(after.map((e) => e.position), after.map((_, i) => i + 1), 'positions renumbered 1..n');
  } finally {
    handle.cleanup();
  }
});

test('an Exercise added in a Draft gets an id, and keeps it across the next publish', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;
    const document = publishedDocument(handle.db, lesson.id)!;

    const added = saved(handle.db, {
      lessonId: lesson.id,
      studentId,
      document: {
        ...document,
        exercises: [...document.exercises, {
          kind: 'fill_gap', prompt: 'Новое упражнение.', referenceAnswer: 'is', acceptedAnswers: ['is'],
        }],
      },
    });
    const published = publishDraft(handle.db, added.id);
    assert.equal(published.ok, true);

    const newId = exercisesOf(handle.db, lesson.id).at(-1)!.id;
    assert.equal(
      published.ok && published.document.exercises.at(-1)!.id,
      newId,
      'the Draft is written back carrying the id the row actually got',
    );

    // Without that write-back, the next publish would not recognise the Exercise
    // and would delete and re-insert it — taking its Submissions with it.
    const again = saved(handle.db, {
      lessonId: lesson.id,
      studentId,
      document: { ...latestDraft(handle.db, lesson.id)!.document, theoryMarkdown: '# Ещё правка' },
    });
    assert.equal(publishDraft(handle.db, again.id).ok, true);
    assert.equal(exercisesOf(handle.db, lesson.id).at(-1)!.id, newId, 'still the same row');
  } finally {
    handle.cleanup();
  }
});

test('a Draft that breaks a rule is refused rather than published', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const before = handle.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;
    const document = publishedDocument(handle.db, lesson.id)!;

    const draft = saved(handle.db, {
      lessonId: lesson.id,
      studentId: admin(handle.db).id,
      // Blank grammar focus: every Submission in this Lesson would be graded
      // with that context silently missing.
      document: { ...document, grammarFocus: '   ', title: 'Название есть' },
    });

    const result = publishDraft(handle.db, draft.id);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'invalid');
    assert.deepEqual(
      result.ok === false && result.reason === 'invalid' ? result.faults.map((f) => f.code) : null,
      ['grammar_focus_empty'],
    );

    assert.deepEqual(
      handle.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get(),
      before,
      'the Lesson is untouched by a refused publish',
    );
    // The Draft survives: the work is saved, only the publish was refused.
    assert.equal(latestDraft(handle.db, lesson.id)!.id, draft.id);
    assert.equal(latestDraft(handle.db, lesson.id)!.publishedAt, null);
  } finally {
    handle.cleanup();
  }
});

test('a Course reports which of its Lessons are ahead of what is published', () => {
  const handle = freshDatabase();
  try {
    const all = handle.db.select().from(lessons).orderBy(asc(lessons.position)).all();
    const [first, second] = all;
    const studentId = admin(handle.db).id;

    assert.deepEqual(
      [...lessonsWithUnpublishedChanges(handle.db, all.map((l) => l.id))],
      [],
      'nothing is ahead before anything is edited',
    );

    saved(handle.db, {
      lessonId: first!.id, studentId,
      document: { ...publishedDocument(handle.db, first!.id)!, theoryMarkdown: '# Правка' },
    });
    const publishedDraft = saved(handle.db, {
      lessonId: second!.id, studentId,
      document: { ...publishedDocument(handle.db, second!.id)!, theoryMarkdown: '# Тоже правка' },
    });
    assert.equal(publishDraft(handle.db, publishedDraft.id).ok, true);

    assert.deepEqual(
      [...lessonsWithUnpublishedChanges(handle.db, all.map((l) => l.id))],
      [first!.id],
      'only the Lesson whose newest Draft was never published',
    );
  } finally {
    handle.cleanup();
  }
});

test('publishing a Draft that does not exist is refused', () => {
  const handle = freshDatabase();
  try {
    const result = publishDraft(handle.db, 9999);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'not_found');
  } finally {
    handle.cleanup();
  }
});

test('a Draft that is already live is refused rather than published again', () => {
  const handle = freshDatabase();
  try {
    const lesson = firstLesson(handle.db);
    const studentId = admin(handle.db).id;
    const base = publishedDocument(handle.db, lesson.id)!;

    const first = saved(handle.db, { lessonId: lesson.id, studentId, document: { ...base, theoryMarkdown: '# Первая правка' } });
    assert.equal(publishDraft(handle.db, first.id).ok, true);

    const second = saved(handle.db, { lessonId: lesson.id, studentId, document: { ...base, theoryMarkdown: '# Вторая правка' } });
    assert.equal(publishDraft(handle.db, second.id).ok, true);

    // The browser is a step behind and asks for the older Draft again. Writing
    // it would put the first edit back over the second and report success.
    const stale = publishDraft(handle.db, first.id);
    assert.equal(stale.ok, false);
    assert.equal(stale.ok === false && stale.reason, 'already_published');

    assert.equal(
      handle.db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!.theoryMarkdown,
      '# Вторая правка',
      'the newer edit still stands',
    );
  } finally {
    handle.cleanup();
  }
});
