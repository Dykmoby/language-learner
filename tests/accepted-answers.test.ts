// Accepted answers as a list per position, and the migration that got every
// stored row there — #82.
//
// The retype went in as expand, migrate, contract. What is left afterwards is a
// single shape everywhere, so the interesting question is no longer what the
// code tolerates but what the migration did: a row left holding a flat list
// would be read as a list of characters, and every answer would be wrong.
//
// The other half is where an Accepted Variant lands among those positions — #85.
// A variant confirmed for one Gap is accepted there and nowhere else; one with
// no position joins every Gap, which is what all of them did before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { acceptedAnswers, acceptedGaps, candidateAnswers } from '../src/content/accepted.ts';
import { courses, exercises, exerciseSets, lessonDrafts, lessons, type ExerciseRow } from '../src/db/schema.ts';

test('the accepted answers of an Exercise are read position by position', () => {
  assert.deepEqual(
    acceptedGaps({ acceptedAnswers: [['is', "'s"], ['a', 'one']] }),
    [['is', "'s"], ['a', 'one']],
  );
});

test('nothing accepted is no positions, rather than one empty one', () => {
  // A Grader-judged Exercise accepts nothing here, and must not gain a position
  // that the validity rules would then have to explain away.
  assert.deepEqual(acceptedGaps({ acceptedAnswers: [] }), []);
});

// --- Where a variant is accepted — #85 ---------------------------------------

/** A three-gap fill-gap, as a row, without a database to put it in. */
const THREE_GAPS: ExerciseRow = {
  id: 1,
  exerciseSetId: 1,
  position: 1,
  kind: 'fill_gap',
  prompt: 'Заполните пропуски: ___ have ___ apple and ___ cat.',
  referenceAnswer: 'I have an apple and a cat.',
  acceptedAnswers: [['I'], ['an'], ['a']],
  caseSensitive: false,
  choices: [],
};

test('a variant confirmed for one Gap joins that Gap alone', () => {
  assert.deepEqual(
    acceptedAnswers(THREE_GAPS, [{ value: 'one', gap: 1 }]),
    [['I'], ['an', 'one'], ['a']],
  );
});

test('a variant with no position joins every Gap, as every variant once did', () => {
  // What a Kind with one place to answer holds, and what every variant written
  // before there was a column for the position holds. Narrowing those to a Gap
  // nobody chose would change what an existing Exercise accepts.
  assert.deepEqual(
    acceptedAnswers(THREE_GAPS, [{ value: 'one', gap: null }]),
    [['I', 'one'], ['an', 'one'], ['a', 'one']],
  );
});

test('a Grader-judged Exercise has no Gaps, and its variants are still readable', () => {
  const graded: ExerciseRow = {
    ...THREE_GAPS, kind: 'translation', prompt: 'Переведите.', acceptedAnswers: [],
  };
  assert.deepEqual(
    acceptedAnswers(graded, [{ value: 'I have got a cat.', gap: null }]),
    [['I have got a cat.']],
  );
});

test('what already counts as a right answer is asked of one Gap at a time', () => {
  // The question an Admin about to add an Accepted Variant is answering: is this
  // word already right *here*. Asked across the whole Exercise, «an» would read
  // as already accepted at the first Gap, and confirming it there would be
  // silently refused.
  const variants = [{ value: 'one', gap: 1 }];
  assert.deepEqual(candidateAnswers(THREE_GAPS, variants, 0), ['I have an apple and a cat.', 'I']);
  assert.deepEqual(candidateAnswers(THREE_GAPS, variants, 1), ['I have an apple and a cat.', 'an', 'one']);
  assert.deepEqual(
    candidateAnswers(THREE_GAPS, variants),
    ['I have an apple and a cat.', 'I', 'an', 'one', 'a'],
    'and of the Exercise as a whole where there is no position to name',
  );
});

// --- The migration -----------------------------------------------------------
//
// Read out of the checked-in file rather than retyped here. A second copy of the
// statements would be a test that passes against SQL nobody runs.

const MIGRATION = readFileSync(join(process.cwd(), 'drizzle/0014_accepted_answers_per_gap.sql'), 'utf8')
  .split('--> statement-breakpoint');

