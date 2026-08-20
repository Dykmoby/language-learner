# The Grader proposes a Verdict; the server guards it

The Grader returns a three-state Verdict alongside its Errors, and the server then applies a Coherence Guard: an empty `errors` array forces `correct`, and a non-empty one forbids `correct`.

## Why the guard exists

Given the identical English submission and prompt, Opus 5 returned `partially_correct` and Sonnet 5 returned `incorrect`. Their **error lists agreed perfectly** — all three faults found and correctly categorised by both. Only the label diverged.

Step 1 then found something stronger. Same input, same model, same settings, five runs: `partially_correct` ×3 and `incorrect` ×2 — with an **identical error list every time**. The instability is not only between models. It is run to run within one.

Because the Verdict drives progression, and because different Languages run different models ([ADR 0002](./0002-grader-model-per-language.md)), an ungoverned Verdict would make progression behave differently in English than in Tajik for equivalent work — and differently between two runs of the same call. The error list is the reproducible signal; the label is not.

## Consequences

The guard is deliberate, not defensive clutter — do not "simplify" it away. It removes the incoherent cases only.

Where `partially_correct` ends and `incorrect` begins remains genuinely unstable — across models and across runs of one model — and remains an open risk. Progression is unaffected, since neither Verdict advances the Student; what is not reproducible is the label the Student reads.

When the guard forbids `correct`, it substitutes `partially_correct` rather than `incorrect`. The Grader found faults but judged the answer worth crediting; downgrading it all the way to `incorrect` would be the server making a pedagogical judgement, which is exactly what this ADR keeps with the model that read the answer. Progression is unaffected either way — neither Verdict advances the Student.

Store **both** the Verdict the Grader proposed and the Verdict after the guard. Keeping only the guarded value makes the instability above impossible to measure later.

In step 1 the guard never fired: all 24 responses were internally coherent. The rule stands on the evidence above, but its code path has not been exercised against real incoherence — so it is covered by tests rather than by observation.

## Considered options

Dropping the Verdict from the Grader entirely and deriving all three states server-side from the error list was the alternative, and is the more robust design. It was rejected in favour of keeping the pedagogical judgement with the model that read the answer.

The run-to-run evidence above weighs on that rejection: a judgement that changes between two identical calls is a weaker thing to be preserving than it looked when this was decided. Not reopened here — but if the unstable label turns out to confuse a Student in practice, this is the option to reopen.
