# Design

The settled design, agreed 2026-08-20. Domain vocabulary lives in [`../CONTEXT.md`](../CONTEXT.md); the reasoning behind the load-bearing decisions lives in [`adr/`](./adr/).

## Platform

| | |
|---|---|
| Host | Raspberry Pi 5, aarch64, 8 GB RAM, 4 cores |
| Runtime | Node 24, Next.js (App Router), TypeScript |
| Storage | SQLite via Drizzle, WAL mode |
| Process | systemd, `User=dykmoby`, `HOME=/home/dykmoby` |
| Ingress | Caddy → `language-learner.duckdns.org` → `localhost:4100` |
| Grading | `@anthropic-ai/claude-agent-sdk`, subscription auth |

**`HOME` is load-bearing.** The Agent SDK reads credentials from `~/.claude`. Running the service as any other user fails every grading call with an error that does not look like an auth error. Prove this path early.

**So is the outbound proxy.** Measured in step 2: outbound HTTPS leaves this box through a proxy on `127.0.0.1:7890`, which interactive shells get from the profile and systemd units do not. Without `HTTP_PROXY`/`HTTPS_PROXY` in the unit's environment file, every Grader call fails with `Failed to authenticate. API Error: 403 Request not allowed` — an error that names credentials while the credentials are fine. See [ADR 0001](./adr/0001-claude-agent-sdk-as-grading-engine.md).

Ports 4000, 8001-8006 and 1001-1006 are already taken on this box by other projects. Redis is running on 6379 but is deliberately unused here. The application binds `127.0.0.1:4100` only, so Caddy is the sole ingress and nothing on the LAN can reach it without TLS.

No Docker — it adds an ARM image build step for no isolation benefit on a single-tenant box.

## Security

Public on the internet, so:

- App login only. No Caddy `basic_auth` in front — a second gate on top of a session login is daily friction that protects nothing.
- In-app login throttle with exponential backoff, lockout after 5 failures.
- fail2ban on the Caddy log to absorb the noise floor before it reaches Node.
- Two seeded accounts via CLI script, argon2id hashes, httpOnly session cookies. **No registration route exists.** `igor` holds the Admin role.
- Student input is fenced as data inside the Grader prompt and marked as never-to-be-followed. It is **not** filtered — filtering would mangle legitimate answers, and with two trusted accounts, manipulating the Grader is self-sabotage rather than a breach.

## Content model

```
Language
└── Course (level, grader model)
    ├── Lesson (ordered)
    │   ├── Theory   — markdown + images
    │   └── Practice — Exercise Set
    └── Test — Exercise Set, pass threshold
```

Exercises always belong to an Exercise Set, which is owned by either a Lesson's Practice or a Test. Ordering, rendering and grading therefore never branch on "am I in a Lesson or a Test".

### Exercise Kinds

| Kind | Judged by |
|---|---|
| Composition | Grader |
| Translation | Grader |
| Open writing | Grader |
| Fill-gap | Deterministic Check |
| Multiple choice | Deterministic Check |
| Word order | Deterministic Check |

Speaking and listening are deliberately out of scope. Adding them pulls in TTS/STT and roughly doubles the project.

### Deterministic Check normalisation

Applied in order: trim → collapse internal whitespace → case-insensitive → strip trailing `.!?` → `ё` → `е`.

Each Exercise stores an **array** of accepted answers plus an optional `caseSensitive` flag, needed for "put the word in the correct form" where capitalisation is the point. Word order matches an exact sequence against one or more accepted orders.

**No typo tolerance.** In a language-learning app, tolerating a misspelling teaches the misspelling.

## Grading

Sonnet 5 for English, Opus 5 for Tajik, configurable per Course — see [ADR 0002](./adr/0002-grader-model-per-language.md).

Every Grader call is stateless but context-rich. It receives:

- target Language and Course level
- Lesson title and grammar focus
- the Exercise prompt
- the Reference Answer and any Accepted Variants
- the Student's earlier Submissions on this Exercise

