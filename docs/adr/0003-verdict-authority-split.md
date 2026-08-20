# The Grader proposes a Verdict; the server guards it

The Grader returns a three-state Verdict alongside its Errors, and the server then applies a Coherence Guard: an empty `errors` array forces `correct`, and a non-empty one forbids `correct`.

## Why the guard exists

Given the identical English submission and prompt, Opus 5 returned `partially_correct` and Sonnet 5 returned `incorrect`. Their **error lists agreed perfectly** — all three faults found and correctly categorised by both. Only the label diverged.

Because the Verdict drives progression, and because different Languages run different models ([ADR 0002](./0002-grader-model-per-language.md)), an ungoverned Verdict would make progression behave differently in English than in Tajik for equivalent work. The error list is the reliable signal; the label is the unreliable one.

## Consequences

The guard is deliberate, not defensive clutter — do not "simplify" it away. It removes the incoherent cases only. Disagreement about where `partially_correct` ends and `incorrect` begins remains a genuine model-dependent boundary, and remains an open risk.

## Considered options

Dropping the Verdict from the Grader entirely and deriving all three states server-side from the error list was the alternative, and is the more robust design. It was rejected in favour of keeping the pedagogical judgement with the model that read the answer.
