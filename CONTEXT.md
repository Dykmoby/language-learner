# Language Learner

A private language-learning web application for two people. Students work through courses in English and Tajik; the interface is in Russian. Free-form answers are judged by Claude, which returns structured feedback rather than a bare pass/fail.

## Language

### People

**Student**:
A person working through a Course. Every account is a Student.
_Avoid_: user, learner, pupil

**Admin**:
A role held by a Student that additionally grants authoring rights over Courses. The Admin is a Student too, not a separate account.
_Avoid_: teacher, owner, superuser

**Temporary Password**:
The generated password an Admin hands a newly created Student. Known to two people from the moment it exists, so the account can do nothing but replace it until the Student has.
_Avoid_: initial password, default password, one-time password

### Learning structure

**Language**:
A language being taught — English or Tajik. Russian is the interface language and is never a Language.
_Avoid_: locale, target, subject

**Course**:
A study programme inside one Language, fixed at a single CEFR level for its whole duration.
_Avoid_: class, programme, track

**Lesson**:
An ordered unit inside a Course, made of a Theory part and a Practice part.
_Avoid_: unit, chapter, module

**Theory**:
The written explanation part of a Lesson, authored as markdown.
_Avoid_: material, article, content

**Practice**:
The Exercise Set attached to a Lesson, worked through in order.
_Avoid_: homework, drill, workout

**Exercise Set**:
An ordered collection of Exercises. Owned by either a Lesson's Practice or a Test — never both.
_Avoid_: exercise list, question bank

**Exercise**:
A single task put to a Student.
_Avoid_: question, task, assignment, problem, item

**Exercise Kind**:
What sort of task an Exercise is — composition, translation, open writing, fill-gap, multiple choice, or word order. Determines whether it is judged by the Grader or by a Deterministic Check.
_Avoid_: type, format

**Test**:
An assessment owned by a Course rather than a Lesson. Gives no feedback until submitted, and gates nothing.
_Avoid_: quiz, exam, assessment

**Attempt**:
One Student's run at a Test, from the first answer to the score. Numbered per Student and per Test, unlimited, and never replaced by a later one — the point of taking a Test twice is the difference between the two.
_Avoid_: try, run, sitting, session

### Answers and judgement

**Gap**:
A place in a fill-gap Exercise's prompt where a Student writes an answer, written `___`. A prompt with three gaps is answered in three inputs, in the order the sentence is read, each judged against its own accepted values. Every other Exercise Kind has exactly one place to answer.
_Avoid_: blank, slot, placeholder, field, hole

**Reference Answer**:
The canonical answer an Admin writes when authoring an Exercise. Shown to the Grader as context and to the Student on Reveal.
_Avoid_: correct answer, solution, key

**Accepted Variant**:
An additional answer confirmed to be correct, added by an Admin when resolving a Dispute. Grows over time and is fed to the Grader. On a fill-gap it carries the Gap it was confirmed for and is accepted at that Gap alone; on every other Exercise Kind there is one place to answer and so no position to carry.
_Avoid_: alternative, synonym

**Submission**:
One Student's answer to one Exercise on one attempt.
_Avoid_: response, entry, try

**Grader**:
The Claude call that judges a free-form Submission and returns a Verdict with Errors.
_Avoid_: checker, AI, bot, model, reviewer

**Deterministic Check**:
Judgement performed in code by comparing against Reference Answers and Accepted Variants, with no Grader involved.
_Avoid_: auto-check, local check

**Verdict**:
The judgement on a Submission — correct, partially correct, or incorrect. Proposed by the Grader, reconciled by the Coherence Guard.
_Avoid_: result, score, grade, status

**Coherence Guard**:
The server-side rule that reconciles a Verdict with its Errors: no Errors forces correct, and any Error forbids correct.
_Avoid_: validator, sanity check

**Error**:
One structured fault found in a Submission, carrying an Error Type, the offending fragment, and an explanation in Russian.
_Avoid_: mistake, issue, problem

**Error Type**:
A value from the fixed enum of fault categories — a shared core plus a per-Language extension. Stable in storage; only its Russian label changes.
_Avoid_: category, tag, label

**Grading Guidance**:
The block of the Grader's system prompt an Admin edits, applying to every Course at once. The rest of the prompt is fixed in code and out of reach.
_Avoid_: prompt, system prompt, rules

**Course Instruction**:
A Course's own instruction for the Grader, edited from its settings screen. Reaches the Grader after the Grading Guidance, and wins where the two disagree — it is the more specific of the two. The two together are the Grader's instructions; either alone is named by its own term.
_Avoid_: course prompt, course guidance, override

**Progressive Hint**:
The sharpening of Grader feedback across repeated attempts at the same Exercise, driven by giving the Grader the Student's earlier Submissions. What the Student is shown grows with what they have already tried: the first failure carries the Verdict and the Grader's explanation alone, the Errors arrive on the second, and the corrected answer on the third — in the same view where Reveal is first offered.
_Avoid_: tip, clue

**Explanation**:
What Claude writes about one wrong Submission when a Student asks for it: why the answer they gave is wrong, never which answer is right. Offered only on the Exercise Kinds a Deterministic Check judges, which come back with a Verdict and nothing else. Stored nowhere — it is streamed to the screen it was asked from and is gone on reload.
_Avoid_: hint, feedback, correction, tip

**Reveal**:
The action offered after three failed attempts that shows the Reference Answer and moves the Student on.
_Avoid_: skip, give up, solve

**Dispute**:
A Student's objection to a Verdict. Unblocks progression immediately and queues the Submission for Admin review.
_Avoid_: appeal, complaint, report, flag

### Progression

**Enrollment**:
The link between a Student and a Course. A Student may hold several at once, across both Languages.
_Avoid_: registration, subscription, signup

**Current Course**:
The Enrollment a Student last worked in, restored on their next visit.
_Avoid_: active course, selected course

**Completed With Help**:
The state of an Exercise finished via Reveal. Counts as complete, but stays visually distinct from an Exercise solved unaided.
_Avoid_: skipped, partial

### Authoring

**Draft**:
An unpublished version of a Lesson. Every Generation turn and every manual edit produces a new one, and all of them are restorable.
_Avoid_: revision, version, WIP

**Generation**:
Claude producing a Draft from an Admin's structured inputs — topic, vocabulary, exercise count and mix.
_Avoid_: authoring, creation, autogeneration

**Refinement**:
The ongoing conversation with Claude over an existing Draft.
_Avoid_: editing, iteration, feedback loop

**Effort**:
How much reasoning Claude applies to a call. Chosen per request by the Admin for a Generation or a Refinement, and stored on the Course for the Grader. «По умолчанию» is the absence of the setting rather than a value of it. Raising it raises the call's timeout with it.
_Avoid_: quality, depth, thinking level

### Operations

**Health Check**:
One real Grader call against a fixed known input, run to find out whether grading works. Every run is kept; the Admin dashboard reads the latest one rather than running another.
_Avoid_: ping, heartbeat, smoke test, monitor

**Course Export**:
One Course as a single JSON file — its published Lessons, its published Tests, the Accepted Variants its Exercises earned, and its Theory images. Carries no Submissions, Students, Enrollments or Drafts. Reading one back always creates a new Course.
_Avoid_: dump, archive, snapshot, backup

**Backup Set**:
One dated directory holding both halves of this box's state: an online copy of the database and a copy of the upload folder. A database backup without the images is not a Backup Set.
_Avoid_: snapshot, dump, archive
