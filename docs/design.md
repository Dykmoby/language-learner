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

Stripping the trailing punctuation uncovers any space that sat before it, so that step trims its own tail — otherwise `I have a cat .` fails against `I have a cat`, which marks typography rather than language.

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

That one call needs the contract to bind each judgement to the Exercise it is about by an id the response echoes, never by its position in a list: an off-by-one would tell a Student their correct answer was wrong and mark their wrong one correct, with no symptom anywhere. A response that omits an Exercise, invents one or repeats one is a contract failure and yields no judgements at all.

The batch runs in the **grading** lane — it is a Student's own foreground work, stateless like every other Grader call ([ADR 0004](./adr/0004-stateless-grading-stateful-authoring.md)) — but not on the grading clock: ten free-form answers judged at once is minutes, and the 90s that fits one Submission would time out exactly the calls this covers. `TEST_GRADING_TIMEOUT_MS`, five minutes by default. At a concurrency of 2 a long batch holds a grading slot; if that is ever measured leaving a Student waiting mid-Practice, the fix is a lane of its own rather than a shorter timeout.

A failed batch is never a set of wrong answers. The free-form answers stay stored and unjudged, the attempt is not scored as though they were wrong — an unfinished judgement is not a zero — and the Student can ask for the same answers to be judged again without re-entering one. Everything judged in code stays judged either way.

A Test starts unpublished and is absent from a Student's Course until an Admin publishes it, the same rule a Lesson follows and for the same reason. It has no Draft behind it: there is no Theory to write and no conversation to hold over it, so its Exercises are edited in place and an edit to a published Test is live when it is saved — affordable here in a way it would not be for a Lesson, since a Test gates nothing and the worst an edit costs is one wasted attempt. Its answers are Submissions grouped by an Attempt — see [ADR 0005](./adr/0005-test-answers-are-submissions.md).

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

**Generated Drafts never publish unreviewed.** A hallucinated Reference Answer would silently poison grading for that Exercise. Structurally this is the deliberate Publish, which nothing bypasses; behind it, a Draft whose origin is `generation` or `refinement` is marked wherever Drafts are shown, and publishing one names how many of its Exercises still carry a Reference Answer exactly as Claude wrote it. The count is what makes the question answerable — and it falls silent for an Admin who has been through every Exercise, because a confirmation that always appears is one nobody reads.

The validity rules cannot help with the thing that actually goes wrong here: a Reference Answer that is fluent, plausible and wrong passes every rule there is. What they do catch is incoherence, and they catch it in Claude's output exactly as they catch it in an Admin's — same rules, same stable codes, same Russian.

**Authoring has its own concurrency lane, and its own timeout.** § Grading puts grading at 2 with a FIFO queue behind it, sized for calls measured at 4-7s. A Generation at `max` Effort on Opus 5 is minutes. Sharing the limit would leave a Student in front of a spinner waiting on an Admin's Lesson, with no way of knowing that is what they are waiting for; sharing the 90s timeout would time out the very calls the lane exists for. Both are configurable (`AUTHORING_CONCURRENCY`, `AUTHORING_TIMEOUT_MS`).

Authoring offers the same two models grading does. Haiku is absent for the same reason ADR 0002 gives: a Theory is read by a Student as fact, and a model that explains grammar confidently and wrongly is worse than none.

Per-Course JSON import/export exists so content is portable off the Pi.

## Interface

Russian strings live in a single central `ru.ts` dictionary — no i18n library, but adding a second interface language stays a translation job rather than a rewrite.

Restrained visual identity. Typography carries more weight here than in most apps because every screen sets Cyrillic beside Latin, and the error-highlight states need a colour system that holds in both light and dark themes. No gamification — streak mechanics are built to retain strangers.

**Built in step 9.** A token layer (`src/app/tokens.css`) holds the palette, the type scale and the spacing scale; `globals.css` holds consequences and writes no colour and no type size of its own, which is the part a test enforces. One-off geometry stays where it is used — a shared token for the width of one field would be a lie about how many places need it. The contrast floor is enforced rather than intended: a pure test resolves every `var()` chain and `color-mix()` wash the way a browser would and computes WCAG contrast for each pairing in both themes, at 4.5:1 for text and 3:1 for a control edge or a chart line.

