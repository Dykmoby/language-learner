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
- Two seeded accounts via CLI script, argon2id hashes, httpOnly session cookies. **No registration route exists** — nobody makes an account for themselves. `igor` holds the Admin role, and the CLI script is still the only thing that grants it.
- An Admin can make and remove further Student accounts from the Admin section. A new one is created with a generated **Temporary Password**, shown to the Admin exactly once and stored only as a hash; the account can reach nothing but the change-password screen until its owner replaces it. Changing a password ends every other session of that account. An Admin account cannot be deleted through the interface — the role is granted on the box, and nothing in the interface could grant it back.
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

Each Exercise stores accepted answers as **one list per Gap** — one entry for each place in the prompt the student answers, holding every value accepted there — plus an optional `caseSensitive` flag, needed for "put the word in the correct form" where capitalisation is the point. An Exercise with one place to answer is the special case: one position, several accepted values. Word order matches an exact sequence against one or more accepted orders.

A fill-gap's prompt says how many places there are: one per `___`, and an Exercise whose gap count disagrees with its number of accepted-answer lists is refused by the validity rules, because it cannot be rendered — an input would have nothing behind it, or a list nothing in front of it. Every other Kind has exactly one place to answer whatever its prompt contains.

Each Gap is judged on its own, and the Verdict says how many held: all of them `correct`, some of them `partially_correct` with the gaps that were not accepted marked as such, none of them `incorrect`. Three gaps are three facts being checked, and «неверно» without saying which of the three makes the next attempt a re-guess of all three. It costs nothing in progression — an attempt that is not `correct` already counts as a failed one.

A student's answer travels and is stored as one value per Gap. It is put back into the sentence **once**, where the Submission is written, and the row carries that sentence: every screen that shows an answer therefore shows one, rather than each of them remembering to reassemble it.

**No typo tolerance.** In a language-learning app, tolerating a misspelling teaches the misspelling.

## Grading

Sonnet 5 for English, Opus 5 for Tajik, configurable per Course — see [ADR 0002](./adr/0002-grader-model-per-language.md).

Every Grader call is stateless but context-rich. It receives:

- target Language and Course level
- Lesson title and grammar focus
- the Exercise prompt
- the Reference Answer and any Accepted Variants
- the Student's earlier Submissions on this Exercise

That last item is what produces Progressive Hints, and the attempt number is stated on every call — the first one included, where there is nothing earlier to count. The ladder: attempt 1 points at the mistake without naming it, attempt 2 names the kind of mistake without writing the correct form, attempt 3 and after show it.

**The corrected answer is withheld from the Student until the third failed attempt.** Two halves, and only one of them is a guarantee. `corrected` is returned by the Grader and written to the Submission on every attempt — an Admin resolving a Dispute needs it — and simply does not travel to the browser until `revealOffered` is true, which is the same event as «three tries and it did not come». That is the guarantee. The ladder above is the other half: an explanation's job is to teach, so nothing can stop a Grader writing the finished form into `feedback_ru`, which is exactly why the field whose whole job is to hold the answer is the one held back. A Test is unaffected — it has one attempt and gives no feedback until submitted, so a review that hid the correction would leave a Student with nothing to learn from.

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

**Core (both Languages):** `word_order`, `spelling`, `punctuation`, `capitalization`, `typography`, `vocabulary_choice`, `missing_word`, `extra_word`, `meaning_mismatch`, `register_style`

> `typography` is reported by the Grader and then dropped by the server: sentence-initial capitalisation, the terminal full stop and stray whitespace are not language, and the Deterministic Check has always ignored all three. It never reaches the Coherence Guard, a stored Submission, or a Student's histogram. `punctuation` and `capitalization` keep their meaning for the cases that are real — a missing comma; `london` written for `London` **inside** a sentence.
>
> The backstop that catches a Grader ignoring the instruction compares the answer with the correction, and cannot separate the two readings of a difference in the *first* letter: «i have a cat» and «london is the capital» both differ from their corrections by one leading capital and nothing else. It clears the Error in both, so a proper noun opening an otherwise perfect sentence loses its `capitalization` report. The prompt is what covers that case — a complying Grader files an opening capital under `typography` and a proper noun under `capitalization`.

