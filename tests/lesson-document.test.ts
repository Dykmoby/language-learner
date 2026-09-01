// Seam 2 — the Draft's document, as a pure value.
//
// A Draft holds the whole Lesson rather than a column per field (ADR 0004), so
// the document is what has to be trusted: it arrives over the wire, it is stored
// as JSON, and publishing writes it into the tables a Student reads. Everything
// asserted here is asserted before any of that happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  documentFaults, parseLessonTheory, DOCUMENT_FAULTS,
  type LessonDocument,
} from '../src/content/lesson-document.ts';
import { ru, faultMessage } from '../src/ru.ts';

const A_DOCUMENT: LessonDocument = {
  title: 'Артикли',
  grammarFocus: 'Неопределённый артикль a/an',
  theoryMarkdown: '# Артикли\n\nВ английском языке есть артикли.',
  exercises: [
    { id: 1, kind: 'fill_gap', prompt: 'Вставьте артикль.', referenceAnswer: 'an', acceptedAnswers: [['an']] },
  ],
};

test('a complete document has no faults', () => {
  assert.deepEqual(documentFaults(A_DOCUMENT), []);
});

test('the fields a Lesson cannot be published without', () => {
  const cases: Array<[Partial<LessonDocument>, string]> = [
    [{ title: '   ' }, 'title_empty'],
    [{ grammarFocus: '' }, 'grammar_focus_empty'],
    [{ theoryMarkdown: '\n\n' }, 'theory_empty'],
  ];
  for (const [patch, code] of cases) {
    assert.deepEqual(
      documentFaults({ ...A_DOCUMENT, ...patch }).map((f) => f.code),
      [code],
      code,
    );
  }
});

test('the grammar focus is required because the Grader is handed it on every call', () => {
  // design.md § Grading. A blank grammar focus is not a cosmetic omission: it
  // silently removes context from every Submission graded in this Lesson.
  assert.deepEqual(
    documentFaults({ ...A_DOCUMENT, grammarFocus: '' }).map((f) => f.code),
    ['grammar_focus_empty'],
  );
});

test('an incoherent Exercise is reported against its position in the Practice', () => {
  const faults = documentFaults({
    ...A_DOCUMENT,
    exercises: [
      A_DOCUMENT.exercises[0]!,
      { kind: 'multiple_choice', prompt: 'Выберите.', referenceAnswer: 'x', acceptedAnswers: [['x']], choices: ['a', 'b'] },
    ],
  });

  assert.deepEqual(faults, [
    { code: 'accepted_answer_not_a_choice', exercisePosition: 2, offending: 'x' },
    { code: 'reference_answer_not_a_choice', exercisePosition: 2, offending: 'x' },
  ]);
});

test('a document with no Exercises at all is publishable', () => {
  // A Lesson whose Practice is still empty is an ordinary state while authoring,
  // and the Practice screen already says so in Russian rather than breaking.
  assert.deepEqual(documentFaults({ ...A_DOCUMENT, exercises: [] }), []);
});

test('what arrives over the wire is parsed rather than trusted', () => {
  const rejected: unknown[] = [
    null,
    'a string',
    42,
    {},
    { title: 'x', grammarFocus: 'y' },
    { title: 'x', grammarFocus: 'y', theoryMarkdown: 5 },
    { title: ['x'], grammarFocus: 'y', theoryMarkdown: 'z' },
  ];
  for (const value of rejected) {
    assert.equal(parseLessonTheory(value), null, JSON.stringify(value) ?? 'undefined');
  }

  assert.deepEqual(
    parseLessonTheory({ title: 'Артикли', grammarFocus: 'a/an', theoryMarkdown: '# x', extra: 'ignored' }),
    { title: 'Артикли', grammarFocus: 'a/an', theoryMarkdown: '# x' },
    'only the three fields it is about, and nothing else that came along',
  );
});

test('parsing does not judge, it only shapes', () => {
  // An empty title is a fault the Admin is told about, not a parse failure that
  // loses everything else they typed.
  assert.deepEqual(
    parseLessonTheory({ title: '', grammarFocus: '', theoryMarkdown: '' }),
    { title: '', grammarFocus: '', theoryMarkdown: '' },
  );
});

test('every document fault code has a Russian message, and so does every Exercise one', () => {
  assert.deepEqual(Object.keys(ru.documentFaults).sort(), [...DOCUMENT_FAULTS].sort());
  for (const code of DOCUMENT_FAULTS) {
    assert.notEqual(faultMessage(code), code, `${code} resolves to Russian`);
  }
  assert.equal(faultMessage('prompt_empty'), ru.exerciseFaults.prompt_empty, 'Exercise codes resolve too');
  assert.equal(faultMessage('not_a_code'), 'not_a_code', 'an unknown code is shown as it came');
});

test('two entries claiming the same Exercise row are refused', () => {
  // Both would be written to that row and the second would win: two Exercises in
  // the document, one in the Practice, and nothing said about it. Unreachable
  // today — the document is composed on the server — but the Exercise forms are
  // what will reach it.
  const shared = { kind: 'fill_gap' as const, prompt: 'Вставьте.', referenceAnswer: 'is', acceptedAnswers: [['is']] };
  assert.deepEqual(
    documentFaults({
      ...A_DOCUMENT,
      exercises: [{ ...shared, id: 7 }, { ...shared, id: 7 }],
    }),
    [{ code: 'duplicate_exercise_id', exercisePosition: 2 }],
  );

  // Two Exercises that have no id yet are two new Exercises, not a duplicate.
  assert.deepEqual(
    documentFaults({ ...A_DOCUMENT, exercises: [shared, shared] }),
    [],
  );
});

test('the document rules stay pure', () => {
  const source = readFileSync(new URL('../src/content/lesson-document.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
  assert.deepEqual(imports, ['./exercise-validity.ts'], 'the rules are the only dependency');
  assert.ok(!/\bnode:(fs|net|http|child_process|sqlite)\b/.test(source), 'no I/O module reference');
  assert.ok(!/drizzle/.test(source), 'no database reference');
});