function boxWithFlatRows() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);

  const course = handle.db.insert(courses).values({
    language: 'en', level: 'A1', graderModel: 'claude-sonnet-5',
    title: 'English A1', createdAt: new Date(),
  }).returning().get();
  const lesson = handle.db.insert(lessons).values({
    courseId: course.id, position: 1, title: 'Урок', theoryMarkdown: '## Урок', grammarFocus: 'Articles',
  }).returning().get();
  const set = handle.db.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();

  // Written as the old build wrote them: one flat list of whole answers on the
  // Exercise, and the same inside the Draft's document.
  const deterministic = handle.db.insert(exercises).values({
    exerciseSetId: set.id, position: 1, kind: 'fill_gap',
    prompt: 'Вставьте пропущенное слово: He ___ a doctor.', referenceAnswer: 'is',
    acceptedAnswers: [], caseSensitive: false, choices: [],
  }).returning().get();
  const graded = handle.db.insert(exercises).values({
    exerciseSetId: set.id, position: 2, kind: 'translation',
    prompt: 'Переведите: У меня есть кошка.', referenceAnswer: 'I have a cat.',
    acceptedAnswers: [], caseSensitive: false, choices: [],
  }).returning().get();

  handle.sqlite.prepare('update exercises set accepted_answers = ? where id = ?')
    .run(JSON.stringify(['is', "'s", '’s']), deterministic.id);

  const draft = handle.db.insert(lessonDrafts).values({
    lessonId: lesson.id,
    document: { title: 'Урок', grammarFocus: 'Articles', theoryMarkdown: '## Урок', exercises: [] },
    origin: 'manual', createdAt: new Date(),
  }).returning().get();
  handle.sqlite.prepare('update lesson_drafts set document = ? where id = ?').run(JSON.stringify({
    title: 'Урок',
    grammarFocus: 'Articles',
    theoryMarkdown: '## Урок',
    exercises: [
      {
        kind: 'fill_gap', prompt: 'He ___ a doctor.', referenceAnswer: 'is',
        acceptedAnswers: ['is', "'s"], caseSensitive: false, choices: [],
      },
      {
        kind: 'translation', prompt: 'Переведите.', referenceAnswer: 'I have a cat.',
        acceptedAnswers: [], caseSensitive: false, choices: [],
      },
    ],
  }), draft.id);

  const migrate = () => { for (const statement of MIGRATION) handle.sqlite.exec(statement); };
  return {
    ...handle, migrate, deterministicId: deterministic.id, gradedId: graded.id, draftId: draft.id,
    cleanup: () => { handle.close(); cleanup(); },
  };
}

const exerciseAnswers = (box: ReturnType<typeof boxWithFlatRows>, id: number) =>
  JSON.parse(box.sqlite.prepare('select accepted_answers as a from exercises where id = ?').pluck().get(id) as string);

const draftAnswers = (box: ReturnType<typeof boxWithFlatRows>) =>
  (JSON.parse(box.sqlite.prepare('select document as d from lesson_drafts where id = ?').pluck().get(box.draftId) as string)
    .exercises as { acceptedAnswers: unknown }[]).map((exercise) => exercise.acceptedAnswers);

test('the migration wraps a stored flat list into the single position it always was', () => {
  const box = boxWithFlatRows();
  try {
    box.migrate();
    assert.deepEqual(exerciseAnswers(box, box.deterministicId), [['is', "'s", '’s']]);
  } finally { box.cleanup(); }
});

test('an Exercise that accepts nothing gains no position', () => {
  const box = boxWithFlatRows();
  try {
    box.migrate();
    assert.deepEqual(exerciseAnswers(box, box.gradedId), []);
  } finally { box.cleanup(); }
});

test('a Draft carries its Exercises, so the document is migrated with the rows', () => {
  // ADR 0004 — a Draft is a whole Lesson as one value. Left flat, restoring one
  // would write a flat list straight back into the Practice a Student reads.
  const box = boxWithFlatRows();
  try {
    box.migrate();
    assert.deepEqual(draftAnswers(box), [[['is', "'s"]], []]);
  } finally { box.cleanup(); }
});

test('migrating twice wraps nothing twice', () => {
  // Both statements test the shape before they write. A migration that ran again
  // on a restored backup must not turn every answer into a list of characters.
  const box = boxWithFlatRows();
  try {
    box.migrate();
    box.migrate();
    assert.deepEqual(exerciseAnswers(box, box.deterministicId), [['is', "'s", '’s']]);
    assert.deepEqual(draftAnswers(box), [[['is', "'s"]], []]);
  } finally { box.cleanup(); }
});
