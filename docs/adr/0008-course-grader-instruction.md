# A Course's own instruction for the Grader, and which text wins

[ADR 0006](./0006-editable-guidance-fixed-skeleton.md) made one block of the Grader's system prompt editable and left this open in as many words: *"A per-Course instruction is a separate decision, and where the two disagree the more specific one has to win. That belongs in its own ADR alongside the change that adds it."* This is that ADR.

Every Course carries its own instruction for the Grader, edited from the Course's settings screen. Both texts reach the Grader on every call, in a fixed order, and **where they disagree the Course's instruction is what holds.**

## Why a second text at all

The grading guidance applies to every Course at once. But Courses differ in what they are teaching, and a rule that is right for one is wrong for another: a Course about orthography wants the capitalisation strictness that a conversational Course wants dropped. With one text there is no way to say that without saying it for both.

## The order, stated rather than discovered

The prompt carries the global guidance first, then this block:

```
The following instructions are for this course specifically. Where they
disagree with anything above, follow the course's instructions — they are
the more specific of the two.
```

This sentence is the ADR's whole operative content. Two texts that contradict each other with no stated precedence is undefined behaviour — it would produce a Verdict somebody disputes, months from now, and there would be no way to reproduce which text was followed or to say which *should* have been. Specific-over-general is the only ordering with a reason behind it: the global text is what is true of grading here, and the Course's is what is true of this Course.

The sentence travels with the instruction rather than sitting at the top of the skeleton. A Course with no instruction of its own has no disagreement to resolve, and a sentence about one would be an instruction about nothing.

Both blocks live in one value — `GraderInstructions` — rather than in two arguments, because the order is the rule and an order that lives in an argument list is an order nobody can point at.

## The shipped default is empty, so there is nothing to restore

The global guidance is a whole row that may be absent, because "never edited" has to be distinguishable from "deliberately empty": the shipped text lives in the code and «Вернуть исходный текст» is a delete rather than a write of remembered text.

Here the shipped default *is* the empty string. A Course ships with nothing of its own to say, so there is no second state to tell apart, the column is `NOT NULL DEFAULT ''`, and every Course that existed before it gets exactly what a new one gets. There is no restore button beside the field, and nothing is hidden by its absence: emptying the field *is* restoring the default, and a button that typed nothing into an already-empty field would only suggest there was some remembered text behind it.

Otherwise the editing shape is the global block's: plain text, length-bounded on the stored value, empty allowed, no version history.

## Where it reaches, and where it does not

The same two places the global guidance reaches from a Course: a Practice Submission and a Test's batch judgement, in that Course and only that Course. A Test judged by different instructions from the Practice that prepared for it would be a mirror of something else.

It does not reach the **Health Check**, which belongs to no Course — there is no instruction to take, and the check's value is that the one editable text it *can* be broken by turns the Admin's banner red on its own. Nor the concurrency probe or the verdict-stability measurement, whose numbers are only worth anything compared with earlier runs.

## Consequences

A Course Export carries the instruction and the format's version rises to 4. A file written before that has none and reads back with an empty one, which is what a Course that never had an instruction holds anyway.

The bound is checked wherever a Course arrives — the settings screen and an imported file alike — for the reason the Haiku rule is checked in both places: an import must not be a way to put a text into a prompt that the screen would have refused.

An Admin's own text is trusted input, exactly as ADR 0006 has it for the global block. Both accounts are trusted, and an Admin who wants to break their own Grader can already choose its model.
