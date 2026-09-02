# An editable grading guidance inside a fixed prompt skeleton

The Grader's system prompt is built from a skeleton in code with exactly one block read from the database: the **grading guidance**, editable by an Admin from the Admin screens, applying to every Course.

Everything else in that prompt stays in code and is not reachable from the web interface.

## Where the line is

**Editable.** How the Grader judges: how strict to be, what to let pass, what tone to take with a Student. It is the part of the prompt most likely to want tuning and the least dangerous to touch — a bad edit produces worse feedback, and the next edit fixes it.

**Fixed, in code.** The JSON contract and its exact field order; the Error Type list; the `span` rule; and the block that fences a Student's answer as data.

Those four are load-bearing in a way the guidance is not. The parser stands on the contract and the field order — `feedback_ru` is emitted first so the streamed explanation reaches the Student before the Verdict resolves, and a parse failure is not a worse Verdict but no Verdict at all. The Error Type list is what [ADR 0003](./0003-verdict-authority-split.md)'s Coherence Guard and the whole of the progress reporting aggregate over. The fencing block is a security rule.

The asymmetry that decides this: one bad edit to the contract would fail **every** Submission in the application, for both Courses at once, and would present to the Admin as "Claude broke" rather than as "I broke it" — because nothing about the edit and the failure would look related. An edit that makes the guidance too lenient shows up as a Verdict somebody disagrees with, on one Submission, with an obvious cause.

## Consequences

The guidance reaches the Grader on a Practice Submission, on a Test's batch judgement, and on the Health Check.

The Health Check is the important one, and it is a feature rather than a side effect: the check runs through the real Grader path, so an edit that breaks grading turns the Admin's health banner red on its own, without anybody having to think to look. A check that ran against the shipped text would go green over a broken prompt, which is worse than having no check.

**Absent and empty are different states.** No row means "never edited" and reads as the text shipped in the code; a row holding an empty string is a deliberate "nothing beyond the skeleton", and is allowed. That is what makes «Вернуть исходный текст» a delete rather than a write of remembered text: the shipped default has exactly one home, and an Admin who restores cannot land on a stale copy of one.

There is no version history. This is a text edited twice a year, not a Draft. Who last changed it and when is recorded, because a Grader that starts judging differently is a question somebody will ask.

The text is length-bounded, and the bound is on what is stored — an over-long guidance is refused rather than trimmed on the way in and then silently graded against.

Its own edits are trusted input. Both accounts are trusted, and an Admin who wants to break their own Grader can already choose its model; fencing an Admin's own text as data would be theatre.

## What this does not settle

A **per-Course** instruction is a separate decision, and where the two disagree the more specific one has to win. That belongs in its own ADR alongside the change that adds it.

## Considered options

**Editing the whole prompt.** Rejected on the asymmetry above: it makes the failure that takes the whole application down as easy to reach as the one that makes feedback slightly worse.

**Leaving it in code.** This is what it replaces. Tuning how strictly a Student is graded should not need a deploy, and in practice it meant nobody tuned it.

**A guidance per Course from the start.** Not rejected — deferred. One global text is what exists today, made editable; a per-Course instruction is a second, narrower thing on top of it and is worth shipping separately so the ordering rule between them gets stated rather than discovered.
