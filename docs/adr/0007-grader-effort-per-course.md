# The Grader's Effort is chosen per Course, and the timeout moves with it

Extends [ADR 0002](./0002-grader-model-per-language.md), which put the Grader's **model** in the data rather than in a code branch. The **Effort** follows it: an Admin chooses it when a Course is created and on the Course's settings screen, and it applies to both places a Course is judged — a Student's answer in a Practice, and a Test's answers judged in one batch.

`low` remains what the spike measured as matching or beating every alternative, and it is what every Course that existed before this change carries. What is new is that a Course teaching something that wants more reasoning behind a Verdict can say so without a deploy.

## «По умолчанию» is the absence of the parameter

Not a sixth level. The parameter is simply not sent, and the model spends what it decides to. This is the shape Generation has used since it existed, and it is expressed the same way at every layer: `null` in the column and in the one place a `<select>` has to name it, and a missing key by the time it reaches the SDK.

That is why the column is nullable with no `DEFAULT`. A default would make "nobody chose" and "somebody chose the model's own default" the same stored state, and they are different Courses.

## Every existing Course migrates to `low`, not to the default

The migration writes `low` into every row that existed before the column did. Those Courses were grading at `low`, fixed in code, and adding a column must not change how any of them grades. A Course that quietly started reasoning for minutes because a migration ran would present as the application hanging, with nothing on any screen to say why.

## Why the timeout is tied to the Effort rather than left alone

**This is the part worth remembering.** The Grader's hard timeout is 90 seconds, and that number was sized for `low`. Left alone, a Course set to a high Effort would reliably exceed it: every Submission in that Course would come back as a failed grading, and the setting would only pretend to work. Worse, it would fail in the shape that looks least like a setting — a Student sees «Не удалось проверить ответ», which the application is careful to say is *not* their fault and equally careful not to blame on anything in particular.

So the timeout scales with the Effort, by the same ladder on both paths:

| Effort | factor | Grader (base 90s) | Test batch (base 300s) |
| --- | --- | --- | --- |
| `low` | 1 | 90s | 300s |
| `medium` | 2 | 180s | 600s |
| `high` | 10/3 | 300s | 1000s |
| `xhigh` | 16/3 | 480s | 1600s |
| `max` | 8 | 720s | 2400s |

Factors rather than ten absolute numbers, because the Test batch already had a longer clock before Effort was a choice — a batch is many answers in one call. What the Effort changes is the multiple; the base stays each path's own.

«По умолчанию» takes the `high` factor. It is not a level, so it has no entry of its own: what the model will spend cannot be looked up from here. The floor would fail a Course that happens to grade slowly, which is the exact failure this ladder exists to prevent; the ceiling would make a call that has genuinely hung cost a Student twelve minutes.

These bound a call that has stopped coming back. None of them is what an ordinary Verdict costs.

## The Student is told, because the Student is the one who waits

An Admin picks the setting; a Student sits in front of «Проверяющий читает ваш ответ…». On a Course set high that is minutes, without their having chosen anything and without anything on the screen saying why.

So after about a minute the Practice says that this is a long check rather than a stuck one, and names the reason. Sixty seconds is chosen against the measurement rather than against taste: a Verdict was measured at 4-7 seconds, so anything still running at a minute is either a Course set high or something wrong — and the Student can act on neither, which is why they are told it is the first.

Telling only the Admin what the setting costs tells the wrong person.

## What is not affected

The **Health Check** belongs to no Course and stays at `low` on its own 90-second clock. What it measures is whether grading works at all, which is not a question more reasoning answers. The **concurrency probe** and the **verdict-stability measurement** stay fixed at `low` for a different reason: both produce numbers whose only value is comparability with earlier runs, and varying the Effort between runs would measure something else.

## Consequences

A Course Export carries the Effort, and the format's version rises to 3. A file written before that has no Effort in it and reads back as `low` — what the Course it describes was grading at when it was written — never as «По умолчанию», which would restore a Course that grades differently from the one exported.

`GradeRequest.effort` and `BatchRequest.effort` are required rather than defaulted, the way `guidance` is. A caller that forgot it would grade at the wrong Effort *and* against the wrong clock, and both present to a Student as a failed grading with nothing to point at.
