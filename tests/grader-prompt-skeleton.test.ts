// Issue #77 — both Grader system prompts come off one skeleton.
//
// The prefactor's whole claim is that it changed nothing, and "nothing" is a
// claim about bytes: the two prompts were written out twice and are now built
// once, so the way to know the refactor was faithful is to compare the output
// with what shipped before it. Hence a golden file per prompt per Language,
// captured from the implementation this replaced.
//
// These files are meant to change. #78 adds an Error Type, #79 adds an editable
// guidance block — each of those is a deliberate edit to what the Grader is told,
// and the diff to the golden file is the reviewable half of it. What they stop is
// the *undeliberate* edit: a wording change made for one prompt that silently
// lands in the other, or in neither.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSystemPrompt, buildGraderSystemPrompt, LANGUAGES } from '../src/grader/contract.ts';
import { buildBatchSystemPrompt } from '../src/grader/batch-contract.ts';

function golden(name: string): string {
  return readFileSync(new URL(`./golden/${name}.txt`, import.meta.url), 'utf8');
}

for (const language of LANGUAGES) {
  test(`the ${language} Grader system prompt is byte-identical to the one that shipped`, () => {
    assert.equal(buildSystemPrompt(language), golden(`grader-system-${language}`));
  });

  test(`the ${language} batch Grader system prompt is byte-identical to the one that shipped`, () => {
    assert.equal(buildBatchSystemPrompt(language), golden(`batch-grader-system-${language}`));
  });
}

test('the five parts the two prompts share are the same words in both', () => {
  // Named one by one rather than asserted as "the diff is small": the point of
  // the skeleton is that these five are not editable apart, and a test that only
  // counted differing lines would pass while one of them drifted.
  const single = buildSystemPrompt('en');
  const batch = buildBatchSystemPrompt('en');

  const shared = [
    'The student is a Russian speaker. Every explanation you write MUST be in Russian.',
    'Return ONE JSON object and nothing else. No prose before or after. No markdown fences.',
    '  "feedback_ru"  — short Russian explanation addressed to the student',
    '  "verdict"      — one of "correct", "partially_correct", "incorrect"',
    '"type" MUST be one of exactly these values:',
    'Judge only the English. Do not invent errors that are not there.',
  ];

  for (const line of shared) {
    assert.ok(single.includes(line), `the Grader prompt is missing: ${line}`);
    assert.ok(batch.includes(line), `the batch Grader prompt is missing: ${line}`);
  }
});

test('a shape with nothing optional in it produces the skeleton and nothing else', () => {
  // The absent blocks take their blank lines with them, so no caller has to
  // remember a trailing '' — the bug this would otherwise reintroduce is a prompt
  // with a double blank line where an optional part used to be.
  const bare = buildGraderSystemPrompt('en', {
    subject: 'X',
    independence: [],
    envelope: [],
    fieldOrderHeader: 'H:',
    leadingFields: [],
    spanOwner: 'the',
    fencing: ['F'],
  });

  assert.ok(!bare.includes('\n\n\n'), 'an absent block leaves no blank line behind');
  assert.ok(bare.startsWith('You grade X. Target language: English.\n'));
  assert.ok(bare.endsWith('\nF'));
});