**English:** `article`, `tense`, `irregular_verb`, `subject_verb_agreement`, `preposition`, `plural_form`, `countability`, `modal_verb`, `conditional`, `gerund_vs_infinitive`, `phrasal_verb`

**Tajik:** `verb_agreement`, `izofat`, `definiteness_ro`, `pronoun_enclitic`, `plural_form_tj`, `preposition_tj`, `compound_verb`, `tense_tj`

> The Tajik list is provisional and needs review by the person teaching it. It was proposed from a much thinner base than the English one. The sheet it is reviewed on is [docs/tajik-error-types-review.md](./tajik-error-types-review.md) — one type at a time, each with its Russian label and a worked example, and a place to name a category the list is missing.

### Failure behaviour

A failed or timed-out grading persists the Submission with `status: 'grading_failed'`, shows the Student a Russian retry message, and leaves the Exercise unlocked. **A failure must never be rendered as a wrong answer.**

**Busy is not broken.** Where the API pushed back — a 429, a 529, or the subscription's own window — the Student is told the Проверяющий is busy and asked to wait, rather than being told to try again immediately into the same wall. It is the same failure path in every other respect: the answer is stored, no Verdict is implied, the attempt does not count. The distinction reaches the browser as `busy` or `broken` rather than as the Grader's failure kind, because `timeout`/`contract`/`sdk` are facts about this application and none of them changes what the Student should do next.

A **Test** batch that fails this way behaves exactly as any other failed batch does — the answers stay stored and the attempt is re-gradable without re-entry — but its review keeps the one wording, because a batch's failure is read back from a persisted row and the classification is not stored on one. Worth revisiting if a busy API is ever met there in practice; it has not been.

This path is **load-bearing, not defensive**: step 1 measured roughly one contract failure in 24 calls (~4%) — an intermittent parse failure on the longest output.

Grading runs to completion server-side and persists regardless of whether the client is still listening. Even at the measured 4-7s per call, a closed tab must never lose a Submission.

## Progression

- `correct` advances.
- `partially_correct` keeps the Student on the Exercise with a sharper Progressive Hint.
- After 3 failures, Reveal is offered → state becomes Completed With Help, which counts as complete but renders as a distinct segment in the progress bar. The same third failure is where the corrected answer starts reaching the browser (§ Grading).
- Dispute unblocks progression immediately and queues for Admin review.
- Lessons unlock sequentially, with a per-Course Admin toggle for free navigation.

## Tests

Contain both Exercise Kinds. Deterministic ones are checked in code at submission; all Grader-judged answers are batched into a **single** Claude call — faster, cheaper, and more internally consistent than N separate calls.

That one call needs the contract to bind each judgement to the Exercise it is about by an id the response echoes, never by its position in a list: an off-by-one would tell a Student their correct answer was wrong and mark their wrong one correct, with no symptom anywhere. A response that omits an Exercise, invents one or repeats one is a contract failure and yields no judgements at all.

The batch runs in the **grading** lane — it is a Student's own foreground work, stateless like every other Grader call ([ADR 0004](./adr/0004-stateless-grading-stateful-authoring.md)) — but not on the grading clock: ten free-form answers judged at once is minutes, and the 90s that fits one Submission would time out exactly the calls this covers. `TEST_GRADING_TIMEOUT_MS`, five minutes by default. At a concurrency of 2 a long batch holds a grading slot; if that is ever measured leaving a Student waiting mid-Practice, the fix is a lane of its own rather than a shorter timeout.

A failed batch is never a set of wrong answers. The free-form answers stay stored and unjudged, the attempt is not scored as though they were wrong — an unfinished judgement is not a zero — and the Student can ask for the same answers to be judged again without re-entering one. Everything judged in code stays judged either way.

A Test starts unpublished and is absent from a Student's Course until an Admin publishes it, the same rule a Lesson follows and for the same reason. It has no Draft behind it: there is no Theory to write and no conversation to hold over it, so its Exercises are edited in place and an edit to a published Test is live when it is saved — affordable here in a way it would not be for a Lesson, since a Test gates nothing and the worst an edit costs is one wasted attempt. Its answers are Submissions grouped by an Attempt — see [ADR 0005](./adr/0005-test-answers-are-submissions.md).