The typeface is **IBM Plex Sans and Mono**, self-hosted and subset to Latin, Cyrillic and Cyrillic Extended — the third of those is load-bearing, because Tajik's ғ ӣ қ ӯ ҳ ҷ live outside the basic Cyrillic block. Self-hosting is the same decision § Platform makes twice over: a font fetched at build or run time is a network dependency in the one place this project has already been bitten. The test reads the character map out of each woff2 rather than trusting its name.

The six **Verdict states** — correct, partially correct, incorrect, Completed With Help, Disputed, grading failed — are one system consumed by the Practice, the Test review, the progress bar and the Disputes screens, rather than four screens each inventing their own. Each is told apart three ways over: by hue, by the shape of its rail, and by its Russian wording, any one of which is enough on its own. A grading failure and a Dispute borrow the hue of neither correct nor incorrect.

The **header** wraps every signed-in screen from the root layout and carries the application name, the open Course, the Admin link where the role is held, and sign-out. `/` is a signpost rather than a screen — into the Current Course where there is one, to `/courses` where there is not — which is what makes a way back that does not lead where it was clicked.

## Operations

- WAL mode, nightly `.backup` to `~/backups`, 14-day retention. **Built in step 8**: `src/ops/backup.ts` under a systemd timer, with the restore procedure in [`deploy/README.md`](../deploy/README.md).
- **The upload folder is state too.** Theory images live outside the build output
  (`UPLOAD_DIR`, `data/uploads` by default) and are served through a Next route,
  so they survive a rebuild — but a database backup that does not include them
  restores Lessons whose images are gone. Step 8's backup has to cover both.
- Weekly copy pulled off the Pi manually onto another device.
- Per-Course JSON export as the human-readable, restore-anywhere format.
- Periodic health check: a lightweight grading call against a fixed known input. On failure the Admin dashboard shows a red banner — otherwise the first person to discover expired credentials is a student mid-Lesson. **Built in step 8**: every run is recorded, the dashboard reads the latest without running one, and a result too old to be evidence is red as *stale* rather than green.

## Build order

