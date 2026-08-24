// Seam 2 — the typeface, read out of the files that ship it.
//
// Pure. It parses `fonts.css`, opens each woff2 it names, and reads the
// character map out of it. That is the difference between asserting that a file
// called `cyrillic-ext` exists and asserting that Tajik renders.
//
// The failure this is here to catch is quiet. Subsetting is what makes a
// self-hosted typeface small enough to preload, and it is also the operation
// that silently drops a script: `cyrillic` alone renders the whole Russian
// interface perfectly and turns every Tajik Course title into boxes. Nothing
// about that shows up in a build, in a typecheck or in an HTTP test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { codepointsIn } from './helpers/woff2.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(REPO + path, 'utf8');

const fontsCss = read('src/app/fonts.css');

// --- the alphabets this application actually sets ----------------------------

const RUSSIAN = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

/**
 * Tajik: Russian without ц, щ, ы and ь, plus six letters of its own. Those six
 * are the reason `cyrillic-ext` ships — they sit outside the basic Cyrillic
 * block that covers Russian.
 */
const TAJIK = 'абвгдеёжзийклмнопрстуфхчшъэюяғӣқӯҳҷАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЧШЪЭЮЯҒӢҚӮҲҶ';

const ENGLISH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Every character the central Russian dictionary sets — the em dashes, the
 * middle dots, the ellipses and the guillemets the interface is punctuated with,
 * gathered from the one file they are all written in rather than listed again
 * here and allowed to fall behind it.
 *
 * Comments are stripped, and that is a distinction with teeth: the enum's
 * warning about the unreviewed Tajik list is written with an emoji, which no
 * text face has and none should. An emoji is rendered by the platform's own
 * emoji font whatever this stylesheet says, so holding the typeface to it would
 * be holding it to something that is not its job.
 */
function dictionaryCharacters(): string {
  const source = read('src/ru.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...new Set(source.replace(/\s/g, ''))].join('');
}

// --- reading the @font-face blocks -------------------------------------------

type Face = { family: string; file: string; ranges: [number, number][] };

function parseRange(text: string): [number, number][] {
  return text.split(',').map((entry) => {
    const match = /U\+([0-9A-F]+)(?:-([0-9A-F]+))?/i.exec(entry.trim());
    assert.ok(match, `unparseable unicode-range entry: ${entry}`);
    const start = Number.parseInt(match[1]!, 16);
    return [start, match[2] === undefined ? start : Number.parseInt(match[2], 16)] as [number, number];
  });
}

function faces(): Face[] {
  return [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((block) => {
    const body = block[1]!;
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1];
    const file = /url\('([^']+)'\)/.exec(body)?.[1];
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
    assert.ok(family && file && range, `an @font-face is missing family, url or unicode-range: ${body}`);
    return { family, file, ranges: parseRange(range) };
  });
}

const FACES = faces();

/** The glyphs in a face, read once and reused across the checks below. */
const glyphs = new Map<string, Set<number>>();
function glyphsOf(face: Face): Set<number> {
  const cached = glyphs.get(face.file);
  if (cached) return cached;
  const found = codepointsIn(REPO + 'public' + face.file);
  glyphs.set(face.file, found);
  return found;
}

function covers(face: Face, codepoint: number): boolean {
  return face.ranges.some(([start, end]) => codepoint >= start && codepoint <= end);
}

/**
 * What a browser would do: among the faces of this family, the ones whose
 * `unicode-range` claims this character. A character claimed by no face falls
 * back to whatever the machine holds, which is the situation this whole ticket
 * exists to end.
 */
function facesFor(family: string, codepoint: number): Face[] {
  return FACES.filter((face) => face.family === family && covers(face, codepoint));
}

function missingFrom(family: string, characters: string): string[] {
  const missing: string[] = [];
  for (const character of characters) {
    const codepoint = character.codePointAt(0)!;
    const claiming = facesFor(family, codepoint);
    if (claiming.length === 0) { missing.push(`${character} (U+${codepoint.toString(16).toUpperCase()}) — claimed by no face`); continue; }
    // Any one of the claiming faces having the glyph is enough; the browser
    // falls through the matching faces in turn.
    if (!claiming.some((face) => glyphsOf(face).has(codepoint))) {
      missing.push(
        `${character} (U+${codepoint.toString(16).toUpperCase()}) — claimed by ${claiming.map((f) => f.file).join(', ')}, present in none`,
      );
    }
  }
  return missing;
}

