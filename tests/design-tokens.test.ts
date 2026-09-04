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
import { theme } from '../src/app/theme.ts';

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

/**
 * What a recess has to clear against the surface it is cut into.
 *
 * Not 3:1, deliberately. A track, a badge disc or a tag is a container, not a
 * mark: what carries the meaning is the fill inside it and the words beside it,
 * and an empty bar drawn at 3:1 shouts louder than a full one. But it is not
 * nothing either — `--surface-sunken` on `--surface` is 1.06:1, which is what a
 * track looked like before this floor existed, and once framing put rows on
 * `--surface-sunken` the same value on the same value was 1.00:1.
 */
const RECESS_FLOOR = 1.15;

const THEMES: Theme[] = ['light', 'dark'];

// --- what sits on what -------------------------------------------------------

type Pairing = { fg: string; bg: string; why: string };

/** The four surfaces anything can be painted on. */
const SURFACES = ['--bg', '--surface', '--surface-sunken', '--surface-well'] as const;

/**
 * The three of them a wash can composite over, which is not all four.
 *
 * A wash is semi-transparent, so what it lands on decides what its ink is read
 * against. It never lands on `--surface-well`: every element that carries a
 * state writes `background: var(--wash, var(--surface-well))` — the wash
 * *replaces* the well rather than covering it, and composites over the row or
 * the card behind the element instead. Measuring a wash over the well would be
 * holding this palette to a stack that is never painted.
 */
const WASH_BACKDROPS = ['--bg', '--surface', '--surface-sunken'] as const;

const STATES = ['correct', 'partial', 'incorrect', 'help', 'disputed', 'failed'] as const;

function textPairings(): Pairing[] {
  const pairings: Pairing[] = [];

  for (const surface of SURFACES) {
    pairings.push({ fg: '--fg', bg: surface, why: 'body text' });
    pairings.push({ fg: '--fg-muted', bg: surface, why: 'secondary text — a position, a count, a date' });
    pairings.push({ fg: '--accent', bg: surface, why: 'a link' });
  }

  pairings.push({ fg: '--accent-on', bg: '--accent', why: 'the label on a primary button' });
  // A hover that dropped the label below the floor would be a button that is
  // legible until you reach for it.
  pairings.push({ fg: '--accent-on', bg: '--accent-hover', why: 'the label on a primary button, hovered' });
  pairings.push({ fg: '--accent', bg: '--accent-quiet', why: 'a link inside a highlighted panel' });
  pairings.push({ fg: '--fg', bg: '--accent-quiet', why: 'text inside a highlighted panel' });
  pairings.push({ fg: '--accent', bg: '--accent-quiet-strong', why: 'a link inside a highlighted panel, hovered' });
  pairings.push({ fg: '--fg', bg: '--accent-quiet-strong', why: 'text inside a highlighted panel, hovered' });

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
    }
    for (const surface of WASH_BACKDROPS) {
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
  '--line': 'a hairline that separates — never a mark, never a track, and never the edge of a control',
  // Surfaces, measured above as backgrounds rather than as foregrounds.
  '--bg': 'a surface — checked as the background of every pairing above',
  '--surface': 'a surface',
  '--surface-sunken': 'a surface',
  '--surface-well': 'a surface — measured as the background of every pairing above',
  '--accent-quiet': 'a surface',
  '--accent-on': 'checked against --accent and --accent-hover, the only things it is ever painted on',
};

/**
 * Mantine's ten-step ramp, which is the shape its theme wants a colour in.
 *
 * Exempt as a family rather than one line each, because the reason is one
 * reason: no step of it is ever read. `theme.ts` maps every Mantine variant
 * variable that paints a surface — filled, filled-hover, light, outline — onto
 * `--accent`, `--accent-hover` and `--accent-quiet`, all three of which are
 * measured above. The ramp is there so Mantine's own variables resolve to
 * something in the right family if a component reaches for a step directly.
 */
for (let step = 0; step <= 9; step += 1) {
  EXEMPT[`--brand-${step}`] = "a step of Mantine's ramp — every surface that carries text is painted from --accent, --accent-hover or --accent-quiet";
}

