// design.md § Interface: every string a Student or Admin reads comes from the
// central dictionary. No i18n library, which means the rule holds only while
// nothing writes Russian inline in a component — so the rule is checked rather
// than remembered.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = new URL('../src/', import.meta.url).pathname;
const DICTIONARY = join(SOURCE, 'ru.ts');
const CYRILLIC = /[А-Яа-яЁё]/;

// The rule is about text a person reads on a screen. These hold Cyrillic that is
// not that, and each is named rather than covered by a broad pattern — a new file
// full of inline Russian must fail this test, not quietly join a category.
const NOT_INTERFACE_TEXT: Record<string, string> = {
  'grader/health-check.ts':
    'the fixed known input of the health check — content handed to the Grader, never rendered',
  'practice/deterministic-check.ts':
    'the ё → е normalisation: those are characters in an algorithm, not a message',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

/**
 * Comments are where the reasoning lives and are full of Cyrillic examples, so
 * they are stripped before looking. What is left is code — and Cyrillic in code
 * is a string a Student can read.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');
}

test('no Russian string is written inline — every one comes from the dictionary', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SOURCE)) {
    const relative = file.slice(SOURCE.length);
    // The dictionary is where the Russian lives. The fixture is content, not
    // interface: a Lesson's Theory and its prompts are data an Admin authors.
    if (file === DICTIONARY || relative.startsWith('content/')) continue;
    if (relative in NOT_INTERFACE_TEXT) continue;

    withoutComments(readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      if (CYRILLIC.test(line)) offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders, [],
    'a second interface language must stay a translation job rather than a rewrite',
  );
});

test('the dictionary is the only place that needs translating', () => {
  // The claim above is only worth anything if the dictionary actually holds the
  // strings, rather than being an empty ceremony beside inline text.
  const dictionary = readFileSync(DICTIONARY, 'utf8');
  const lines = dictionary.split('\n').filter((line) => CYRILLIC.test(line));
  assert.ok(lines.length > 60, `the dictionary carries the interface (${lines.length} Russian lines)`);
});
