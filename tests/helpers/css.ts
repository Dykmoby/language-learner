// Reading the stylesheet as data, so a design rule can be asserted rather than
// intended.
//
// The token layer is the source of truth for every colour in the application, so
// a test that wants to know whether a pairing is legible has to resolve a token
// to a real sRGB triple the way a browser would — through `var()` chains, and
// through the `color-mix()` washes that composite a hue over the surface behind
// it. Duplicating the hex values into the test instead would assert that the
// test agrees with itself.
//
// The parser is deliberately small and knows only the CSS this project writes.
// It is not a general one, and it should fail loudly rather than guess: a value
// it cannot resolve is a value nobody has checked.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

export type Rgb = readonly [number, number, number];
export type Theme = 'light' | 'dark';

export type Declaration = { property: string; value: string };
export type Rule = {
  /** The at-rule prelude this rule sits inside, or null at the top level. */
  at: string | null;
  selector: string;
  declarations: Declaration[];
};

// --- parsing -----------------------------------------------------------------

function stripComments(css: string): string {
  // Newlines are kept so a reported line number still means something.
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Flattens a stylesheet into its rules. Nesting is only ever one at-rule deep
 * here, and anything deeper is reported against the outermost prelude — enough
 * to tell a light rule from a dark one, which is the only distinction the
 * contrast checks need.
 */
export function parseRules(css: string): Rule[] {
  const source = stripComments(css);
  const rules: Rule[] = [];
  const preludes: string[] = [];
  let buffer = '';

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;

    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) {
        preludes.push(prelude);
        continue;
      }
      // A plain rule: read to its matching brace and take the declarations.
      let depth = 1;
      let body = '';
      i += 1;
      for (; i < source.length && depth > 0; i += 1) {
        const inner = source[i]!;
        if (inner === '{') depth += 1;
        else if (inner === '}') { depth -= 1; if (depth === 0) break; }
        body += inner;
      }
      rules.push({
        at: preludes.length > 0 ? preludes.join(' ') : null,
        // A selector list wrapped across lines is still one selector list, and a
        // test that looks one up should not have to know where it was wrapped.
        selector: prelude.replace(/\s+/g, ' '),
        declarations: parseDeclarations(body),
      });
      continue;
    }

    if (char === '}') {
      preludes.pop();
      buffer = '';
      continue;
    }

    buffer += char;
  }

  return rules;
}

function parseDeclarations(body: string): Declaration[] {
  const declarations: Declaration[] = [];
  let depth = 0;
  let buffer = '';

  const flush = () => {
    const text = buffer.trim();
    buffer = '';
    if (text === '') return;
    const colon = text.indexOf(':');
    if (colon === -1) return;
    declarations.push({
      property: text.slice(0, colon).trim(),
      value: text.slice(colon + 1).trim(),
    });
  };

  for (const char of body) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    // A semicolon inside `color-mix(...)` is not a declaration boundary.
    if (char === ';' && depth === 0) { flush(); continue; }
    buffer += char;
  }
  flush();
  return declarations;
}

// --- the token layer ---------------------------------------------------------

export type Tokens = Record<Theme, Map<string, string>>;

/**
 * Every custom property the token layer declares, split by theme.
 *
 * Dark starts as a copy of light: the dark block redefines the tokens that
 * change and inherits the rest, exactly as the cascade does. A test asking
 * whether both themes define a token therefore has to look at the raw blocks,
 * which `themeBlocks` gives it separately.
 */
export function readTokens(css: string): Tokens {
  const light = new Map<string, string>();
  const dark = new Map<string, string>();

  for (const rule of parseRules(css)) {
    const custom = rule.declarations.filter((d) => d.property.startsWith('--'));
    if (custom.length === 0) continue;
    const isDark = rule.at !== null && /prefers-color-scheme:\s*dark/.test(rule.at);
    for (const { property, value } of custom) {
      if (isDark) dark.set(property, value);
      else light.set(property, value);
    }
  }

  // The cascade, made explicit: dark sees every light token it did not override.
  const merged = new Map(light);
  for (const [property, value] of dark) merged.set(property, value);
  return { light, dark: merged };
}

/** The tokens each theme block declares in its own right, before the cascade. */
export function themeBlocks(css: string): Tokens {
  const light = new Map<string, string>();
  const dark = new Map<string, string>();
  for (const rule of parseRules(css)) {
    const isDark = rule.at !== null && /prefers-color-scheme:\s*dark/.test(rule.at);
    for (const { property, value } of rule.declarations) {
      if (!property.startsWith('--')) continue;
      (isDark ? dark : light).set(property, value);
    }
  }
  return { light, dark };
}

