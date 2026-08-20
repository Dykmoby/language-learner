# PROTOTYPE — Grading spike

**Throwaway.** Build-order step 1 in [`../../docs/design.md`](../../docs/design.md), the stated go/no-go.
Not production code. The liftable part is [`grader.ts`](./grader.ts); [`run.ts`](./run.ts) is a
measurement harness and dies with this branch.

## The question

Does grading through `@anthropic-ai/claude-agent-sdk` — harness system prompt replaced, tools off,
streamed — beat the 16-19s `claude -p` baseline in design.md, and does the JSON response contract
hold well enough to build eight phases of web app on top of?

## Run it

```
npm install
node run.ts                      # 4 cases × 2 arms
node run.ts --case=tj-agreement --arm=adaptive-low
```

Requires Claude subscription credentials in `~/.claude` (ADR 0001).

## The answer: GO

Measured on the Pi, 2026-08-20. 24 grading calls total.

| case | arm | wall | api | 1st text | context |
|---|---|---|---|---|---|
| en-three-errors | thinking-off | 7.56s | 6.74s | 2.64s | 894 |
| en-progressive-hint | thinking-off | 6.32s | 5.40s | 2.90s | 988 |
| en-correct | thinking-off | 4.44s | 3.57s | 2.58s | 895 |
| tj-agreement | thinking-off | 6.68s | 5.81s | 3.35s | 882 |
| en-three-errors | adaptive-low | 6.76s | 6.58s | 2.48s | 894 |
| en-progressive-hint | adaptive-low | 6.15s | 5.76s | 2.74s | 988 |
| en-correct | adaptive-low | 4.35s | 3.67s | 2.57s | 895 |
| tj-agreement | adaptive-low | 6.72s | 5.82s | 3.49s | 882 |

Against the baseline: **Tajik/Opus 19s → 6.7s, English/Sonnet 10.6s → 4.4s.** Context per call
dropped from a measured 8-11k harness tokens to **882-988 total**, cache reads included.

Quality held. All three planted English errors caught with correct Error Types every run. The Tajik
case matched ADR 0002's ground truth — `-ед` identified as 2nd person plural/polite (шумо), corrected
to `мехонам`. Progressive Hints work from `priorSubmissions` alone with no session state, exactly as
ADR 0004 requires: attempt 2 opened with «артикль «a cat» теперь на месте!» before naming the one
remaining error.

## Findings that change the design

1. **Four settings are needed to strip the harness prompt, not one.** `systemPrompt` as a plain
   string replaces the prompt, but omitting `settingSources` is equivalent to
   `["user","project","local"]` — which loads this repo's `CLAUDE.md`, `~/.claude/CLAUDE.md`, every
   project and user skill, and hooks. Auto-memory and claude.ai MCP connectors ignore
   `settingSources` entirely. Grading needs all of: `settingSources: []`, `skills: []`,
   `strictMcpConfig: true`, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.

2. **Tools are disabled with `tools: []`, not `allowedTools`/`disallowedTools`** — those govern
   permission, not availability.

3. **"Thinking off" should be dropped from § Grading.** It is not faster: `adaptive` + `effort: 'low'`
   matched or beat it on every pair. It carries the tag-leakage risk § Authoring already documents,
   which would corrupt a strict JSON contract. Single sample per cell — directional, not conclusive.

4. **The SDK makes an auxiliary `claude-haiku-4-5` call on every query.** It does not grade, but it
   exists, it costs, and `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1` does not suppress it. ADR 0002 says
   Haiku "must not be used for grading in any Language" — still true, but the ADR should record that
   the SDK invokes it regardless.

5. **`result.usage` is aggregated across models and under-reports the grading model.** Use
   `result.modelUsage[model]`, and add `cacheReadInputTokens` to `inputTokens` for true context size.

6. **Sonnet 5 wraps its JSON in markdown fences routinely** — 5 of 5 runs on the longest case. ADR
   0002 cites fencing as a reason Haiku was excluded; that reason does not distinguish the models.
   The parser must tolerate fences. `parseGraderOutput` does, and reports when it happens.

7. **The Verdict is unstable within a single model.** Same input, same model, same arm, five runs:
   `partially_correct` ×3, `incorrect` ×2 — with an identical error list every time. ADR 0003 frames
   this as cross-model disagreement; it is run-to-run nondeterminism. Progression is unaffected
   (neither Verdict advances the Student) but the label the Student sees is not reproducible.

8. **~4% of calls fail the contract** (1 in 24 — an intermittent parse failure on the longest output,
   reason not captured; the harness now persists raw output to `failures/`). design.md's
   `grading_failed` path is therefore load-bearing, not defensive.

## Left unproven

- The **Coherence Guard never fired** in 24 calls — every response was internally coherent. The rule
  is still right (ADR 0003's evidence stands) but its code path is untested against real incoherence.
- **Concurrency is unmeasured.** Every call here was sequential; the design's semaphore-at-2 and the
  rate-limit question remain open.
- Later runs benefited from a **warm prompt cache** (Opus showed 2 new + 880 cached), so cold-start
  numbers will be slightly worse.
- The **Tajik Error Type enum is still unreviewed** by a Tajik speaker.
