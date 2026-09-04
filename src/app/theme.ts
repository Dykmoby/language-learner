// Mantine, pointed at the token layer.
//
// The component library brings behaviour, structure and a set of accessible
// controls; it does not bring a palette. Every Mantine variable that paints
// something is resolved below to a custom property from `tokens.css`, so there
// is still exactly one place a colour is decided and exactly one test that
// measures it. The alternative — Mantine's own theme holding hexes beside
// `tokens.css` holding hexes — is two sources of truth for one question, and the
// contrast test can only see one of them.
//
// The mapping runs one way on purpose. Nothing here reads a Mantine default and
// copies it into a token; tokens are the input.

import {
  createTheme,
  type ButtonProps,
  type CSSVariablesResolver,
  type MantineTheme,
  type MantineThemeOverride,
} from '@mantine/core';

/** Mantine wants a colour as ten steps. Ours live in the token layer. */
const BRAND = Array.from({ length: 10 }, (_, step) => `var(--brand-${step})`) as unknown as
  readonly [string, string, string, string, string, string, string, string, string, string];

/** Label, control, hint. Stated once so five components cannot drift apart. */
const FIELD_ORDER = ['label', 'input', 'description', 'error'] as const;

export const theme: MantineThemeOverride = createTheme({
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: {
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    sizes: {
      h1: { fontSize: 'var(--text-2xl)', lineHeight: 'var(--leading-tight)' },
      h2: { fontSize: 'var(--text-xl)', lineHeight: 'var(--leading-tight)' },
      h3: { fontSize: 'var(--text-lg)', lineHeight: 'var(--leading-tight)' },
      h4: { fontSize: 'var(--text-base)', lineHeight: 'var(--leading-tight)' },
      h5: { fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-tight)' },
      h6: { fontSize: 'var(--text-xs)', lineHeight: 'var(--leading-tight)' },
    },
  },

  colors: { brand: BRAND },
  primaryColor: 'brand',
  // One shade in both themes. The dark ramp is built to put its accent at the
  // same index rather than deeper, so the two schemes agree about which step
  // "the accent" means.
  primaryShade: 6,

  defaultRadius: 'md',
  // The Practice and the Test answer on controls a finger has to land on.
  focusRing: 'auto',
  cursorType: 'pointer',

  components: {
    Button: {
      defaultProps: { radius: 'md' },
      // The label on a filled button, pointed at the token that decides it.
      //
      // Mantine's own default is `--mantine-color-white`, written into the
      // Button's root rule and therefore out of reach of the variable mapping
      // below, which can only set things on `:root`. So a filled button carried
      // white text in both themes while `a.button` — the same control written as
      // a link — carried `--accent-on`. In the light theme the two agreed by
      // coincidence. In the dark one the accent is the *light* colour, so the
      // hand-built control had near-black text and the library one had white
      // text on the same pale blue: two buttons on two screens of the same
      // Lesson, disagreeing.
      //
      // `--accent-on` is the answer to "what is legible on `--accent`" and it is
      // measured in `tests/design-tokens.test.ts` in both themes. This is what
      // makes Mantine ask the question rather than assume white.
      vars: (_theme: MantineTheme, props: ButtonProps) => {
        // Only the filled variant in the brand colour. `variant="default"` paints
        // itself from `--mantine-color-default-color`, and a button given an
        // explicit `color` — the one destructive action in the Admin section — is
        // not on `--accent` and must not be told what is legible on it.
        const filled = props.variant === undefined || props.variant === 'filled';
        return {
          root: filled && props.color === undefined
            ? { '--button-color': 'var(--accent-on)' }
            : {},
        };
      },
    },
    // The hint goes *under* the control it explains, not between the control and
    // its own label.
    //
    // Mantine's default order is label, description, input — which makes the
    // height of a field depend on whether it happens to carry a hint, and two
    // fields side by side in a `Group` are then two fields whose boxes start at
    // different heights. The New Course form is where that shows: Language has
    // no hint and CEFR level has one, so the two sat a line and a half apart in
    // a row that exists to say they belong together.
    //
    // Under the control they are all one shape again, and the reading is the
    // better one anyway: this is the field, and this is what choosing costs.
    // `aria-describedby` is written from the same prop whichever order it is in,
    // so what a screen reader announces does not change.
    TextInput: { defaultProps: { radius: 'md', inputWrapperOrder: FIELD_ORDER } },
    Textarea: { defaultProps: { radius: 'md', inputWrapperOrder: FIELD_ORDER } },
    NumberInput: { defaultProps: { radius: 'md', inputWrapperOrder: FIELD_ORDER } },
    Select: { defaultProps: { radius: 'md', allowDeselect: false, inputWrapperOrder: FIELD_ORDER } },
    NativeSelect: { defaultProps: { radius: 'md', inputWrapperOrder: FIELD_ORDER } },
    Card: { defaultProps: { radius: 'lg', withBorder: true } },
    Paper: { defaultProps: { radius: 'lg' } },
    Badge: { defaultProps: { radius: 'xl' } },
  },
});