// --- the checks --------------------------------------------------------------

test('the typeface is served from this application and fetched from nowhere', () => {
  // The one thing self-hosting is for. design.md § Platform: outbound HTTPS
  // leaves this box through a proxy systemd units do not get, so a font fetched
  // at build or at run time fails in the place this project has already been
  // bitten — and fails on a Sunday rather than in a build.
  for (const path of ['src/app/fonts.css', 'src/app/tokens.css', 'src/app/globals.css']) {
    const external = [...read(path).matchAll(/url\(\s*['"]?(https?:)?\/\//gi)].map((m) => m[0]);
    assert.deepEqual(external, [], `${path} fetches from a host`);
  }
  const imports = [...fontsCss.matchAll(/@import[^;]+;/g)].map((m) => m[0]);
  assert.deepEqual(imports, [], 'an @import is a fetch with extra steps');
});

test('every face named in the stylesheet is a file in this repository', () => {
  const missing = FACES.filter((face) => !existsSync(REPO + 'public' + face.file)).map((f) => f.file);
  assert.deepEqual(missing, [], 'a face is declared but not shipped');
});

test('the sans sets Russian, English and Tajik', () => {
  assert.deepEqual(missingFrom('IBM Plex Sans', RUSSIAN), [], 'the Russian interface');
  assert.deepEqual(missingFrom('IBM Plex Sans', ENGLISH), [], 'an English Course');
  assert.deepEqual(
    missingFrom('IBM Plex Sans', TAJIK),
    [],
    'a Tajik Course — check that the cyrillic-ext face is still shipped',
  );
});

test('the sans sets every character the Russian dictionary is written in', () => {
  assert.deepEqual(missingFrom('IBM Plex Sans', dictionaryCharacters()), []);
});

test('the mono covers Cyrillic, not only Latin', () => {
  // The error span holds a fragment of the Student's own answer, which in a
  // Tajik Course is Cyrillic. A mono without it would fail at precisely the
  // moment the Student is being told what they got wrong.
  assert.deepEqual(missingFrom('IBM Plex Mono', RUSSIAN), []);
  assert.deepEqual(missingFrom('IBM Plex Mono', TAJIK), []);
  assert.deepEqual(missingFrom('IBM Plex Mono', ENGLISH), []);
});

test('no face claims a range whose characters it does not have', () => {
  // A file renamed or swapped would still satisfy every check above through
  // some other face picking up the slack. This one asks each face directly.
  const empty = FACES.filter((face) => {
    const found = glyphsOf(face);
    return ![...found].some((codepoint) => covers(face, codepoint));
  }).map((f) => f.file);

  assert.deepEqual(empty, [], 'a face contains nothing from the range it claims');
});

test('the three sans faces are preloaded by the root layout', () => {
  // `font-display: block` is what stops the fallback being shown and replaced;
  // the preload is what stops the block being noticeable. Half of that pair is
  // not a strategy.
  const layout = read('src/app/layout.tsx');
  const sans = FACES.filter((face) => face.family === 'IBM Plex Sans');
  const unpreloaded = sans.filter((face) => !layout.includes(face.file)).map((f) => f.file);
  assert.deepEqual(unpreloaded, [], 'a sans face is declared but never preloaded');
  assert.ok(layout.includes('rel="preload"'), 'the layout renders no preload at all');
});

test('the type scale is the token layer\'s, and the stack names IBM Plex first', () => {
  const tokens = read('src/app/tokens.css');
  assert.match(tokens, /--font-sans:\s*'IBM Plex Sans'/);
  assert.match(tokens, /--font-mono:\s*'IBM Plex Mono'/);
  // The old stack was `system-ui` and its fallbacks — one typeface per operating
  // system, and whatever Cyrillic that machine happened to hold.
  assert.doesNotMatch(read('src/app/globals.css'), /font-family:\s*system-ui/);
});