Score is percentage correct against a per-Test threshold, default 80%. Retakes are unlimited and every attempt is logged. Failing a Test gates nothing — Lessons already handle progression, and a Test is a mirror, not a gate.

Review screen shows every Exercise with correct ones collapsed. Grader-judged Exercises highlight the whole Exercise red plus feedback and Reference Answer; Deterministic ones mark the chosen wrong option red and the correct option green, and a fill-gap's answer is shown as its sentence with each Gap marked.

## Disputes

The Admin review screen shows the Exercise, Reference Answer, Student's answer, the correction the Grader wrote, the Grader's Errors, and the Student's comment. One click promotes the answer to an Accepted Variant, which then flows into future Grader context as teacher-confirmed.

**An upheld Dispute confirms one answer, at one place.** A fill-gap is answered in as many places as its prompt has Gaps, and an objection is about one word: a Student who says their word in the second Gap is also correct has said nothing about the two they got wrong. So the review asks which Gap the confirmed answer is for, the variant is stored with that position, and the Deterministic Check consults it there and nowhere else — a word accepted at the second Gap must never start marking that word correct in the first, which would be the Exercise teaching the mistake. A variant carrying no position joins every Gap: that is every Kind with one place to answer, and every variant written before the position existed. The Reference Answer is never rewritten either way — it is what the author wrote, and an Accepted Variant is what a Dispute confirmed.

This is the only closed feedback loop in the system: the Grader measurably improves through use, without prompt engineering.

Beside the queue, **how often the Coherence Guard fired**: the number of Submissions whose guarded Verdict differs from the proposed one, and which way the guard moved it. A guard firing and an upheld Dispute are the two ways this system records that the Grader was wrong — one caught by a rule, one caught by a person — so they are read in one place. It is a read of the two columns [ADR 0003](./adr/0003-verdict-authority-split.md) already requires, over Grader-judged Submissions only: a Deterministic Check writes both columns from one comparison and can never disagree with itself.

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

The visual direction is open. It was settled once, early, as a choice between a typographic identity and a card-and-panel one, and the typographic side was taken; that decision no longer holds, and nothing below should be read as committing to it. What does hold is the layer underneath: one token layer, one contrast floor, one state system, and every screen naming those rather than painting its own. A change of look is a change of tokens and of the arrangements in `globals.css`, not a rewrite of the application.

What the interface still owes the subject is the pairing of scripts — every screen sets Russian chrome around English or Tajik content — and a state system that holds in both themes. No gamification of the retention kind: streak mechanics are built to keep strangers coming back, and the people using this are not strangers. That is a separate question from whether the surface is playful, which is open too.

**One section, one frame.** A screen is a stack of sections and each is drawn as one panel, so where a section ends is something a reader sees rather than infers from the weight of a heading. Before this the Admin's screens ran every heading and its contents together down one column: the roster and the form that adds to it were one surface with two headings in it. `.sections` owns the air between the frames rather than any panel owning a margin, because a panel is also a flex item in the two side-by-side layouts and a margin would have to be taken back off it in both.

**Built in step 9.** A token layer (`src/app/tokens.css`) holds the palette, the type scale and the spacing scale; `globals.css` holds consequences and writes no colour and no type size of its own, which is the part a test enforces. One-off geometry stays where it is used — a shared token for the width of one field would be a lie about how many places need it. The contrast floor is enforced rather than intended: a pure test resolves every `var()` chain and `color-mix()` wash the way a browser would and computes WCAG contrast for each pairing in both themes, at 4.5:1 for text and 3:1 for a control edge or a chart line.

The typeface is **IBM Plex Sans and Mono**, self-hosted and subset to Latin, Cyrillic and Cyrillic Extended — the third of those is load-bearing, because Tajik's ғ ӣ қ ӯ ҳ ҷ live outside the basic Cyrillic block. It is here as a constraint rather than as a style: whatever face replaces it has to be drawn for both scripts and carry that block, which is a much shorter list than it sounds. Self-hosting is the same decision § Platform makes twice over: a font fetched at build or run time is a network dependency in the one place this project has already been bitten. The test reads the character map out of each woff2 rather than trusting its name.


