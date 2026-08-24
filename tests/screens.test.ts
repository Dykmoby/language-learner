// Seam 2 — two rules about the screens, checked rather than remembered.
//
// Both are the kind of thing that is true on the day it is written and quietly
// stops being true six weeks later, in a diff that looks like a small fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return filesUnder(full, pattern);
    return pattern.test(entry) ? [full] : [];
  });
}

const SCREENS = filesUnder(join(REPO, 'src/app'), /\.tsx$/);

test('no screen writes a colour or a size of its own', () => {
  // The token layer is only the single source of truth for as long as nothing
  // reaches around it, and the easiest way to reach around a stylesheet is an
  // inline style on the element that wants something slightly different.
  const literal = [
    { pattern: /#[0-9a-fA-F]{3,8}\b/, what: 'a colour literal' },
    { pattern: /\brgba?\(|\bhsla?\(/, what: 'a colour function' },
    { pattern: /fontSize\s*:/, what: 'a font size' },
    { pattern: /\bcolor\s*:\s*['"]/, what: 'an inline colour' },
    { pattern: /backgroundColor\s*:/, what: 'an inline background' },
  ];

  const offenders: string[] = [];
  for (const file of SCREENS) {
    const source = readFileSync(file, 'utf8');
    for (const { pattern, what } of literal) {
      if (pattern.test(source)) offenders.push(`${file.slice(REPO.length)} — ${what}`);
    }
  }

  assert.deepEqual(offenders, [], 'name a token in the stylesheet instead');
});

test('no gamification', () => {
  // design.md § Interface, and not a matter of taste: streak mechanics are built
  // to retain strangers, and the two people who use this application every day
  // are not strangers being retained. A Student here came to learn a language.
  //
  // The vocabulary is what gives it away first — a badge arrives named before it
  // arrives drawn — so that is what is looked for.
  const VOCABULARY = [
    /\bstreak/i, /\bbadge/i, /\btrophy/i, /\bconfetti/i, /\bachievement/i,
    /серия подряд/i, /значок/i, /бейдж/i, /очк(и|ов|а)\b/i, /достижени/i, /награда/i,
  ];

  const surfaces = [
    'src/ru.ts',
    'src/app/globals.css',
    'src/app/tokens.css',
    ...SCREENS.map((file) => file.slice(REPO.length)),
  ];

  // Comments are stripped, the way the dictionary test strips them. Prose about
  // the design is allowed to name the thing the design refuses — the mark on a
  // generated Draft is discussed as a badge in the editor, and a rule that
  // could not tell that from a badge would be a rule nobody could write around.
  const withoutComments = (source: string) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\/.*$/gm, '');

  const offenders: string[] = [];
  for (const path of surfaces) {
    const source = withoutComments(readFileSync(join(REPO, path), 'utf8'));
    for (const pattern of VOCABULARY) {
      const found = pattern.exec(source);
      if (found) offenders.push(`${path} — ${found[0]}`);
    }
  }

  assert.deepEqual(offenders, [], 'a Student here is not a stranger being retained');
});