That last item is what produces Progressive Hints: attempt 1 nudges, attempt 2 names the error type, attempt 3 shows the structure.

### Configuration

Stripping Claude Code's own ~8-11k-token harness prompt takes **four settings, not one** — measured in step 1:

| setting | why |
|---|---|
| `systemPrompt` as a plain string | replaces the harness prompt rather than adding to it |
| `settingSources: []` | the default is `["user","project","local"]`, which loads `CLAUDE.md`, `~/.claude`, and hooks |
| `skills: []` | otherwise project and user skills re-inflate the context |
| `strictMcpConfig: true` | claude.ai connectors load under subscription auth otherwise |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | auto-memory ignores `settingSources` entirely |

Tools are disabled with **`tools: []`**. `allowedTools`/`disallowedTools` govern permission, not availability, and will not do this.

Thinking is **`adaptive` with `effort: 'low'`, not disabled**. Disabling it is no faster — it matched or lost to `adaptive`/`low` on every pair in step 1 — and it carries the tag-leakage risk § Authoring documents, which would corrupt a strict JSON contract.

Also: 90s hard timeout, `maxTurns: 1`, and an in-process semaphore at concurrency 2 with a FIFO queue behind it. See [ADR 0004](./adr/0004-stateless-grading-stateful-authoring.md).

Token accounting reads `result.modelUsage[model]`, not `result.usage` — the latter aggregates across models and under-reports the grading model. True context size is `inputTokens + cacheReadInputTokens`.

### Response contract

Field order matters — `feedback_ru` is emitted first so the streamed explanation reaches the Student before the Verdict resolves.

```json
{
  "feedback_ru": "...",
  "corrected": "...",
  "errors": [{ "type": "<enum>", "span": "...", "explanation_ru": "..." }],
  "verdict": "correct | partially_correct | incorrect"
}
```

The Coherence Guard reconciles the last field against the third — see [ADR 0003](./adr/0003-verdict-authority-split.md).

**The parser must tolerate markdown fences.** Sonnet 5 wrapped its JSON in them on 5 of 5 runs of the longest case in step 1. It is a routine model habit, not something worth failing a Submission over — but log it when it happens.

### Error Type enum

Stable in storage, Russian labels rendered at display time.

**Core (both Languages):** `word_order`, `spelling`, `punctuation`, `capitalization`, `vocabulary_choice`, `missing_word`, `extra_word`, `meaning_mismatch`, `register_style`

**English:** `article`, `tense`, `irregular_verb`, `subject_verb_agreement`, `preposition`, `plural_form`, `countability`, `modal_verb`, `conditional`, `gerund_vs_infinitive`, `phrasal_verb`

**Tajik:** `verb_agreement`, `izofat`, `definiteness_ro`, `pronoun_enclitic`, `plural_form_tj`, `preposition_tj`, `compound_verb`, `tense_tj`

> The Tajik list is provisional and needs review by the person teaching it. It was proposed from a much thinner base than the English one.

### Failure behaviour

A failed or timed-out grading persists the Submission with `status: 'grading_failed'`, shows the Student a Russian retry message, and leaves the Exercise unlocked. **A failure must never be rendered as a wrong answer.**

This path is **load-bearing, not defensive**: step 1 measured roughly one contract failure in 24 calls (~4%) — an intermittent parse failure on the longest output.

Grading runs to completion server-side and persists regardless of whether the client is still listening. Even at the measured 4-7s per call, a closed tab must never lose a Submission.

## Progression

- `correct` advances.
- `partially_correct` keeps the Student on the Exercise with a sharper Progressive Hint.
- After 3 failures, Reveal is offered → state becomes Completed With Help, which counts as complete but renders as a distinct segment in the progress bar.
- Dispute unblocks progression immediately and queues for Admin review.
- Lessons unlock sequentially, with a per-Course Admin toggle for free navigation.

## Tests