1. **Grading spike, no UI** — **done 2026-08-20, GO.** SDK harness with `systemPrompt` overridden, tools off, streaming, JSON parse, enum validation, Coherence Guard, measured against the baseline below. This was the go/no-go; everything else is ordinary web work. Results in § Agent SDK, step 1.
2. **Skeleton and deploy path** — **done 2026-08-20.** Next.js, schema, auth, seed script, systemd, Caddy, DuckDNS. The `HOME`/credentials path is proven: the deployed service returns a healthy check in 4.8s at 861 context tokens, inside the spike's measured band. The failure it actually surfaced was the proxy, not `HOME` — see § Platform.
3. **Student vertical slice** — **done 2026-08-20.** One seeded Lesson → Practice → streamed grading → progression. Content is a checked-in fixture (`src/content/english-a1.ts`) seeded by its own script; the Deterministic Check, the incremental `feedback_ru` extractor and the progress derivation are pure and tested exhaustively; the Grader's failure path is tested at the HTTP seam by booting an application that cannot grade. The live-model happy path stays a manual check on the Pi, for the same reason step 2's healthy check did.
4. **Authoring** — **done 2026-08-21.** Forms per Exercise Kind, markdown Theory with image upload, and content that comes into being through the screens rather than only through the seed script: a Course, a Lesson, an Enrollment, and the order of the Lessons in a Course. A Lesson created here starts unpublished and is absent from a Student's Course until someone publishes it — an empty published Lesson would sit in the middle of sequential unlocking. Draft history is a surface over the append-only rows step 4's first half already wrote; restoring appends rather than truncates, and never publishes.
5. **Generation and Refinement** — **done 2026-08-21.** One SDK harness behind both the Grader and the author, with its own concurrency lane so a Generation can never occupy a grading slot. The Author's contract is pure and tested without a model — the prompt an Admin's inputs become, the parse back into a Lesson document, the existing validity rules applied to Claude's Exercises, and the Kind mix measured against what was asked for. Generation and Refinement stream on the wire the Practice already uses, carrying the Theory instead of a Verdict. A generated Draft is marked as such wherever Drafts are shown, and publishing one asks first — naming how many Reference Answers nobody has read since Claude wrote them. The live-model happy path stays a manual check on the Pi, for the reason steps 2 and 3 left theirs there.
6. **Tests** — **done 2026-08-22.** A Test authored through the same per-Kind forms a Lesson's Practice uses, published the way a Lesson is, and sat in one screen that judges nothing until it is submitted. The Deterministic half is settled in code at submission and the Grader-judged half goes out in one call, with its own timeout and a contract that binds each judgement to the Exercise it names. The score is a percentage against the Test's threshold, every attempt is kept, and nothing about any of it touches Lesson unlocking. The review shows every Exercise with the correct ones collapsed, marks a wrong option beside the right one, and shows a failed batch as a failure rather than as a wrong answer. The live-model happy path stays a manual check on the Pi, for the reason steps 2, 3 and 5 left theirs there.
7. **Progress, charts, Disputes.**
8. **Operations** — **done 2026-08-23.** The three things that were only ever going to be written down until something wrote them down: a nightly backup, a health check that runs unattended, and a Course that can leave the box.

   The backup is one dated set holding **both** halves of the state — an online `.backup()` of the database and a copy of `UPLOAD_DIR` — written into `<name>.partial` and renamed only once it is whole, so nothing half-written can be mistaken for a good set at three in the morning. The online backup is not fussiness: the drill against the live database found a 116 KB `.db` beside a 197 KB un-checkpointed WAL, and a `cp` of the `.db` alone would have restored a database missing every session and Submission since the last checkpoint — *cleanly*, which is worse. Retention prunes sets older than 14 days by their own names and touches nothing it does not recognise, because the destination is a directory in somebody's home. The restore has been performed rather than described: a real set, restored into a scratch location, opens with `integrity_check` ok, no foreign-key violations, and both accounts readable.

   The health check now has a memory. Every run — the Admin's button and the timer alike — writes a row, and the Admin dashboard reads the latest one instead of spending a paid Grader call to render a page. Four states rather than two, because two of them are not about the Grader: **never run** is not a failure and is not dressed as one, and **stale** is red for its own reason — a check that passed a week ago is not evidence that grading works this afternoon, so age is checked before outcome. The timer runs the check through the same environment file the service reads, which is the whole point: [ADR 0001](./adr/0001-claude-agent-sdk-as-grading-engine.md)'s credentials path works only in the shape it ships, and a check in some other environment would prove the wrong thing green. Measured on the Pi in that shape: healthy in 4.9s at 861 context tokens, inside the step-1 band. A failing run leaves the unit **successful** on purpose — the run recorded what it found, and a Grader outage is not a fault for systemd to retry against a paid API.

   The Course export is the human-readable half of § Operations: one versioned JSON file carrying the Course, its published Lessons in order, its published Tests with their thresholds, and the Accepted Variants those Exercises earned — assembled out of the `LessonDocument` and `TestDocument` values the authoring screens already validate, so the import hands them straight back to `documentFaults` and `testPublishFaults`. It carries no Submissions, Students, Enrollments or Drafts: progress belongs to the person who made it, and a Draft's SDK session id is meaningless on another box. Theory images travel inlined as base64 in their own section at the end, so one file restores anywhere and the Lessons stay readable in a text editor. An import **always creates a new Course** — a merge would have to guess which Exercise in the file is which row here, and guessing wrong orphans Submissions — and an incoherent file is refused **before anything is written**, in the same Russian the authoring screens use. No name from the file ever becomes part of a path: every image is stored under a name this application generates, sniffed and capped exactly as an upload is, and the Theory is rewritten to point at it.

9. **The Interface** — **done 2026-08-24.** The identity § Interface had been deferring since step 2, and two live defects that had been hiding inside the absence of one.

   The defects first, because they were not aesthetic. **A Student could not sign out**: the control existed on the home screen alone, and the home screen redirects a Student who has a Current Course straight into that Course — so the one screen carrying the button was the one screen an enrolled Student was never allowed to stay on. And **the back-link from a Course led back to the Course**, through a home screen that redirected into the Current Course that working in a Course had just set. Both are fixed by the header, and an HTTP test now follows every link on a signed-in screen and refuses one that resolves to its own origin.

   The rest is a design that can be checked. Colour is a token layer with a measured contrast floor; type is one self-hosted superfamily whose Cyrillic was drawn beside its Latin, with the Tajik letters proved present by reading the font's own character map; the six Verdict states are one system told apart by hue, rail shape and wording, where two of them previously had no visual treatment at all and `grading_failed` was drawn in the same red as a wrong answer — on a path step 1 measured at one call in twenty-four. The health banner had the same fault at the other end of the application: four names, two appearances.

   Two rules are guarded rather than remembered: no screen writes a colour of its own or an inline font size, and no gamification — checked as vocabulary, because a badge arrives named before it arrives drawn.

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