// --- resolving a colour ------------------------------------------------------

function parseHex(hex: string): Rgb | null {
  const text = hex.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) return null;
  const digits = text.slice(1);
  const pairs = digits.length === 3
    ? [...digits].map((d) => d + d)
    : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
  return pairs.map((p) => Number.parseInt(p, 16)) as unknown as Rgb;
}

/** Splits `color-mix(in srgb, A 30%, B)` into its arguments, respecting nesting. */
function splitArguments(inside: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of inside) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) { parts.push(buffer.trim()); buffer = ''; continue; }
    buffer += char;
  }
  parts.push(buffer.trim());
  return parts;
}

/**
 * Resolves a colour expression against a theme's tokens.
 *
 * `over` is the colour actually painted behind this one. A translucent wash has
 * no contrast ratio of its own — what a reader sees is the wash composited over
 * whatever it sits on — so a value that turns out to be translucent without a
 * background to composite against is an error rather than a guess.
 */
export function resolveColour(
  expression: string,
  tokens: Map<string, string>,
  over: Rgb | null = null,
  seen: ReadonlySet<string> = new Set(),
): Rgb {
  const value = expression.trim();

  const hex = parseHex(value);
  if (hex) return hex;

  if (value === 'transparent') {
    if (over === null) throw new Error('`transparent` has no colour without a background behind it');
    return over;
  }

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(value);
  if (varMatch) {
    const name = varMatch[1]!;
    if (seen.has(name)) throw new Error(`the token ${name} refers to itself`);
    const declared = tokens.get(name);
    const next = declared ?? varMatch[2];
    if (next === undefined) throw new Error(`no token named ${name}`);
    return resolveColour(next, tokens, over, new Set([...seen, name]));
  }

  const mixMatch = /^color-mix\(([\s\S]*)\)$/.exec(value);
  if (mixMatch) {
    const [space, first, second] = splitArguments(mixMatch[1]!);
    if (space?.trim() !== 'in srgb') throw new Error(`only \`in srgb\` mixes are understood: ${value}`);
    if (first === undefined || second === undefined) throw new Error(`malformed color-mix: ${value}`);

    const read = (part: string): { colour: string; weight: number | null } => {
      const percent = /\s([\d.]+)%$/.exec(part);
      if (!percent) return { colour: part, weight: null };
      return { colour: part.slice(0, percent.index).trim(), weight: Number(percent[1]) / 100 };
    };

    const a = read(first);
    const b = read(second);
    const weightA = a.weight ?? (b.weight === null ? 0.5 : 1 - b.weight);
    const weightB = b.weight ?? 1 - weightA;

    // Mixing into `transparent` is how this stylesheet writes a wash: the result
    // is the other colour at that alpha, painted over whatever is behind it.
    if (a.colour === 'transparent' || b.colour === 'transparent') {
      if (over === null) throw new Error(`a wash needs a background to composite over: ${value}`);
      const opaque = a.colour === 'transparent' ? b : a;
      const alpha = a.colour === 'transparent' ? weightB : weightA;
      const colour = resolveColour(opaque.colour, tokens, over, seen);
      return composite(colour, alpha, over);
    }

    const left = resolveColour(a.colour, tokens, over, seen);
    const right = resolveColour(b.colour, tokens, over, seen);
    const total = weightA + weightB || 1;
    return [0, 1, 2].map((i) =>
      Math.round((left[i]! * weightA + right[i]! * weightB) / total),
    ) as unknown as Rgb;
  }

  throw new Error(`unrecognised colour expression: ${value}`);
}

/** A colour at `alpha` painted over an opaque background. */
export function composite(colour: Rgb, alpha: number, over: Rgb): Rgb {
  return [0, 1, 2].map((i) =>
    Math.round(colour[i]! * alpha + over[i]! * (1 - alpha)),
  ) as unknown as Rgb;
}

// --- WCAG contrast -----------------------------------------------------------

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(colour: Rgb): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
}

/** WCAG 2.1 contrast ratio, between 1 and 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function hex(colour: Rgb): string {
  return `#${colour.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// --- reading this project's stylesheets --------------------------------------

export const TOKENS_CSS = 'src/app/tokens.css';
export const GLOBALS_CSS = 'src/app/globals.css';

export function readStylesheet(relativePath: string): string {
  return readFileSync(new URL(relativePath, `file://${REPO}`), 'utf8');
}
