// Seam 2 — the token layer, read as data.
//
// Pure: no database, no booted application, no browser. It parses the two
// stylesheets, resolves every `var()` chain and `color-mix()` wash the way a
// browser would, and computes WCAG contrast for the pairings the design actually
// puts on screen — in light and in dark.
//
// The point is not to have measured the palette once. It is that the measurement
// is repeated on every run, so a hex value cannot be nudged, a state cannot be
// added, and a theme cannot be extended without the floor being re-checked.
// Before this existed the dark palette was a hand-flipped copy of the light one
// that nobody had measured against its own background.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOBALS_CSS,
  TOKENS_CSS,
  contrastRatio,
  hex,
  parseRules,
  readStylesheet,
  readTokens,
  resolveColour,
  themeBlocks,
  type Rgb,
  type Theme,
} from './helpers/css.ts';

// --- the floors --------------------------------------------------------------

/**
 * WCAG 2.1 AA for body text. Raising the whole design to AAA later is one edit
 * here rather than a hunt through a stylesheet.
 */
const TEXT_FLOOR = 4.5;

/**
 * WCAG 2.1 AA (1.4.11) for a user interface component or a graphical object: the
 * edge of a control a Student has to find before they can type in it, and a
 * chart line that carries the meaning of the picture.
 */
const NON_TEXT_FLOOR = 3;

const THEMES: Theme[] = ['light', 'dark'];

// --- what sits on what -------------------------------------------------------

type Pairing = { fg: string; bg: string; why: string };

/** The three surfaces anything can be painted on. Every wash composites over one. */
const SURFACES = ['--bg', '--surface', '--surface-sunken'] as const;

const STATES = ['correct', 'partial', 'incorrect', 'help', 'disputed', 'failed'] as const;

function textPairings(): Pairing[] {
  const pairings: Pairing[] = [];

  for (const surface of SURFACES) {
    pairings.push({ fg: '--fg', bg: surface, why: 'body text' });
    pairings.push({ fg: '--fg-muted', bg: surface, why: 'secondary text — a position, a count, a date' });
    pairings.push({ fg: '--accent', bg: surface, why: 'a link' });
  }

  pairings.push({ fg: '--accent-on', bg: '--accent', why: 'the label on a primary button' });
  pairings.push({ fg: '--accent', bg: '--accent-quiet', why: 'a link inside a highlighted panel' });
  pairings.push({ fg: '--fg', bg: '--accent-quiet', why: 'text inside a highlighted panel' });

  // Each state's own hue as text, and body text inside the block that state
  // tints. A state whose wording is legible but whose Verdict line is not has
  // failed at the one thing it exists for.
  for (const state of STATES) {
    for (const surface of SURFACES) {
      pairings.push({
        fg: `--state-${state}-ink`,
        bg: surface,
        why: `the ${state} Verdict, as words`,
      });
      pairings.push({
        fg: `--state-${state}-ink`,
        bg: `--state-${state}-wash over ${surface}`,
        why: `the ${state} Verdict inside its own tinted block`,
      });
      pairings.push({
        fg: '--fg',
        bg: `--state-${state}-wash over ${surface}`,
        why: `an Exercise read inside a ${state} block`,
      });
    }
  }

  return pairings;
}

function nonTextPairings(): Pairing[] {
  const pairings: Pairing[] = [];
  for (const surface of SURFACES) {
    pairings.push({ fg: '--line-strong', bg: surface, why: 'the edge of a form control' });
    for (let n = 1; n <= 6; n += 1) {
      pairings.push({ fg: `--series-${n}`, bg: surface, why: `chart series ${n}` });
    }
  }
  return pairings;
}

/**
 * Colour tokens with no floor, each for a stated reason. Being on this list is
 * the decision; the test below refuses a token that is on no list at all, so a
 * new colour cannot arrive without somebody choosing which of the three it is.
 */
const EXEMPT: Record<string, string> = {
  // WCAG 1.4.11 covers what is needed to understand the content, and this token
  // is used for two things that are not: a hairline between two rows, which can
  // be removed entirely without losing anything but tidiness, and the unfilled
  // part of a progress bar. The second is the one worth stating — what carries
  // the bar's meaning is the segments that *are* filled, and the counts beside
  // it say the same thing in words. Raising the track to 3:1 would make an empty
  // bar shout louder than a full one. Anything a Student has to find in order to
  // act on it is drawn in --line-strong instead.
  '--line': 'a hairline that separates, and the unfilled part of a bar — never a mark and never the edge of a control',
  // Surfaces, measured above as backgrounds rather than as foregrounds.
  '--bg': 'a surface — checked as the background of every pairing above',
  '--surface': 'a surface',
  '--surface-sunken': 'a surface',
  '--accent-quiet': 'a surface',
  '--accent-on': 'checked against --accent, the only thing it is ever painted on',
};

/** Tokens that are not colours: the type scale, the spacing scale, the rails. */
const NON_COLOUR_PREFIXES = [
  '--font-', '--text-', '--weight-', '--leading-', '--measure',
  '--space-', '--radius', '--border-width', '--control-', '--rail-',
];

