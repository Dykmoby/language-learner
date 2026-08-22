# A Test's answers are Submissions, grouped by an Attempt

An Attempt is a row of its own; the answers inside it are ordinary `submissions` rows carrying the attempt they belong to. There is no separate table of Test answers.

## Why

design.md § Progress and statistics specifies the Error Type histogram as running "across all Submissions". A Test is where a Student writes at length under no time pressure and with no Progressive Hint to lean on, so its Errors are among the most informative there are — and a table apart would mean either a union at every query or statistics that quietly omit Tests. The quiet omission is the likelier outcome, because nothing would fail.

Keeping one table also keeps one shape of judgement. A Verdict, its proposal, the Coherence Guard's ruling and the Errors as rows already have exactly one representation, and a second one for Tests would be a second place for ADR 0003's split to be got half right.

## What it costs

**A nullable column on every Practice Submission.** `test_attempt_id` is null for every row the Practice writes, and the meaning of a Submission now depends on it: a null is a Practice attempt at one Exercise, a value is one answer inside an Attempt at a Test.

**The uniqueness had to admit retakes.** `(student, exercise, attempt)` was written for the Practice, where `attempt` counts tries at one Exercise. A Test's answer carries the *Attempt's* number instead, so the same Exercise answered again in a second Attempt is `attempt = 2` and does not collide. This works, and it is the one thing here a reader should check before changing either numbering.

**A Submission can now exist before its judgement.** The Practice writes a row after grading, because grading is what the Student is waiting for. A Test collects answers while it withholds every judgement, stores them when the Attempt is submitted, and sends them to the Grader afterwards — so the row is written with `status: 'awaiting_grading'` and updated when the batch lands. A batch that fails moves those rows to `grading_failed`, from which they can be judged again without the Student re-entering anything.

## What must not follow from it

Nothing that derives Practice progress may count a Test's Submissions. Progress is derived per Exercise Set, and a Test's Exercise Set is owned by the Test — so it falls out of the existing queries rather than needing a filter. A future query that walks Submissions by Student rather than by Exercise Set has to say which kind it means.
