# The typeface

IBM Plex Sans and IBM Plex Mono, subset to the three scripts this application
sets: Latin, Cyrillic and Cyrillic Extended.

Licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`, which ships
beside the files because the licence requires it to.

## Why these files are in the repository

design.md § Platform: outbound HTTPS leaves this box through a proxy that
interactive shells get from the profile and systemd units do not. A font fetched
at build time or at run time would be a network dependency in the one place this
project has already been bitten — the failure would arrive as a missing typeface
on a Sunday rather than as a build error on a Tuesday. They are checked in, and
`npm run build` needs no network to succeed.

## What each file is for

| file | covers |
|---|---|
| `ibm-plex-sans-latin.woff2` | English content, Latin punctuation, the dashes and quotes the Russian dictionary uses |
| `ibm-plex-sans-cyrillic.woff2` | the Russian interface |
| `ibm-plex-sans-cyrillic-ext.woff2` | **Tajik** — ғ ӣ қ ӯ ҳ ҷ live outside the basic Cyrillic block |
| `ibm-plex-mono-400-*.woff2` | the error span, and code and pre blocks in Theory |

The sans files are a variable font across the 100–700 weight axis, so one file
per subset carries every weight in the type scale. The mono is needed at one
weight and ships at one weight.

`tests/typeface.test.ts` reads the character map out of each file rather than
trusting its name, so dropping `cyrillic-ext` to save 24 KB fails the suite
instead of quietly turning every Tajik Course title into boxes.

## Replacing them

The files came from Google Fonts' per-script slices of IBM Plex, which is where
to get them again:

```
curl -A '<a current browser UA>' \
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@100..700&family=IBM+Plex+Mono:wght@400&display=block'
```

That returns one `@font-face` per subset with a `unicode-range` and a URL.
Download the `latin`, `cyrillic` and `cyrillic-ext` woff2 files, name them as
above, and keep the `unicode-range` values in `src/app/fonts.css` in step with
what the CSS returned. Do it from an interactive shell — that is where the proxy
is.
