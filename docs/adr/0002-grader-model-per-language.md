# Grader model is chosen per Language, and Haiku never grades

English is graded by Sonnet 5 and Tajik by Opus 5, overridable per Course. Haiku 4.5 must not be used for grading in any Language.

## Why Haiku never grades

This is the part worth remembering, because Haiku is the obvious cost and latency optimisation and someone will propose it again.

Asked to grade the Tajik sentence `Ман китоб мехонед`, Haiku 4.5 reported that `-ед` marks third person singular. It does not — it is second person plural/polite (`шумо`). Opus 5 and Sonnet 5 both identified it correctly. A grader that teaches false morphology with confidence is worse than no grader in a language-learning application.

Haiku also wrapped its JSON in markdown fences on both of two runs, failing the parse each time. **That is no longer a reason to prefer anything else.** Step 1 found Sonnet 5 fencing routinely — 5 of 5 runs on the longest case — so the parser tolerates fences and the behaviour does not distinguish the models. The morphology finding above is the whole of the case against Haiku, and it is enough on its own.

## The SDK calls Haiku anyway

Measured in step 1: `@anthropic-ai/claude-agent-sdk` makes an auxiliary `claude-haiku-4-5` call on every query, and `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1` does not suppress it. It does not grade, but it runs and it costs.

So "Haiku is not used" is false as a description of the running system. The rule this ADR sets is narrower, and still holds: **no Verdict, Error, or explanation ever shown to a Student may come from Haiku.**

One practical consequence — `result.usage` aggregates across models and therefore under-reports the grading model. Read `result.modelUsage[model]` instead.

## Why the split

Sonnet 5 graded both Languages correctly and is meaningfully faster on English (10.6s wall vs 16s for Opus). On Tajik it showed no latency advantage (16.4s vs 19s) while Opus produced materially richer explanations — volunteering the full conjugation paradigm and the `-ро` definiteness marker unprompted. So English takes the faster model and Tajik takes the better one, at no latency cost.

Single-sample evidence per model. Treat as directional, and revisit if Tajik grading disappoints in use.