The **tab icon** is a Я, drawn as a path in `src/app/icon.svg` rather than set in a face. It is named in the middleware's matcher beside the typeface and for the same reason: a browser asks for a tab icon on its own schedule, usually before any session exists and never as a navigation, so a gated one is answered with the sign-in page as `text/html` — not an image, so the tab stays blank, and stays blank after signing in because the browser caches that answer. A favicon is fetched on its own, with no stylesheet and no font behind it, so it is the one file in this project that writes its hexes out instead of naming a token — they are the light theme's `--accent` and `--accent-on`, copied. The letter is the choice it looks like: every screen here sets Russian chrome around English or Tajik content, and the Cyrillic is the half that belongs to the reader rather than to the subject.

The six **Verdict states** — correct, partially correct, incorrect, Completed With Help, Disputed, grading failed — are one system consumed by the Practice, the Test review, the progress bar and the Disputes screens, rather than four screens each inventing their own. Each is told apart three ways over: by hue, by the shape of its rail, and by its Russian wording, any one of which is enough on its own. A grading failure and a Dispute borrow the hue of neither correct nor incorrect.

The **progress bar is the one place the rail is dropped**, and it is dropped rather than shrunk. A rail is a pattern — a hatch, a dotted run, a bar broken at a beat — and a pattern needs a few millimetres of run before it is one. On a Lesson of two dozen Exercises a segment is a few pixels wide, and at that size all six read as the same thing: a segment that has been dimmed or half drawn. So a segment carries its state's hue and its state's wording, which are the two distinctions that survive being four pixels wide, and every screen with room for a rail still draws one. Beside it there is now a second picture of the same three facts — a **meter**, one track filled left to right by proportion: unaided, then with help, then under objection. The bar says *where* a Student is and belongs in the Practice; the meter says *how much* and belongs in a Course listing, where nobody is asking about Exercise 14 of a Lesson they have not opened.

**`--accent-on` is what is legible on the accent, and every control asks it.** In the light theme it is white and in the dark one it is near-black, because the dark palette puts the accent at the *light* end — so a button whose label is hardcoded white is right by coincidence in one theme and wrong in the other. Mantine writes exactly that hardcoding into its own Button rule, out of reach of the `:root` variable mapping, which is why `theme.ts` sets `--button-color` per component instead: a filled Button and the hand-built `a.button` beside it have to be the same control. The navigation column takes the matching rule for tints — a hover over something already painted with the accent wash is painted with `--accent-quiet-strong`, one step of the same hue, never with the neutral grey used out on the column's own white.

**A card that can be opened is opened by the whole card.** A row whose only target is its title has an invisible target in it: the number, the standing and the bar are what a person aims at when they mean "this Lesson". For the same reason an action is a control and never a run of underlined text — the way to the progress screen, the way back to a Course, the way into a queued Dispute. A link that navigates within a sentence stays a link; a link that *does* something is drawn as the thing it does.

**Long lists on the progress screen fold.** Both the Lessons and the Test attempts are `<details>`, open where the list is short enough to read at a glance and closed above that, with the count in the summary so a folded list never hides the fact that there is anything in it. A Course of a hundred Lessons otherwise puts a hundred bars between the header and the statistics the screen exists for. And the two ends of the charted span are chosen in a panel rather than a drop-down: a Lesson can be found there by its number, by its name, or by the days it was worked, which are the three ways a person actually remembers one.

The **header** wraps every signed-in screen from the root layout and carries the application name, the open Course, the Admin link where the role is held, and sign-out. `/` is a signpost rather than a screen — into the Current Course where there is one, to `/courses` where there is not — which is what makes a way back that does not lead where it was clicked.

## Operations

