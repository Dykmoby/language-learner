// Seam 2 — when a Student was working, Lesson by Lesson, against a throwaway
// database.
//
// This is what the span pickers on the progress screen filter by, so the claims
// worth holding are the ones a filter breaks on: a Lesson that was worked over
// several days reports the whole stretch and not just the first moment, a Lesson
// nobody has touched is absent rather than present with a 1970 in it, a Test's
// answers belong to no Lesson and do not turn up as one, and another Student's
// work is another Student's.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { DETERMINISTIC_COURSE, OTHER_COURSE } from './helpers/fixtures.ts';
import { exercises, exerciseSets, students, submissions } from '../src/db/schema.ts';
import { lessonActivity } from '../src/progress/activity.ts';
import { createTest, saveTest, publishTest } from '../src/admin/tests.ts';
import { submitAttempt } from '../src/tests/taking.ts';

let handle: DatabaseHandle;
let cleanup: (() => void) | undefined;
let studentId: number;
let otherStudentId: number;
let courseId: number;
let otherCourseId: number;
/** The Lessons of the Course, in order, each with its Exercise ids. */
let lessons: Array<{ lessonId: number; exerciseIds: number[] }> = [];

const DAY = 86_400_000;
/** A fixed instant, so nothing here depends on when the suite is run. */
const MONDAY = Date.UTC(2026, 2, 2, 9, 0, 0);

before(() => {
  const temp = tempDatabasePath();
  cleanup = temp.cleanup;
  handle = openDatabase(temp.path);
  runMigrations(handle);
  seedStudents(handle.db, [
    { username: 'student', password: 'staple monkey trombone', isAdmin: false },
    { username: 'nobody', password: 'staple monkey trombone', isAdmin: false },
  ]);
  courseId = seedCourseContent(handle.db, DETERMINISTIC_COURSE).courseId;
  otherCourseId = seedCourseContent(handle.db, OTHER_COURSE).courseId;

  const accounts = handle.db.select().from(students).all();
  studentId = accounts[0]!.id;
  otherStudentId = accounts[1]!.id;

  lessons = handle.db.select().from(exerciseSets).all()
    .filter((set) => set.lessonId !== null)
    .sort((a, b) => a.lessonId! - b.lessonId!)
    .map((set) => ({
      lessonId: set.lessonId!,
      exerciseIds: handle.db.select().from(exercises)
        .where(eq(exercises.exerciseSetId, set.id)).all()
        .sort((a, b) => a.position - b.position)
        .map((row) => row.id),
    }));
});

after(() => {
  handle?.close();
  cleanup?.();
});

let attempts = 0;

/** One answered Exercise, at a stated moment. */
function answeredAt(exerciseId: number, at: number, whose = studentId): void {
  attempts += 1;
  handle.db.insert(submissions).values({
    studentId: whose,
    exerciseId,
    attempt: attempts,
    answer: 'The cat sits.',
    testAttemptId: null,
    status: 'graded',
    failureReason: null,
    proposedVerdict: 'correct',
    guardedVerdict: 'correct',
    feedbackRu: 'Верно.',
    corrected: null,
    createdAt: new Date(at),
  }).run();
}

function activity(whose = studentId, course = courseId) {
  return lessonActivity(handle.db, whose, course);
}

test('a Course nobody has answered in reports nothing rather than a row of nulls', () => {
  assert.deepEqual(activity(), []);
});

test('a Lesson reports the first and last moment it was answered in', () => {
  const first = lessons[0]!;
  // Out of order on purpose: the aggregate is what puts them the right way
  // round, not the order the rows happen to arrive in.
  answeredAt(first.exerciseIds[1]!, MONDAY + 2 * DAY);
  answeredAt(first.exerciseIds[0]!, MONDAY);
  answeredAt(first.exerciseIds[2]!, MONDAY + DAY);

  const rows = activity();
  assert.equal(rows.length, 1, 'one Lesson has been worked');
  assert.equal(rows[0]!.lessonId, first.lessonId);
  assert.equal(rows[0]!.firstAt, MONDAY, 'the earliest answer');
  assert.equal(rows[0]!.lastAt, MONDAY + 2 * DAY, 'and the latest');
});

test('a Lesson with no answers in it stays out of the list entirely', () => {
  const untouched = lessons[1]!;
  assert.ok(untouched, 'the fixture has a second Lesson');
  assert.ok(
    !activity().some((row) => row.lessonId === untouched.lessonId),
    'absent rather than present with dates nobody made',
  );
});

test('one answer makes a Lesson a single moment rather than a span', () => {
  const second = lessons[1]!;
  answeredAt(second.exerciseIds[0]!, MONDAY + 5 * DAY);

  const row = activity().find((entry) => entry.lessonId === second.lessonId);
  assert.ok(row);
  assert.equal(row.firstAt, row.lastAt, 'a span of one day is one moment twice');
  assert.equal(row.firstAt, MONDAY + 5 * DAY);
});

test('another Student’s answers are another Student’s', () => {
  const first = lessons[0]!;
  answeredAt(first.exerciseIds[0]!, MONDAY + 40 * DAY, otherStudentId);

  const mine = activity().find((row) => row.lessonId === first.lessonId)!;
  assert.equal(mine.lastAt, MONDAY + 2 * DAY, 'their answer did not extend my span');

  const theirs = activity(otherStudentId);
  assert.equal(theirs.length, 1);
  assert.equal(theirs[0]!.firstAt, MONDAY + 40 * DAY);
});

test('Errors made in a Test belong to no Lesson and never appear as one', () => {
  // A Test's answers are Submissions in the same table (ADR 0005), so keeping
  // them out is a property of the join rather than of a filter somebody
  // remembered to write. That is exactly the kind of thing that stops being true
  // quietly, so it is asserted.
  const created = createTest(handle.db, { courseId, title: 'Контрольная по датам' });
  assert.ok(created.ok);
  const saved = saveTest(handle.db, created.test.id, {
    title: 'Контрольная по датам',
    passThreshold: 80,
    exercises: [{
      kind: 'translation',
      prompt: 'Переведите: У меня есть кот.',
      referenceAnswer: 'I have a cat.',
      acceptedAnswers: [],
      caseSensitive: false,
      choices: [],
    }],
  });
  assert.ok(saved.ok);
  assert.ok(publishTest(handle.db, created.test.id).ok);

  const before = activity();
  const attempt = submitAttempt(handle.db, studentId, created.test.id, [
    { exerciseId: saved.document.exercises[0]!.id!, answers: ['I have cat.'] },
  ]);
  assert.ok(attempt.ok, 'the Test really was answered');

  assert.deepEqual(activity(), before, 'and it added no Lesson to the list');
});

test('a Course is only its own Lessons', () => {
  assert.deepEqual(activity(studentId, otherCourseId), [],
    'nothing the Student did elsewhere leaks into this Course');
});