function isColourToken(name: string): boolean {
  return !NON_COLOUR_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// --- resolving ---------------------------------------------------------------

const tokensCss = readStylesheet(TOKENS_CSS);
const globalsCss = readStylesheet(GLOBALS_CSS);
const tokens = readTokens(tokensCss);
const blocks = themeBlocks(tokensCss);

/** `--x` or `--x over --surface`, resolved for one theme. */
function colourOf(reference: string, theme: Theme): Rgb {
  const table = tokens[theme];
  const [name, , behind] = reference.split(' ');
  const over = behind === undefined ? null : resolveColour(`var(${behind})`, table);
  return resolveColour(`var(${name})`, table, over);
}

function ratioFor(pairing: Pairing, theme: Theme): number {
  return contrastRatio(colourOf(pairing.fg, theme), colourOf(pairing.bg, theme));
}

// --- the checks --------------------------------------------------------------

test('every colour token is defined in both themes', () => {
  const light = [...blocks.light.keys()].filter(isColourToken).sort();
  const dark = [...blocks.dark.keys()].filter(isColourToken).sort();

  // A colour defined in one theme only is not a colour with a sensible default —
  // it is a colour the other theme silently inherits from the wrong palette.
  assert.deepEqual(
    light.filter((name) => !dark.includes(name)),
    [],
    'declared in light but not in dark',
  );
  assert.deepEqual(
    dark.filter((name) => !light.includes(name)),
    [],
    'declared in dark but not in light',
  );
});

test('every colour token is either measured or exempt for a stated reason', () => {
  const measured = new Set(
    [...textPairings(), ...nonTextPairings()].flatMap((p) => [
      p.fg.split(' ')[0]!,
      p.bg.split(' ')[0]!,
      // `--state-x-wash over --bg` names the wash as well as the surface.
      ...(p.bg.includes(' over ') ? [p.bg.split(' ')[2]!] : []),
    ]),
  );

  const unaccounted = [...blocks.light.keys()]
    .filter(isColourToken)
    .filter((name) => !measured.has(name) && !(name in EXEMPT));

  assert.deepEqual(
    unaccounted,
    [],
    'a new colour was added without deciding what it is read against — add it to a pairing list or to EXEMPT with a reason',
  );
});

for (const theme of THEMES) {
  test(`text meets ${TEXT_FLOOR}:1 in ${theme}`, () => {
    const failures = textPairings()
      .map((pairing) => ({ pairing, ratio: ratioFor(pairing, theme) }))
      .filter(({ ratio }) => ratio < TEXT_FLOOR)
      .map(({ pairing, ratio }) =>
        `${pairing.fg} on ${pairing.bg} — ${ratio.toFixed(2)}:1 (${pairing.why})`,
      );

    assert.deepEqual(failures, [], `below the ${TEXT_FLOOR}:1 text floor in ${theme}`);
  });

  test(`controls and chart lines meet ${NON_TEXT_FLOOR}:1 in ${theme}`, () => {
    const failures = nonTextPairings()
      .map((pairing) => ({ pairing, ratio: ratioFor(pairing, theme) }))
      .filter(({ ratio }) => ratio < NON_TEXT_FLOOR)
      .map(({ pairing, ratio }) =>
        `${pairing.fg} on ${pairing.bg} — ${ratio.toFixed(2)}:1 (${pairing.why})`,
      );

    assert.deepEqual(failures, [], `below the ${NON_TEXT_FLOOR}:1 non-text floor in ${theme}`);
  });

  test(`the six state hues are told apart from one another in ${theme}`, () => {
    // Hue is one of the three ways a state is distinguishable, and it only
    // counts if the six are actually different. Two states whose inks sit within
    // a hair of each other are one state wearing two names.
    const inks = STATES.map((state) => ({
      state,
      colour: colourOf(`--state-${state}-ink`, theme),
    }));

    const tooClose: string[] = [];
    for (let i = 0; i < inks.length; i += 1) {
      for (let j = i + 1; j < inks.length; j += 1) {
        const a = inks[i]!;
        const b = inks[j]!;
        const distance = Math.hypot(
          a.colour[0] - b.colour[0],
          a.colour[1] - b.colour[1],
          a.colour[2] - b.colour[2],
        );
        if (distance < 60) {
          tooClose.push(`${a.state} ${hex(a.colour)} and ${b.state} ${hex(b.colour)}`);
        }
      }
    }
    assert.deepEqual(tooClose, [], `state hues that are not distinguishable in ${theme}`);
  });
}

test('no component rule contains a colour literal', () => {
  // The whole point of the split: a colour written beside the rule that uses it
  // is a colour no theme can override and no test can find.
  const literal = /(#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(?:white|black|silver|gray|grey|red|green|blue|yellow|orange|purple|navy|teal|maroon|olive|lime|aqua|fuchsia)\b)/i;

  const offenders: string[] = [];
  for (const rule of parseRules(globalsCss)) {
    for (const { property, value } of rule.declarations) {
      if (property.startsWith('--')) continue;
      if (literal.test(value)) offenders.push(`${rule.selector} { ${property}: ${value} }`);
    }
  }

  assert.deepEqual(offenders, [], `colour literals belong in ${TOKENS_CSS}, as tokens`);
});

test('no component rule sets a raw font size', () => {
  const offenders: string[] = [];
  for (const rule of parseRules(globalsCss)) {
    for (const { property, value } of rule.declarations) {
      if (property !== 'font-size' && property !== 'font') continue;
      if (!value.includes('var(--')) offenders.push(`${rule.selector} { ${property}: ${value} }`);
    }
  }

  assert.deepEqual(offenders, [], 'a size between two steps of the scale is one of the steps of the scale');
});
