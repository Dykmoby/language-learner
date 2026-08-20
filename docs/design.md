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

Ports 4000, 8001-8006 and 1001-1006 are already taken on this box by other projects. Redis is running on 6379 but is deliberately unused here.

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

Configuration: `systemPrompt` overridden to strip Claude Code's own ~8-11k-token harness prompt, tools disabled, thinking off, 90s hard timeout. In-process semaphore at concurrency 2 with a FIFO queue behind it. See [ADR 0004](./adr/0004-stateless-grading-stateful-authoring.md).

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

### Error Type enum

Stable in storage, Russian labels rendered at display time.

**Core (both Languages):** `word_order`, `spelling`, `punctuation`, `capitalization`, `vocabulary_choice`, `missing_word`, `extra_word`, `meaning_mismatch`, `register_style`

**English:** `article`, `tense`, `irregular_verb`, `subject_verb_agreement`, `preposition`, `plural_form`, `countability`, `modal_verb`, `conditional`, `gerund_vs_infinitive`, `phrasal_verb`

**Tajik:** `verb_agreement`, `izofat`, `definiteness_ro`, `pronoun_enclitic`, `plural_form_tj`, `preposition_tj`, `compound_verb`, `tense_tj`

> The Tajik list is provisional and needs review by the person teaching it. It was proposed from a much thinner base than the English one.

### Failure behaviour

A failed or timed-out grading persists the Submission with `status: 'grading_failed'`, shows the Student a Russian retry message, and leaves the Exercise unlocked. **A failure must never be rendered as a wrong answer.**

Grading runs to completion server-side and persists regardless of whether the client is still listening. At ~15s per call, students will close tabs.

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

1. **Grading spike, no UI.** SDK harness with `systemPrompt` overridden, tools off, thinking off, streaming, JSON parse, enum validation, Coherence Guard. Measure against the baseline below. **This is the go/no-go** — everything else is ordinary web work.
2. **Skeleton and deploy path.** Next.js, schema, auth, seed script, systemd, Caddy, DuckDNS. Prove the `HOME`/credentials path here, not in week four.
3. **Student vertical slice.** One hardcoded Lesson → Practice → streamed grading → progression.
4. **Authoring** — forms, markdown, images.
5. **Generation and Refinement.**
6. **Tests** — batch grading and review screen.
7. **Progress, charts, Disputes.**
8. **Operations** — backup cron, health check, export.

## Measured baseline

Three single-shot `claude -p` calls, 2026-08-20, from this Pi. Numbers include Claude Code's full harness system prompt, which the SDK path will strip.

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

## Open risks

- The Tajik Error Type enum is unreviewed by a Tajik speaker.
- The Verdict remains model-dependent at the `partially_correct`/`incorrect` boundary. The Coherence Guard fixes incoherence, not disagreement.
- Rate-limit behaviour under real concurrent use is unmeasured — the baseline above is sequential single calls.
- The latency saved by stripping the harness system prompt is unproven until step 1.