Contain both Exercise Kinds. Deterministic ones are checked in code at submission; all Grader-judged answers are batched into a **single** Claude call — faster, cheaper, and more internally consistent than N separate calls.

Score is percentage correct against a per-Test threshold, default 80%. Retakes are unlimited and every attempt is logged. Failing a Test gates nothing — Lessons already handle progression, and a Test is a mirror, not a gate.

Review screen shows every Exercise with correct ones collapsed. Grader-judged Exercises highlight the whole Exercise red plus feedback and Reference Answer; Deterministic ones mark the chosen wrong option red and the correct option green.

## Disputes

The Admin review screen shows the Exercise, Reference Answer, Student's answer, the Grader's Errors, and the Student's comment. One click promotes the answer to an Accepted Variant, which then flows into future Grader context as teacher-confirmed.

This is the only closed feedback loop in the system: the Grader measurably improves through use, without prompt engineering.

## Progress and statistics

Per-Lesson completion percentage, with Completed With Help shown as its own segment. Error Type histogram across all Submissions ("артикли — 14 ошибок"), and charts over selected Lessons to show change over time. All of it derives from the Error Type enum, which is why the enum must be fixed.

## Authoring

Forms per Exercise Kind, markdown for Theory, image upload stored in the repo folder and served through a Next route.

Alternatively, Generation: the Admin supplies topic, vocabulary list, exercise count, Kind mix, "continue from Lesson N", plus a free-text wishes box. Kind mix is an explicit control because otherwise generation over-produces multiple choice — the cheapest Kind to write and the least useful to learn from.

**Model picker + six Effort entries:** `low`, `medium`, `high`, `xhigh`, `max`, and «По умолчанию» (parameter omitted). There is no thinking toggle: `low` is the fast path, and on Opus 5 disabling thinking is rejected outright at `xhigh`/`max` and causes tool-call and tag leakage elsewhere.

Refinement exchanges the whole Draft each turn. Manual edits are fed back as the current document, so hand-editing and conversing interleave freely. Every turn is a restorable version — `forkSession` in the SDK provides this cheaply.

**Generated Drafts never publish unreviewed.** A hallucinated Reference Answer would silently poison grading for that Exercise.

Per-Course JSON import/export exists so content is portable off the Pi.

## Interface

Russian strings live in a single central `ru.ts` dictionary — no i18n library, but adding a second interface language stays a translation job rather than a rewrite.

Restrained visual identity. Typography carries more weight here than in most apps because every screen sets Cyrillic beside Latin, and the error-highlight states need a colour system that holds in both light and dark themes. No gamification — streak mechanics are built to retain strangers.

## Operations

- WAL mode, nightly `.backup` to `~/backups`, 14-day retention.
- Weekly copy pulled off the Pi manually onto another device.
- Per-Course JSON export as the human-readable, restore-anywhere format.
- Periodic health check: a lightweight grading call against a fixed known input. On failure the Admin dashboard shows a red banner — otherwise the first person to discover expired credentials is a student mid-Lesson.

## Build order

1. **Grading spike, no UI** — **done 2026-08-20, GO.** SDK harness with `systemPrompt` overridden, tools off, streaming, JSON parse, enum validation, Coherence Guard, measured against the baseline below. This was the go/no-go; everything else is ordinary web work. Results in § Agent SDK, step 1.
2. **Skeleton and deploy path** — **done 2026-08-20.** Next.js, schema, auth, seed script, systemd, Caddy, DuckDNS. The `HOME`/credentials path is proven: the deployed service returns a healthy check in 4.8s at 861 context tokens, inside the spike's measured band. The failure it actually surfaced was the proxy, not `HOME` — see § Platform.
3. **Student vertical slice.** One hardcoded Lesson → Practice → streamed grading → progression.
4. **Authoring** — forms, markdown, images.
5. **Generation and Refinement.**
6. **Tests** — batch grading and review screen.
7. **Progress, charts, Disputes.**
8. **Operations** — backup cron, health check, export.