- WAL mode, nightly `.backup` to `~/backups`, 14-day retention. **Built in step 8**: `src/ops/backup.ts` under a systemd timer, with the restore procedure in [`deploy/README.md`](../deploy/README.md).
- **The upload folder is state too.** Theory images live outside the build output
  (`UPLOAD_DIR`, `data/uploads` by default) and are served through a Next route,
  so they survive a rebuild — but a database backup that does not include them
  restores Lessons whose images are gone. Step 8's backup has to cover both.
- Weekly copy pulled off the Pi manually onto another device.
- Per-Course JSON export as the human-readable, restore-anywhere format.
- Periodic health check: a lightweight grading call against a fixed known input. On failure the Admin dashboard shows a red banner — otherwise the first person to discover expired credentials is a student mid-Lesson. **Built in step 8**: every run is recorded, the dashboard reads the latest without running one, and a result too old to be evidence is red as *stale* rather than green. A rate-limited run names itself as one rather than as a credentials problem. The banner stays red — grading really is not working while the API is saying no — but the line explaining why is muted rather than red, because a busy API is not a fault of this box and is not something to go and fix.

## Build order

1. **Grading spike, no UI** — **done 2026-08-20, GO.** SDK harness with `systemPrompt` overridden, tools off, streaming, JSON parse, enum validation, Coherence Guard, measured against the baseline below. This was the go/no-go; everything else is ordinary web work. Results in § Agent SDK, step 1.
2. **Skeleton and deploy path** — **done 2026-08-20.** Next.js, schema, auth, seed script, systemd, Caddy, DuckDNS. The `HOME`/credentials path is proven: the deployed service returns a healthy check in 4.8s at 861 context tokens, inside the spike's measured band. The failure it actually surfaced was the proxy, not `HOME` — see § Platform.
3. **Student vertical slice** — **done 2026-08-20.** One seeded Lesson → Practice → streamed grading → progression. Content is a checked-in fixture (`src/content/english-a1.ts`) seeded by its own script; the Deterministic Check, the incremental `feedback_ru` extractor and the progress derivation are pure and tested exhaustively; the Grader's failure path is tested at the HTTP seam by booting an application that cannot grade. The live-model happy path stays a manual check on the Pi, for the same reason step 2's healthy check did.
4. **Authoring** — **done 2026-08-21.** Forms per Exercise Kind, markdown Theory with image upload, and content that comes into being through the screens rather than only through the seed script: a Course, a Lesson, an Enrollment, and the order of the Lessons in a Course. A Lesson created here starts unpublished and is absent from a Student's Course until someone publishes it — an empty published Lesson would sit in the middle of sequential unlocking. Draft history is a surface over the append-only rows step 4's first half already wrote; restoring appends rather than truncates, and never publishes.
5. **Generation and Refinement** — **done 2026-08-21.** One SDK harness behind both the Grader and the author, with its own concurrency lane so a Generation can never occupy a grading slot. The Author's contract is pure and tested without a model — the prompt an Admin's inputs become, the parse back into a Lesson document, the existing validity rules applied to Claude's Exercises, and the Kind mix measured against what was asked for. Generation and Refinement stream on the wire the Practice already uses, carrying the Theory instead of a Verdict. A generated Draft is marked as such wherever Drafts are shown, and publishing one asks first — naming how many Reference Answers nobody has read since Claude wrote them. The live-model happy path stays a manual check on the Pi, for the reason steps 2 and 3 left theirs there.
6. **Tests** — **done 2026-08-22.** A Test authored through the same per-Kind forms a Lesson's Practice uses, published the way a Lesson is, and sat in one screen that judges nothing until it is submitted. The Deterministic half is settled in code at submission and the Grader-judged half goes out in one call, with its own timeout and a contract that binds each judgement to the Exercise it names. The score is a percentage against the Test's threshold, every attempt is kept, and nothing about any of it touches Lesson unlocking. The review shows every Exercise with the correct ones collapsed, marks a wrong option beside the right one, and shows a failed batch as a failure rather than as a wrong answer. The live-model happy path stays a manual check on the Pi, for the reason steps 2, 3 and 5 left theirs there.
7. **Progress, charts, Disputes** — **done 2026-08-22.** The one closed feedback loop in this system, and the screens that say whether it is working.

   A Dispute unblocks progression the moment it is made: an Exercise that holds a Student until somebody wakes up and looks at it is an Exercise that ends the study session. It reads as *disputed* rather than as passed or failed, because it is neither and rendering it as either would claim something nobody has decided. And it is a fact **about** a judgement rather than an edit to one — nothing here writes to `submissions`, so the two Verdicts [ADR 0003](./adr/0003-verdict-authority-split.md) stores stay intact and the progress derivation takes the objections as a second input rather than reading a status off a row.

   Upholding promotes the Student's answer to an Accepted Variant, and every Grader call already carries those as teacher-confirmed context — so the Grader gets better at that Exercise the moment the button is pressed, with nobody touching a prompt. It reaches a Practice's single call and a Test's batch alike. It also reached a gap: CONTEXT.md says a Deterministic Check compares against Reference Answers *and* Accepted Variants, and it did not, which would have left the loop open for half the Exercise Kinds.

   Then three views over the same rows, each showing more than the last, so who may look at whose is answered once in one module rather than three times: a Student sees their own record, an Admin sees any Student's, and everything else is a 404. Per-Lesson completion with Completed With Help as its own segment, an Error Type histogram scoped to the Course — the two enums share Russian words for different grammar, so only the stable enum value is ever grouped on — and change over a span of Lessons the browser can re-choose without a round trip.
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

