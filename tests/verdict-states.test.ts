// Seam 2 — the state system, checked for the property it exists to have.
//
// Six states, each told apart three ways over: by hue, by the shape of its rail,
// and by its Russian wording. Any one of the three has to be enough on its own,
// because each covers a different reader — the wording survives a monochrome
// screen, the rail survives somebody who cannot separate two of the hues, and
// the hue survives a glance too quick to read.
//
// Three ways over is easy to write down and easy to lose. A state added to the
// enum and not to the stylesheet renders as nothing at all; two rails that
// differ only in the colour poured into them are one shape wearing two names.
// Neither shows up in a build, in a typecheck, or in any HTTP test.
//
// Contrast for these same states is measured in `design-tokens.test.ts`, and
// their hues are checked there for being distinguishable from one another.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLOBALS_CSS, TOKENS_CSS, parseRules, readStylesheet, readTokens } from './helpers/css.ts';
import { VERDICT_STATES, stateClass, stateWords } from '../src/app/shared/verdict-state.ts';

const globalsCss = readStylesheet(GLOBALS_CSS);
const tokensCss = readStylesheet(TOKENS_CSS);
const tokens = readTokens(tokensCss);

/** The three locals a state class hands to everything that draws it. */
const LOCALS = ['--ink', '--wash', '--rail'];

test('every state has a class, and every class hands over all three locals', () => {
  const rules = parseRules(globalsCss);
  const missing: string[] = [];

  for (const state of VERDICT_STATES) {
    const selector = `.${stateClass(state)}`;
    const rule = rules.find((r) => r.selector === selector);
    if (rule === undefined) { missing.push(`${selector} — no rule at all`); continue; }

    for (const local of LOCALS) {
      const declared = rule.declarations.find((d) => d.property === local);
      if (declared === undefined) { missing.push(`${selector} { ${local} }`); continue; }
      // Each local must point at that state's own token, not at another's.
      if (!declared.value.includes(state)) {
        missing.push(`${selector} { ${local}: ${declared.value} } — not this state's token`);
      }
    }
  }

  assert.deepEqual(missing, [], 'a state with no class renders as nothing at all');
});

test('the six rails are six shapes, not one shape in six colours', () => {
  // The hue is stripped out and the geometry compared on its own. That is the
  // question worth asking: with the colour removed, are these still six things?
  const shapeOf = (value: string) => value
    .replace(/color-mix\((?:[^()]|\([^()]*\))*\)/g, 'C')
    .replace(/var\(--[\w-]+\)/g, 'C')
    .replace(/\s+/g, ' ')
    .trim();

  const shapes = new Map<string, string[]>();
  for (const state of VERDICT_STATES) {
    const value = tokens.light.get(`--rail-${state}`);
    assert.ok(value, `no --rail-${state} in the token layer`);
    const shape = shapeOf(value);
    shapes.set(shape, [...(shapes.get(shape) ?? []), state]);
  }

  const shared = [...shapes.entries()]
    .filter(([, states]) => states.length > 1)
    .map(([shape, states]) => `${states.join(' and ')} both draw ${shape}`);

  assert.deepEqual(shared, [], 'states sharing a rail shape are distinguishable by hue alone');
  assert.equal(shapes.size, VERDICT_STATES.length);
});

test('the six states say six different things', () => {
  const words = VERDICT_STATES.map(stateWords);
  assert.equal(new Set(words).size, words.length, `two states share their wording: ${words.join(' / ')}`);
  for (const word of words) assert.ok(word.trim().length > 0);
});

test('a grading failure borrows neither the colour of correct nor of incorrect', () => {
  // design.md § Failure behaviour, as a check rather than as a sentence. The
  // same rule holds for a Dispute and for Completed With Help: neither is a pass
  // and neither is a fail.
  for (const theme of ['light', 'dark'] as const) {
    const table = tokens[theme];
    const judgement = [table.get('--state-correct-ink'), table.get('--state-incorrect-ink')];
    for (const state of ['failed', 'disputed', 'help'] as const) {
      const ink = table.get(`--state-${state}-ink`);
      assert.ok(ink);
      assert.ok(
        !judgement.includes(ink),
        `${state} is drawn in the hue of a judgement in ${theme}`,
      );
    }
  }
});

test('no screen keeps a private treatment for a state the system defines', () => {
  // The state tokens are for the state classes. Anything else reaching past them
  // is a screen deciding for itself what a Verdict looks like, which is the
  // thing four screens were doing before this system existed.
  const allowed = new Set(VERDICT_STATES.map((state) => `.${stateClass(state)}`));

  /** Selectors that name a state token for something that is not one of the six. */
  const EXEMPT: Record<string, string> = {
    '.error': 'tone, not a Verdict — a refused form, a server that did not answer',
    '.ok': 'tone — a Lesson finished, a Test passed. Neither is a judgement on an answer',
    '.corrected': 'the Reference Answer itself, which is what correct looks like rather than a claim that this answer was',
    '.errors .span': 'the offending fragment inside an Error, which is already inside a state',
    '.healthBanner.unhealthy, .healthBanner.stale': 'the Grader\'s standing, not a Student\'s answer — four states of its own',
    '.healthBanner.healthy': 'the Grader\'s standing, not a Student\'s answer',
  };

  // Built from the state names rather than from a prefix: `--rail-width` is the
  // geometry every rail is drawn at, not one state's pattern, and a rule is
  // welcome to it.
  const names = VERDICT_STATES.join('|');
  const stateToken = new RegExp(`var\\(--(?:state-(?:${names})|rail-(?:${names}))\\b`);

  const offenders: string[] = [];
  for (const rule of parseRules(globalsCss)) {
    if (allowed.has(rule.selector) || rule.selector in EXEMPT) continue;
    for (const { property, value } of rule.declarations) {
      if (stateToken.test(value)) {
        offenders.push(`${rule.selector} { ${property}: ${value} }`);
      }
    }
  }

  assert.deepEqual(
    offenders, [],
    'read --ink, --wash and --rail from a state class instead, or name the selector in EXEMPT with a reason',
  );
});