## Measured baseline

### `claude -p` subprocess, step 0, 2026-08-20

Single-shot calls from this Pi. Numbers include Claude Code's full harness system prompt, which the SDK path strips.

| | wall | api | ttft | first stream token |
|---|---|---|---|---|
| Tajik, wrong answer (Opus 5) | 19s | 14.6s | 6.5s | 1.36s |
| Tajik, correct answer (Opus 5) | 19s | 14.5s | 8.7s | 1.30s |
| English A1 (Opus 5) | 16s | 12.8s | 4.2s | 1.34s |
| Tajik (Sonnet 5) | 16.4s | 15.8s | 10.4s | 1.51s |
| English (Sonnet 5) | 10.6s | 9.7s | 4.8s | 1.47s |

Findings that shaped the design:

- **Streaming is mandatory, not a preference.** 16-19s of spinner is a dead app; ~1.3s to first token is not.
- **~4-5s of every call was subprocess spin-up** (19s wall vs 14.6s API) — a quarter of the latency, and the reason grading goes through the SDK rather than spawning the CLI per Submission.
- **Every call carried 8-11k tokens of cached harness system prompt** for a task that needs zero tools, plus 204-364 thinking tokens.
- **Spawning the CLI without redirecting stdin costs a flat 3s stall** (`no stdin data received in 3s`).
- Quality on both Languages was high: all three planted English errors caught, and the Tajik agreement error caught with the full personal-ending paradigm and the `-ро` definiteness marker explained correctly.

### Agent SDK, step 1, 2026-08-20

24 calls on this Pi with the configuration in § Grading. Against the subprocess baseline: **Tajik/Opus 19s → 6.7s, English/Sonnet 10.6s → 4.4s.** Context per call fell from 8-11k harness tokens to **882-988 total**, cache reads included.

| case | wall | api | first text | context |
|---|---|---|---|---|
| English, three planted errors (Sonnet 5) | 7.56s | 6.74s | 2.64s | 894 |
| English, Progressive Hint attempt 2 (Sonnet 5) | 6.32s | 5.40s | 2.90s | 988 |
| English, correct answer (Sonnet 5) | 4.44s | 3.57s | 2.58s | 895 |
| Tajik, agreement error (Opus 5) | 6.68s | 5.81s | 3.35s | 882 |

Findings that shaped the design:

- **Stripping the harness prompt is worth 2-3× the wall time**, and all four settings in § Grading are required to do it.
- **Time to first streamed token got worse, not better** — 1.3-1.5s under the subprocess, 2.5-3.5s under the SDK. Streaming is still mandatory, but the gap it now covers is 4-7s rather than 16-19s.
- **Disabling thinking is not faster.** `adaptive` + `effort: 'low'` matched or beat it on every pair. Single sample per cell — directional, not conclusive.
- **Progressive Hints work from `priorSubmissions` alone**, with no session state, exactly as [ADR 0004](./adr/0004-stateless-grading-stateful-authoring.md) requires.
- **Quality held.** All three planted English errors caught with correct Error Types every run; the Tajik case matched [ADR 0002](./adr/0002-grader-model-per-language.md)'s ground truth.
- Later runs benefited from a **warm prompt cache**, so cold-start numbers will be slightly worse.

## Open risks

- The Tajik Error Type enum is unreviewed by a Tajik speaker.
- The Verdict is unstable at the `partially_correct`/`incorrect` boundary — not only between models but **run to run within one model**: five identical calls returned `partially_correct` ×3 and `incorrect` ×2, with an identical error list every time. Progression is unaffected, since neither Verdict advances the Student, but the label the Student reads is not reproducible. The Coherence Guard fixes incoherence, not this. See [ADR 0003](./adr/0003-verdict-authority-split.md).
- Rate-limit behaviour under real concurrent use is unmeasured — every call measured so far has been sequential.
- The Coherence Guard's code path is untested against real incoherence: it did not fire once in 24 calls.