### Verdict stability at the boundary, 2026-08-24

40 calls from this Pi — four cases, both Grader models, five identical calls each — through `src/ops/verdict-stability.ts`, which is repeatable and takes `--runs N`. Both models grade every case, deliberately crossing [ADR 0002](./adr/0002-grader-model-per-language.md)'s per-Language assignment: the question is how stable one model is on one input, and answering it per Language would rest each half on one model's temperament.

| case | model | proposed | guarded | guard fired | error list |
|---|---|---|---|---|---|
| two faults, still communicates | sonnet-5 | partially_correct ×3 | partially_correct ×3 | 0 | 2 different lists |
| two faults, still communicates | opus-5 | partially_correct ×5 | partially_correct ×5 | 0 | identical |
| three faults, meaning intact | sonnet-5 | incorrect ×3, partially_correct ×2 | same | 0 | 2 different lists |
| three faults, meaning intact | opus-5 | **incorrect ×3, partially_correct ×2** | same | 0 | **identical** |
| control: the Reference Answer | sonnet-5 | correct ×5 | correct ×5 | 0 | identical (none) |
| control: the Reference Answer | opus-5 | correct ×5 | correct ×5 | 0 | identical (none) |
| control: does not attempt the task | sonnet-5 | incorrect ×5 | incorrect ×5 | 0 | identical |
| control: does not attempt the task | opus-5 | incorrect ×5 | incorrect ×5 | 0 | identical |

- **The anecdote reproduces, on a different model and a different case.** Opus 5 on the three-fault case returned `incorrect` ×3 and `partially_correct` ×2 **with a byte-identical error list every run** — `article:to shop`, `irregular_verb:buyed`, `tense:go`. The reasoning is reproducible; the label on top of it is not.
- **It is a boundary phenomenon, not a general one.** Both controls returned the same Verdict five times out of five on both models, with identical error lists. A correct answer and an answer that does not attempt the task are never in doubt.
- **The two models are unstable in different ways.** Opus held its error list and moved the label; Sonnet moved both — it found two different sets of faults for the same answer on the same case, which is a different problem with a different fix.
- **The Coherence Guard fired zero times in 40 calls**, on top of zero in the 24 of step 1. It is not what is moving the label, and it never was: every run was coherent.
- **Contract failures held at the measured rate.** 2 of 40 calls (5%) failed to parse, both on the same Sonnet case, against ~1 in 24 (4%) in step 1. § Failure behaviour's path is load-bearing, as it says.
- Wall times 3.8-8.0s, with one 18.6s outlier on Sonnet. The band is the step-1 band; the outlier is one call in forty.
- 40 calls cost $0.30.

### Both lanes under load, 2026-08-24

Six grading calls and one authoring call launched in the same instant, through `src/ops/concurrency-probe.ts`. The first real concurrent measurement this project has: every number before it was sequential.