/**
 * Mantine's variables, resolved onto ours.
 *
 * Everything sits in `variables` rather than in `light` and `dark`, because the
 * token layer already answers the colour-scheme question for itself: its dark
 * block swaps what `--surface` means off the same `data-mantine-color-scheme`
 * attribute Mantine sets, and a Mantine variable pointing at `var(--surface)`
 * follows without being told twice. Two places deciding which theme is on is how
 * a dark palette drifts out of a light one, which is the thing `tokens.css` was
 * split to stop.
 */
/**
 * The colour half of the mapping, stated once and handed to both schemes.
 *
 * It cannot live in `variables` with the rest. Mantine's own stylesheet
 * re-points `--mantine-color-anchor` and every `-filled` and `-light` variable
 * inside its `[data-mantine-color-scheme="dark"]` block, and a declaration in
 * that block beats one on a bare `:root` — so a dark screen would quietly fall
 * back to Mantine's ramp for exactly the surfaces this application has an
 * opinion about. Handed to `light` and `dark` alike, because the token layer is
 * what varies by scheme and these only ever name a token.
 */
const SCHEME_COLOURS = {
    '--mantine-color-body': 'var(--bg)',
    '--mantine-color-text': 'var(--fg)',
    '--mantine-color-bright': 'var(--fg)',
    '--mantine-color-dimmed': 'var(--fg-muted)',
    '--mantine-color-anchor': 'var(--accent)',

    // A control's own surface and its edge. The edge is `--line-strong` and not
    // `--line` for the reason stated in the token layer: WCAG treats the
    // boundary of an input as something a reader has to be able to find.
    '--mantine-color-default': 'var(--surface)',
    '--mantine-color-default-hover': 'var(--surface-sunken)',
    '--mantine-color-default-color': 'var(--fg)',
    '--mantine-color-default-border': 'var(--line-strong)',

    '--mantine-color-disabled': 'var(--surface-sunken)',
    '--mantine-color-disabled-border': 'var(--line)',
    '--mantine-color-disabled-color': 'var(--fg-muted)',

    // Refusals are the one place a state hue reaches into Mantine's own palette:
    // an invalid field and an incorrect Verdict are the same red on purpose.
    '--mantine-color-error': 'var(--state-incorrect-ink)',

    // The four surfaces a variant paints, for the primary colour and for the
    // `brand` name that is the same colour under its own key.
    '--mantine-primary-color-filled': 'var(--accent)',
    '--mantine-primary-color-filled-hover': 'var(--accent-hover)',
    '--mantine-primary-color-light': 'var(--accent-quiet)',
    '--mantine-primary-color-light-hover': 'var(--accent-quiet)',
    '--mantine-primary-color-light-color': 'var(--accent)',
    '--mantine-primary-color-contrast': 'var(--accent-on)',
    '--mantine-color-brand-filled': 'var(--accent)',
    '--mantine-color-brand-filled-hover': 'var(--accent-hover)',
    '--mantine-color-brand-light': 'var(--accent-quiet)',
    '--mantine-color-brand-light-hover': 'var(--accent-quiet)',
    '--mantine-color-brand-light-color': 'var(--accent)',
    '--mantine-color-brand-outline': 'var(--accent)',
    '--mantine-color-brand-outline-hover': 'var(--accent-quiet)',
    '--mantine-color-brand-text': 'var(--accent)',
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--mantine-font-family': 'var(--font-sans)',
    '--mantine-font-family-monospace': 'var(--font-mono)',
    '--mantine-font-family-headings': 'var(--font-sans)',

    '--mantine-font-size-xs': 'var(--text-xs)',
    '--mantine-font-size-sm': 'var(--text-sm)',
    '--mantine-font-size-md': 'var(--text-base)',
    '--mantine-font-size-lg': 'var(--text-lg)',
    '--mantine-font-size-xl': 'var(--text-xl)',

    '--mantine-line-height': 'var(--leading-normal)',
    '--mantine-line-height-xs': 'var(--leading-tight)',
    '--mantine-line-height-sm': 'var(--leading-tight)',
    '--mantine-line-height-md': 'var(--leading-normal)',
    '--mantine-line-height-lg': 'var(--leading-normal)',
    '--mantine-line-height-xl': 'var(--leading-prose)',

    '--mantine-spacing-xs': 'var(--space-2)',
    '--mantine-spacing-sm': 'var(--space-3)',
    '--mantine-spacing-md': 'var(--space-4)',
    '--mantine-spacing-lg': 'var(--space-5)',
    '--mantine-spacing-xl': 'var(--space-6)',

    '--mantine-radius-xs': 'var(--radius-sm)',
    '--mantine-radius-sm': 'var(--radius-sm)',
    '--mantine-radius-md': 'var(--radius)',
    '--mantine-radius-lg': 'var(--radius-lg)',
    '--mantine-radius-xl': 'var(--radius-xl)',
    '--mantine-radius-default': 'var(--radius)',

    '--mantine-shadow-xs': 'var(--shadow-sm)',
    '--mantine-shadow-sm': 'var(--shadow-sm)',
    '--mantine-shadow-md': 'var(--shadow-md)',
    '--mantine-shadow-lg': 'var(--shadow-md)',
    '--mantine-shadow-xl': 'var(--shadow-md)',

  },

  light: SCHEME_COLOURS,
  dark: SCHEME_COLOURS,
});