/**
 * Tokens that are not colours: the type scale, the spacing scale, the rails, and
 * the two geometry families the navigation column and the elevation steps need.
 *
 * `--shadow-` is the one that deserves a sentence. A shadow does contain a
 * colour, and it is on this list anyway, because a contrast ratio is a question
 * about two things a reader has to tell apart and nobody reads a shadow. What
 * separates a card from the page it sits on is its border, which is `--line` and
 * is measured. A shadow that vanished entirely would cost this design nothing it
 * is holding on to.
 */
const NON_COLOUR_PREFIXES = [
  '--font-', '--text-', '--weight-', '--leading-', '--measure',
  '--space-', '--radius', '--border-width', '--control-', '--rail-',
  '--nav-', '--shadow-',
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

  test(`a recess is visible in the surfaces it is cut into in ${theme}`, () => {
    // The track a meter fills, the disc a Lesson's number sits in, a tag. They
    // are painted from one value rather than one per context, so that value has
    // to separate from both the card it can sit on and the row it can sit in.
    const failures = (['--surface', '--surface-sunken'] as const)
      .map((surface) => ({
        surface,
        ratio: contrastRatio(colourOf('--surface-well', theme), colourOf(surface, theme)),
      }))
      .filter(({ ratio }) => ratio < RECESS_FLOOR)
      .map(({ surface, ratio }) => `--surface-well on ${surface} — ${ratio.toFixed(2)}:1`);

    assert.deepEqual(failures, [], `below the ${RECESS_FLOOR}:1 recess floor in ${theme}`);
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

  test(`the current segment is told apart from every state hue in ${theme}`, () => {
    // The progress bar draws one segment that is not a judgement — where the
    // Student is — beside up to six that are, and it has to be distinguishable
    // from all of them or the bar says the wrong thing. It was `--accent`, which
    // in the dark palette sits 49 from Disputed and 70 from Completed With Help
    // against the 60 the six are held to between themselves: "you are here" and
    // "you finished this with help" were the same blue at a glance.
    //
    // Held to the same floor as the six rather than to a looser one, because the
    // reader is doing the same job — telling one segment of one bar from the
    // segment beside it.
    const current = colourOf('--fg', theme);

    const tooClose = STATES
      .map((state) => ({ state, colour: colourOf(`--state-${state}-ink`, theme) }))
      .filter(({ colour }) => Math.hypot(
        current[0] - colour[0], current[1] - colour[1], current[2] - colour[2],
      ) < 60)
      .map(({ state, colour }) => `current ${hex(current)} and ${state} ${hex(colour)}`);

    assert.deepEqual(tooClose, [], `the current segment is not distinguishable in ${theme}`);
  });
}

test('a filled Mantine button takes its label colour from the token layer', () => {
  // The library writes `--button-color: var(--mantine-color-white)` into its own
  // Button rule, which the `:root` variable mapping cannot reach. So a filled
  // Button carried white text in both themes while `a.button` — the same control
  // written as a link — carried `--accent-on`. In light they agreed by accident;
  // in dark the accent *is* the light colour, so one button had near-black text
  // and the other white text on the same pale blue.
  //
  // Asserted against the theme object rather than a browser, because that is
  // where the mapping lives and a pure test can read it.
  const button = theme.components?.Button;
  assert.ok(button && typeof button.vars === 'function', 'the Button maps its own variables');

  /** What a `vars` callback hands back: one record of CSS variables per selector. */
  type Vars = Record<string, Record<string, string | undefined>>;
  const varsFor = (props: object): Vars =>
    (button.vars as (...args: never[]) => Vars)(
      {} as never, props as never, {} as never,
    );

  const filled = varsFor({});
  assert.equal(
    filled.root!['--button-color'], 'var(--accent-on)',
    'a filled button in the brand colour asks the token layer what is legible on the accent',
  );

  // And only that one. A `default` button paints itself from the default-variant
  // colour, and the destructive red one is not on `--accent` at all — telling
  // either what is legible on the accent would be telling it something false.
  for (const props of [{ variant: 'default' }, { color: 'red' }]) {
    const other = varsFor(props);
    assert.equal(
      other.root!['--button-color'], undefined,
      `a ${JSON.stringify(props)} button is left alone`,
    );
  }
});

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
