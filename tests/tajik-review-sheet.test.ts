// The review sheet for the Tajik Error Types — #57.
//
// The sheet is a document for a person, not code, so what is asserted here is
// only what would make it *wrong*: a type it does not ask about, a label that no
// longer matches what a Student reads, or an example missing from one of them.
// A reviewer who is handed seven of the eight types will review seven, and the
// eighth will stay provisional with nobody aware of it.
//
// design.md § Progress and statistics derives entirely from this enum, which is
// why it has to be fixed and why the sheet has to cover all of it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { errorTypesFor } from '../src/grader/contract.ts';
import { ru } from '../src/ru.ts';

const SHEET = readFileSync(new URL('../docs/tajik-error-types-review.md', import.meta.url), 'utf8');

/** The types only Tajik has: the whole enum minus the core both Languages share. */
function tajikOnlyTypes(): string[] {
  const core = new Set(errorTypesFor('en'));
  return errorTypesFor('tj').filter((type) => !core.has(type));
}

/** Each type the sheet asks about, with the Russian label it prints beside it. */
function reviewedInSheet(): Map<string, string> {
  return new Map(
    [...SHEET.matchAll(/^### \d+\. `([a-z_]+)` — «(.+)»$/gm)].map((m) => [m[1]!, m[2]!]),
  );
}

test('the sheet asks about every Tajik-specific Error Type, and about no other', () => {
  assert.deepEqual([...reviewedInSheet().keys()], tajikOnlyTypes());
});

test('each type is shown under the label a Student actually reads', () => {
  // The reviewer is being asked whether the wording is right, so it has to be
  // the wording. A sheet quoting a label the dictionary no longer holds would
  // collect a verdict on something nobody sees.
  for (const [type, label] of reviewedInSheet()) {
    assert.equal(label, ru.errorTypes[type], `${type} is reviewed under the wrong label`);
  }
});

test('every type carries a worked example and the three questions', () => {
  const sections = SHEET.split(/^### /m).slice(1);
  assert.equal(sections.length, tajikOnlyTypes().length);

  for (const section of sections) {
    const type = /^\d+\. `([a-z_]+)`/.exec(section)?.[1];
    assert.ok(type, 'a section with no type in its heading');
    assert.match(section, /Что должно попадать сюда/, `${type}: what it is meant to catch`);
    assert.match(section, /> Ответ студента: /, `${type}: a plausible Submission that should earn it`);
    assert.match(section, /> Ошибочный фрагмент: /, `${type}: with the fault pointed at`);
    assert.match(section, /- Такая ошибка существует и отдельна:/, `${type}: does the category exist`);
    assert.match(section, /- Подпись верна \/ заменить на:/, `${type}: is the Russian label right`);
    assert.match(section, /- Пример верен \/ заменить на:/, `${type}: is the example right`);
  }
});

test('the shared core types are listed for contrast, marked as applying to both Languages', () => {
  const core = errorTypesFor('en').filter((type) => errorTypesFor('tj').includes(type));
  const listed = new Set([...SHEET.matchAll(/^\| `([a-z_]+)` \| /gm)].map((m) => m[1]!));

  for (const type of core) {
    // `typography` never reaches a Student and the sheet says so in prose rather
    // than in the table — there is nothing to review about a type nobody sees.
    if (type === 'typography') continue;
    assert.ok(listed.has(type), `${type} applies to both Languages and is missing from the contrast table`);
  }
  assert.match(SHEET, /и для английского, и для таджикского/);
});

test('there is somewhere to record a category the list is missing', () => {
  // The one question with no answer already on the page. Without a place for it,
  // the sheet collects eight verdicts on what exists and nothing on what does not
  // — and a missing category is the failure that compounds with every Submission.
  assert.match(SHEET, /## Чего не хватает\?/);
});
