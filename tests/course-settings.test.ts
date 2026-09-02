// Issue #75 — a Course's settings, changed after it was created.
//
// The rules half. What an Admin may change is deliberately narrower than what a
// Course is made of: the title and the Grader model move, the Language and the
// CEFR level do not. Those two are baked into every Lesson already written and
// into every Generation that produced one, and changing the Language would leave
// a Course whose content is in one language and whose Grader judges another —
// which surfaces as a stream of meaningless Verdicts rather than as an error.
//
// So "not editable" is asserted as *not expressible*: there is no field for
// either on the way in, and the stored values are unchanged by an update that
// changes everything it can.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { openDatabase, type DatabaseHandle } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { courses } from '../src/db/schema.ts';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { createCourse, updateCourse, courseSettingsFaults } from '../src/admin/authoring.ts';
import { ru } from '../src/ru.ts';

let handle: DatabaseHandle;
let cleanup: () => void;

before(() => {
  const temp = tempDatabasePath();
  cleanup = temp.cleanup;
  handle = openDatabase(temp.path);
  runMigrations(handle);
});

after(() => {
  handle?.close();
  cleanup?.();
});

function aCourse(title = 'Английский A1'): number {
  const created = createCourse(handle.db, { language: 'en', level: 'A1', title });
  assert.ok(created.ok);
  return created.course.id;
}

function stored(courseId: number) {
  return handle.db.select().from(courses).where(eq(courses.id, courseId)).get()!;
}

test('an Admin changes a mistyped title, and it is stored trimmed', () => {
  const courseId = aCourse('Англйский A1');

  const saved = updateCourse(handle.db, courseId, { title: '  Английский A1  ' });
  assert.ok(saved.ok);
  assert.equal(saved.course.title, 'Английский A1');
  assert.equal(stored(courseId).title, 'Английский A1');
});

test('an Admin changes the Grader model, and that is what the Course is judged by', () => {
  const courseId = aCourse();
  assert.equal(stored(courseId).graderModel, 'claude-sonnet-5', 'ADR 0002 defaulted it from the Language');

  const saved = updateCourse(handle.db, courseId, { title: 'Английский A1', graderModel: 'claude-opus-5' });
  assert.ok(saved.ok);
  // The row is what every later Submission reads its model from, so the row is
  // what is asserted — there is no second copy anywhere for it to disagree with.
  assert.equal(stored(courseId).graderModel, 'claude-opus-5');
});

test('the Language and the CEFR level survive an update that changes everything it can', () => {
  const courseId = aCourse();
  const before = stored(courseId);

  assert.ok(updateCourse(handle.db, courseId, { title: 'Другое название', graderModel: 'claude-opus-5' }).ok);

  const after = stored(courseId);
  assert.equal(after.language, before.language, 'the Language is not something an update can reach');
  assert.equal(after.level, before.level, 'and neither is the level');
});

test('a Haiku model is refused by name, the way the New Course form refuses it', () => {
  const courseId = aCourse();

  const refused = updateCourse(handle.db, courseId, {
    title: 'Английский A1', graderModel: 'claude-haiku-4-5-20251001',
  });
  assert.ok(!refused.ok);
  assert.deepEqual(refused.faults, ['grader_model_forbidden']);
  assert.equal(stored(courseId).graderModel, 'claude-sonnet-5', 'and nothing was written');
});

test('every reason is reported at once — an Admin fixes a form, not a field per attempt', () => {
  const courseId = aCourse();

  const refused = updateCourse(handle.db, courseId, { title: '   ', graderModel: 'gpt-9' });
  assert.ok(!refused.ok);
  assert.deepEqual(
    [...refused.faults].sort(),
    ['course_title_empty', 'grader_model_unknown'],
    'both faults, in one answer',
  );
});

test('every fault the settings can report has Russian to say it with', () => {
  const codes = new Set([
    ...courseSettingsFaults({ title: '', graderModel: 'gpt-9' }, { language: 'en' }),
    'course_not_found' as const,
  ]);
  for (const code of codes) {
    assert.ok(code in ru.authoringFaults, `${code} has an entry in the dictionary`);
  }
});

test('a Course that is not there is refused rather than created', () => {
  const refused = updateCourse(handle.db, 9_999, { title: 'Ничей курс' });
  assert.ok(!refused.ok);
  assert.deepEqual(refused.faults, ['course_not_found']);
});

test('leaving the model out keeps the Language default rather than blanking it', () => {
  const courseId = aCourse();
  assert.ok(updateCourse(handle.db, courseId, { title: 'Английский A1' }).ok);
  assert.equal(
    stored(courseId).graderModel, 'claude-sonnet-5',
    'a blank model resolves to the Language default — never to the empty string a Grader refuses',
  );
});