| lane | calls | ok | queued behind the limit | the call itself |
|---|---|---|---|---|
| grading (limit 2) | 6 | 6 | 4ms, 101ms, 5.6s, 6.3s, 10.8s, 11.6s | 4.9-6.3s |
| authoring (limit 1) | 1 | 1 | 100ms | 5.2s |

- **The API pushed back on nothing.** No 429, no 529, no subscription rejection, and no SDK retry — at a burst this box can produce, the limit is never reached. What *was* reached, an hour earlier and by accident: the plan's own session window, which stopped a call outright. That is the limit this application meets first, and it does not arrive with a status code — see § Failure behaviour.
- **The lanes are separate under load, measured rather than argued.** The authoring call took its permit in 100ms while four grading calls sat queued behind a full grading lane. An Admin's Generation cannot be starved by Students, and Students cannot be starved by a Generation.
- **The queue is the wait, not the API.** Concurrency cost the calls themselves nothing — 4.9-6.3s each, inside the step-1 band — but the sixth Student in the queue waited 11.6s before their call started, and 17s in total. At `GRADER_CONCURRENCY=2` that is the shape of a busy afternoon: not failures, but a queue. Worth raising the limit only against a measurement that shows the API tolerating it.
- Sonnet wrapped its JSON in markdown fences on 6 of 6 calls, as step 1 found. The parser tolerates it, and logs it.

## Open risks

- The Tajik Error Type enum is unreviewed by a Tajik speaker. The review sheet exists — [docs/tajik-error-types-review.md](./tajik-error-types-review.md) — and what remains is a person answering it; applying the answers is issue #58.
- **The Verdict is unstable at the `partially_correct`/`incorrect` boundary, and now measured rather than anecdotal.** § Verdict stability at the boundary: Opus 5 returned `incorrect` ×3 and `partially_correct` ×2 on five identical calls with a byte-identical error list every run, and Sonnet 5 split the same case the same way. Both controls were stable five out of five. So the substance is reproducible and the label is not — and it is confined to the boundary.

  **Is it worth acting on?** The honest answer is that it costs less than it looks like it costs. Progression is untouched: neither Verdict advances the Student ([§ Progression](#progression)), the Exercise stays current either way, and the Errors and the corrected sentence — which is what a Student actually learns from — are the stable part. What moves is one Russian word, between two answers that both mean "not yet". A Student who resubmits the same answer can read a different word, and nothing in the interface promises they will not.

  The options, none of them chosen here:

  1. **Leave it, and say so.** The label is a summary of the Errors; the Errors are reproducible.
  2. **Derive the label rather than trust it** — extend the Coherence Guard from "no Errors forces correct" to a rule over the Error count, making the label a function of the stable part. This buys reproducibility with the model's judgement about severity, which is exactly what the guard has so far refused to overrule.
  3. **Stop drawing the distinction for the Student** — one non-correct state, with the Errors carrying the detail. The narrowest change to what a person reads, and the largest to what the interface is.

  Measure before choosing: five runs per cell is directional, and case selection was ours.
- **Rate-limit behaviour is measured at the load this box can produce, which turned out not to be enough to reach the limit.** § Both lanes under load: six grading calls and an authoring call at once drew no 429, no 529 and no SDK retry. The limit this application actually meets first is the subscription's own session window, observed on 2026-08-24 — and it arrives with no status code in it, as *"You've hit your session limit"*. That case is now classified as itself: a rate limit is not a credentials failure, the Admin is not sent to check `~/.claude`, and a Student is told the Проверяющий is busy rather than that something is broken. What remains unmeasured is behaviour at a load this Pi cannot generate.
- **The Coherence Guard still has not been seen firing on real output** — zero in the 24 calls of step 1, zero in the 40 of § Verdict stability. What has changed is that a firing would now be seen: the Disputes screen reports how many Submissions carry a guarded Verdict differing from the proposed one and which way it moved, read off the two columns [ADR 0003](./adr/0003-verdict-authority-split.md) already requires. The open question is no longer "would anybody notice" but "has it happened yet", and that is a number that accrues.
