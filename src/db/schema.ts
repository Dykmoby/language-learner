// Drizzle schema. Vocabulary follows CONTEXT.md — Student, Admin, Course,
// Lesson, Exercise Set, Exercise, Submission, Verdict, Error Type.
//
// `Language` is an enum value in code, not a table: there are exactly two and
// the domain fixes them.

import { sqliteTable, text, integer, index, unique, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
// The Grader's pure contract module owns these: it imports nothing, so it is the
// safe place for the single definition both it and the schema depend on.
import { LANGUAGES, VERDICTS } from '../grader/contract.ts';
// The validity rules own the Exercise Kinds for the same reason: that module
// imports nothing but the normalisation, so it is the safe place for the single
// definition the schema, the forms and the seed all depend on.
import {
  EXERCISE_KINDS, DETERMINISTIC_KINDS, isDeterministic, type ExerciseKind,
} from '../content/exercise-validity.ts';
import type { LessonDocument } from '../content/lesson-document.ts';
// The Efforts, from the module the browser can import: the picker that offers
// them runs there, and the harness that sends them spawns a subprocess.
import { EFFORTS } from '../claude/effort.ts';

// A Student is every account. Admin is a role a Student additionally holds —
// a flag, not a separate table and not a separate account, because the Admin
// studies in the same account they author with.
export const students = sqliteTable('students', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  // argon2id. A stolen copy of the database file must not hand over passwords.
  passwordHash: text('password_hash').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  // Set on an account an Admin created and cleared the moment its owner chooses
  // a password of their own. It is a fact about the *password*, not a stage in a
  // sign-up: an Admin who hands out a Temporary Password knows it, and an
  // account whose password somebody else knows must not be usable for anything
  // until that stops being true. The middleware is what enforces that, so this
  // column is read on every request — cheap, because the session lookup already
  // returns the whole row.
  //
  // Defaulted false so the two seeded accounts read as what they are: passwords
  // chosen by their owner in the environment file, which nobody was handed.
  passwordIsTemporary: integer('password_is_temporary', { mode: 'boolean' }).notNull().default(false),
  // The Course a Student last worked in, restored on their next visit. Nullable:
  // a freshly seeded Student has not worked anywhere yet.
  currentCourseId: integer('current_course_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('students_username_idx').on(t.username)]);

export type StudentRow = typeof students.$inferSelect;

// --- Content -----------------------------------------------------------------

// design.md § Exercise Kinds. The Kind is what decides whether an Exercise goes
// to the Grader or to a Deterministic Check, so it is recorded rather than
// inferred from the content. Defined in the validity rules and re-exported here,
// so the columns and the rules can never drift apart.
export { EXERCISE_KINDS, DETERMINISTIC_KINDS, isDeterministic };
export type { ExerciseKind };

// A Course sits inside one Language and is fixed at a single CEFR level for its
// whole duration, so the level never has to be resolved per Lesson.
export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  language: text('language', { enum: LANGUAGES }).notNull(),
  level: text('level').notNull(),
  // Per ADR 0002: Sonnet 5 for English, Opus 5 for Tajik, overridable per Course
  // without a code change.
  graderModel: text('grader_model').notNull(),
  // How much reasoning the Grader spends on a Verdict in this Course — issue #76,
  // ADR 0007. Nullable, and null is «По умолчанию»: the parameter is not sent at
  // all, which is the absence of a choice rather than a sixth value of one. That
  // is the same shape Generation has used since it existed, and it is why this
  // column is not `notNull().default('low')` — a default here would make the two
  // states impossible to tell apart.
  //
  // Every Course that existed before the column migrated to 'low' rather than to
  // null, because 'low' is what they were all grading at in code. Nothing may
  // start grading differently because a column was added.
  graderEffort: text('grader_effort', { enum: EFFORTS }),
  // This Course's own instruction for the Grader — issue #80, ADR 0008.
  //
  // The global guidance applies to every Course at once, and Courses differ in
  // what they are teaching: the capitalisation strictness a Course about
  // orthography wants is exactly what a conversational one wants dropped. Both
  // texts reach the Grader, the global one first, and where they disagree this
  // one holds — it is the more specific of the two, and the prompt says so.
  //
  // Not nullable, unlike the global block's whole row: there is no "never
  // edited" state to tell apart here, because the shipped default *is* the empty
  // string. A Course ships with nothing of its own to say.
  graderInstruction: text('grader_instruction').notNull().default(''),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const lessons = sqliteTable('lessons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  title: text('title').notNull(),
  theoryMarkdown: text('theory_markdown').notNull(),
  // Handed to the Grader as context on every call (design.md § Grading).
  grammarFocus: text('grammar_focus').notNull(),
  // When this Lesson first became something a Student reads. Null on one that
  // has been created and never published — a Lesson authored through the Admin
  // screens starts that way, and must not appear in a Student's Course as
  // something they can open and cannot do, nor sit in the middle of sequential
  // unlocking. The Student's read side drops these rows entirely; the Admin's
  // shows them, because an unpublished Lesson is exactly what an Admin is
  // working on.
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
}, (t) => [unique('lessons_course_position_unq').on(t.courseId, t.position)]);

// A Test is owned by a Course rather than a Lesson. It gives no feedback until
// submitted, and gates nothing — a mirror, not a gate.
export const tests = sqliteTable('tests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  passThreshold: integer('pass_threshold').notNull().default(80),
  // The same rule a Lesson follows, for the same reason: an assessment a Student
  // can open and cannot do is worse than no assessment. A Test starts here and
  // is absent from the Course they read until an Admin publishes it.
  //
  // Unlike a Lesson there is no Draft behind it — a Test has no Theory to write
  // and no conversation to hold over it, so its Exercises are edited in place and
  // an edit to a published Test is live when it is saved. That is affordable
  // here in a way it would not be for a Lesson: a Test gates nothing, and the
  // worst an edit costs is one wasted attempt.
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
});

export type TestRow = typeof tests.$inferSelect;

// Owned by exactly one of a Lesson's Practice or a Test — never both, never
// neither. That invariant belongs to the database, not to application code, so
// nobody has to remember it, and so ordering, rendering and grading never branch
// on "am I in a Lesson or a Test".
export const exerciseSets = sqliteTable('exercise_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonId: integer('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  testId: integer('test_id').references(() => tests.id, { onDelete: 'cascade' }),
}, (t) => [
  check(
    'exercise_sets_exactly_one_owner',
    sql`((${t.lessonId} is not null) + (${t.testId} is not null)) = 1`,
  ),
]);

export const exercises = sqliteTable('exercises', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  exerciseSetId: integer('exercise_set_id').notNull()
    .references(() => exerciseSets.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  kind: text('kind', { enum: EXERCISE_KINDS }).notNull(),
  prompt: text('prompt').notNull(),
  // The canonical answer the Admin writes. Shown to the Grader as context and to
  // the Student on Reveal.
  referenceAnswer: text('reference_answer').notNull(),
  // Deterministic Check Kinds only: one list per Gap, because a prompt may have
  // several places to answer and each has its own accepted values. Unused by
  // Grader-judged Kinds, which store no Gaps at all.
  acceptedAnswers: text('accepted_answers', { mode: 'json' })
    .$type<string[][]>().notNull().default([]),
  caseSensitive: integer('case_sensitive', { mode: 'boolean' }).notNull().default(false),
  // What the Student is offered rather than what is accepted: the options of a
  // multiple choice, the fragments of a word order, in the order they are shown.
  // Separate from acceptedAnswers because these are shown to everyone and those
  // are the answer — an Exercise that stored only its accepted answers could not
  // be rendered at all.
  choices: text('choices', { mode: 'json' }).$type<string[]>().notNull().default([]),
}, (t) => [unique('exercises_set_position_unq').on(t.exerciseSetId, t.position)]);

// An additional answer confirmed correct by an Admin resolving a Dispute. Kept
// apart from the Reference Answer so the accepted set grows without ever
// rewriting the author's canonical answer.
export const acceptedVariants = sqliteTable('accepted_variants', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
  value: text('value').notNull(),
  // Which Gap this value was confirmed for — #85. Null on every Kind with one
  // place to answer, where there is no position to name, and on every variant
  // written before a fill-gap could have more than one Gap; those join every Gap,
  // exactly as they did when they were written. A positioned variant is accepted
  // at its own Gap and nowhere else: a word confirmed for the second Gap of
  // «___ have ___ apple» must not start marking that word correct in the first,
  // which would be the Exercise teaching the mistake.
  gap: integer('gap'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type AcceptedVariantRow = typeof acceptedVariants.$inferSelect;

export type CourseRow = typeof courses.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;

// --- Authoring ---------------------------------------------------------------

// A Draft: an unpublished version of a Lesson. What the Student reads lives in
// `lessons` and `exercises`; this is what an Admin is working on, and the two
// only meet when a Draft is deliberately published.
//
// Append-only. Every save writes a new row rather than overwriting the last, so
// the history exists from the first edit — restoring an earlier Draft is then
// another append rather than a deletion, and browsing the history can never
// destroy work.
//
// The whole Lesson is one JSON document rather than a column per field, per
// ADR 0004: full-document exchange is what Refinement will do every turn, and a
// document that held only some of the Lesson would have to be reshaped, and every
// stored Draft migrated, as soon as anything else became editable.
// Where a Draft came from. Recorded rather than inferred, because the history
// screen has to say what each Draft *was*, and by step 5 most of them will not
// have been typed by a person. `restore` is in use from the moment the history
// exists: restoring appends a new Draft, and calling that one a manual edit
// would be the one thing a history must never do — misreport what happened.
export const DRAFT_ORIGINS = ['manual', 'restore', 'generation', 'refinement'] as const;
export type DraftOrigin = (typeof DRAFT_ORIGINS)[number];

export const lessonDrafts = sqliteTable('lesson_drafts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  lessonId: integer('lesson_id').notNull().references(() => lessons.id, { onDelete: 'cascade' }),
  document: text('document', { mode: 'json' }).$type<LessonDocument>().notNull(),
  origin: text('origin', { enum: DRAFT_ORIGINS }).notNull().default('manual'),
  // Set on the Draft that was published, null on every Draft that was not. The
  // same fact could be a pointer on the Lesson instead; it is here because that
  // would make `lessons` and `lesson_drafts` reference each other in a cycle for
  // no gain, and because "this version went live at T" is a fact about the
  // version rather than about the Lesson.
  publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
  // The SDK conversation this Draft belongs to. Null until one starts, and null
  // on every Draft written before Refinement existed.
  //
  // Recorded per Draft rather than per Lesson, and that is what makes an old
  // Draft more than old text: restoring one from three turns ago and carrying on
  // is a fork of the conversation at that point rather than a rewind of the one
  // that ran to the end. A single pointer on the Lesson could not express it.
  //
  // It is carried forward by a manual save and by a restore, not only written by
  // a turn: a hand edit is a version of the Lesson being discussed, not a
  // departure from the discussion.
  sessionId: text('session_id'),
  // What the Admin asked for, on a Draft a Refinement turn produced. Null on
  // every other kind.
  //
  // Stored here rather than in a conversation table of its own because the thread
  // *is* these rows: every turn already appends one, in order, carrying the
  // document it produced and the session it came from. A separate table would be
  // a second history that could disagree with this one about what happened.
  refinementRequest: text('refinement_request'),
  // Nullable: losing the account that wrote a Draft must not take the Draft with
  // it, and a two-person application will outlive at least one re-seed.
  createdBy: integer('created_by').references(() => students.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('lesson_drafts_lesson_idx').on(t.lessonId)]);

export type LessonDraftRow = typeof lessonDrafts.$inferSelect;

// --- Progress ----------------------------------------------------------------

// 'revealed' is the Reveal offered after three failed attempts: the Student took
// the Reference Answer instead of a fourth attempt. It is a row here rather than
// a flag on the Exercise because completion is derived from Submissions — a
// separate flag is a second source of truth that can disagree with them.
//
// 'awaiting_grading' exists for a Test and nowhere else. A Practice Submission is
// written *after* it has been judged, because judging it is what the Student is
// waiting for; a Test's answers are collected while it withholds every judgement,
// stored when the attempt is submitted, and only then sent to the Grader in one
// batch. The row therefore exists before its Verdict does, and this is the state
// it sits in until the batch lands — or, if the batch fails, the state it moves
// out of into 'grading_failed', where it can be graded again without the Student
// re-entering a single answer.
export const SUBMISSION_STATUSES = ['graded', 'grading_failed', 'revealed', 'awaiting_grading'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export { LANGUAGES, VERDICTS };

// The link between a Student and a Course. A Student may hold several at once,
// across both Languages.
export const enrollments = sqliteTable('enrollments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [unique('enrollments_student_course_unq').on(t.studentId, t.courseId)]);

// One run at a Test by one Student, and the thing that groups its answers.
//
// A row exists once an attempt has been **submitted**: a Test is answered in one
// screen and sent in one request, so there is no half-attempt on the server to
// keep — and an abandoned one is not an attempt, it is a Student who closed a tab.
//
// Retakes are unlimited and every attempt is kept: `attempt` numbers them per
// Student and per Test, and a later one never overwrites an earlier one. The
// point of a Test taken twice is the difference between the two.
export const testAttempts = sqliteTable('test_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testId: integer('test_id').notNull().references(() => tests.id, { onDelete: 'cascade' }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  attempt: integer('attempt').notNull(),
  // What the Test's threshold was when this attempt was taken. Copied rather
  // than read through the Test, because an Admin who raises the threshold next
  // month must not retroactively fail an attempt that passed.
  passThreshold: integer('pass_threshold').notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  unique('test_attempts_student_test_attempt_unq').on(t.studentId, t.testId, t.attempt),
  index('test_attempts_student_test_idx').on(t.studentId, t.testId),
]);

export type TestAttemptRow = typeof testAttempts.$inferSelect;

// One Student's answer to one Exercise on one attempt.
export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
  // What produces Progressive Hints: attempt N is graded with attempts 1..N-1 in
  // context, and no session state exists anywhere (ADR 0004).
  attempt: integer('attempt').notNull(),
  // The answer as a person reads it. For a fill-gap that is the prompt with the
  // gaps filled in, because «кошка, стол» is storage rather than an answer, and
  // this column is what the Test review, the Dispute screen and the Grader's
  // Progressive Hints all show. Put back into the sentence **once**, where the
  // answer is written down — not at each of the screens that show one, any of
  // which could forget.
  answer: text('answer').notNull(),
  // What the Student wrote in each gap, in reading order — a fill-gap only.
  //
  // Kept beside the sentence rather than instead of it, because the two answer
  // different questions and only one of them survives an edit to the prompt: a
  // sentence reassembled later would put this Student's words into whatever the
  // Exercise says today. This is what a Dispute promotes to an Accepted Variant
  // and what marks the gaps that were not accepted; the sentence is what is read.
  //
  // Empty on every other Kind, the way `choices` is empty on a Kind with nothing
  // to offer: one place to answer needs no list to say so.
  answerGaps: text('answer_gaps', { mode: 'json' })
    .$type<string[]>().notNull().default([]),

  // The Test attempt this answer was given in, or null for a Practice Submission.
  //
  // A Test's answers are Submissions rather than rows of their own so that
  // design.md § Progress and statistics stays literally true: the Error Type
  // histogram is specified as being across all Submissions, and a Test's Errors
  // belong in it. A table apart would mean either a union at every query or
  // statistics that quietly omit Tests.
  //
  // Where an attempt supplies the `attempt` number, the uniqueness below still
  // holds: an attempt answers each of its Exercises once, and retaking the Test
  // numbers the next attempt one higher.
  testAttemptId: integer('test_attempt_id').references(() => testAttempts.id, { onDelete: 'cascade' }),

  // A failed grading is not a wrong answer, and must never be rendered as one
  // (design.md § Failure behaviour).
  status: text('status', { enum: SUBMISSION_STATUSES }).notNull(),
  failureReason: text('failure_reason'),

  // BOTH Verdicts, deliberately. The Verdict is unstable run-to-run within a
  // single model; keeping only the guarded value makes that unmeasurable later
  // (ADR 0003). Null on a failed grading — there was no judgement to record.
  proposedVerdict: text('proposed_verdict', { enum: VERDICTS }),
  guardedVerdict: text('guarded_verdict', { enum: VERDICTS }),

  // The server removed an Error the Grader reported — issue #78's typography
  // drop. Without this the two Verdicts above would differ for a reason that has
  // nothing to do with the Grader, and the guard-firing tally reads exactly that
  // difference as the Grader contradicting itself. Defaulted false, which is
  // what every row written before this column is: nothing was dropped from it.
  typographyDropped: integer('typography_dropped', { mode: 'boolean' }).notNull().default(false),

  feedbackRu: text('feedback_ru'),
  corrected: text('corrected'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  unique('submissions_student_exercise_attempt_unq').on(t.studentId, t.exerciseId, t.attempt),
  index('submissions_student_exercise_idx').on(t.studentId, t.exerciseId),
  index('submissions_test_attempt_idx').on(t.testAttemptId),
]);

// One structured fault found in a Submission. Rows, not a JSON blob: the whole
// of design.md § Progress and statistics aggregates over Error Type, and that is
// a query rather than a deserialisation loop.
export const submissionErrors = sqliteTable('submission_errors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  submissionId: integer('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  // The stable enum string from design.md § Error Type enum. The Russian label is
  // resolved at display time from the interface dictionary and never persisted —
  // only the label changes, and storage must survive that.
  type: text('type').notNull(),
  span: text('span').notNull(),
  explanationRu: text('explanation_ru').notNull(),
}, (t) => [index('submission_errors_type_idx').on(t.type)]);

export type SubmissionRow = typeof submissions.$inferSelect;
export type SubmissionErrorRow = typeof submissionErrors.$inferSelect;

// --- Sessions ----------------------------------------------------------------

// Server-side sessions, not JWTs. Signing out deletes the row, which is the
// thing a stateless token cannot do — so a device can be handed to someone else.
export const sessions = sqliteTable('sessions', {
  // An opaque random id. Never derived from the Student, never guessable.
  id: text('id').primaryKey(),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('sessions_student_idx').on(t.studentId)]);

export type SessionRow = typeof sessions.$inferSelect;

// --- Login throttle ----------------------------------------------------------

// Keyed by username, not IP: the application sits behind Caddy, so the peer
// address is a proxy header, and with two known accounts the account is the
// thing being attacked.
//
// Persisted rather than held in memory — restarting the service must not clear
// an active lockout.
export const loginThrottle = sqliteTable('login_throttle', {
  username: text('username').primaryKey(),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastFailureAt: integer('last_failure_at', { mode: 'timestamp_ms' }).notNull(),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
});

// --- Disputes ----------------------------------------------------------------

// A Student's objection to a Verdict — CONTEXT.md. A fact *about* a judgement,
// never an edit to one: ADR 0003 keeps both the proposed and the guarded Verdict
// so the Grader's run-to-run instability stays measurable, and overwriting either
// after a review would destroy the one number that says whether the Grader is
// improving — how often a person overruled it. So nothing here writes to
// `submissions`, and the progress derivation reads the two together.
//
// A ruling of null is the queue: a Dispute awaiting a decision. Resolved rows
// keep their ruling and stay readable, because a resolved Dispute is the record
// of a decision rather than a task that evaporates when it is done.
export const DISPUTE_RULINGS = ['upheld', 'rejected'] as const;
export type DisputeRuling = (typeof DISPUTE_RULINGS)[number];

export const disputes = sqliteTable('disputes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Unique: one objection per Submission, and the database says so rather than a
  // check somewhere that could be skipped by the next caller. Saying it twice is
  // not saying it louder.
  submissionId: integer('submission_id').notNull().unique()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  // Denormalised from the Submission on purpose: the Admin's queue lists whose
  // each Dispute is, and reading that through a join to the Submission on every
  // row buys nothing when the answer can never differ — a Dispute is written by
  // the Student who wrote the answer, and that is the rule the endpoint enforces.
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  // In their own words. Required: an objection with no reason is not reviewable.
  comment: text('comment').notNull(),
  ruling: text('ruling', { enum: DISPUTE_RULINGS }),
  // Nullable for the same reason a Draft's author is: losing an account must not
  // take the record of its decisions with it.
  resolvedBy: integer('resolved_by').references(() => students.id, { onDelete: 'set null' }),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  // The queue is "every Dispute with no ruling, oldest first", and it is the one
  // query an Admin runs here.
  index('disputes_ruling_idx').on(t.ruling, t.createdAt),
  index('disputes_student_idx').on(t.studentId),
]);

export type DisputeRow = typeof disputes.$inferSelect;

// --- Operations --------------------------------------------------------------

// Where a health check run came from. Recorded rather than inferred, because
// "the timer is running" and "somebody pressed the button this morning" are
// different facts about the same green result, and only one of them says the
// check will still be running next week.
export const HEALTH_CHECK_SOURCES = ['button', 'timer'] as const;
export type HealthCheckSource = (typeof HEALTH_CHECK_SOURCES)[number];

// One run of the Grader health check, kept.
//
// The check itself is exhaustive about what it reports, but its answer used to
// live in the component state of whoever pressed the button: close the tab and
// it was gone, and the dashboard never had one at all. A row per run is what
// lets a page say whether grading works without spending a paid Grader call to
// find out — and what lets an unattended run reach a person.
//
// Append-only, one row per run, so "when did this last work" stays answerable.
// It is not a metric: nothing derives a rate from these rows, and the dashboard
// reads exactly one of them.
export const healthChecks = sqliteTable('health_checks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  healthy: integer('healthy', { mode: 'boolean' }).notNull(),
  wallMs: integer('wall_ms').notNull(),
  // Null on a healthy run — there was nothing to explain.
  reason: text('reason'),
  // All three heuristics, kept as the check reports them. ADR 0001: neither the
  // credentials failure nor the egress one presents as what it is, so the guess
  // is stored as a guess and rendered as one.
  likelyCredentials: integer('likely_credentials', { mode: 'boolean' }).notNull().default(false),
  likelyEgress: integer('likely_egress', { mode: 'boolean' }).notNull().default(false),
  // The third, and the one with better evidence behind it: the SDK announces a
  // 429 or a 529 on the wire. Defaulted false so every run recorded before this
  // column existed reads as "not known to be a rate limit", which is what it is.
  likelyRateLimit: integer('likely_rate_limit', { mode: 'boolean' }).notNull().default(false),
  source: text('source', { enum: HEALTH_CHECK_SOURCES }).notNull(),
  ranAt: integer('ran_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('health_checks_ran_at_idx').on(t.ranAt)]);

export type HealthCheckRow = typeof healthChecks.$inferSelect;

// The one block of the Grader's system prompt an Admin can edit — issue #79.
//
// How the Grader judges (how strict to be, what to let pass, what tone to take)
// is the part of the prompt most likely to want tuning and the least dangerous
// to touch. The skeleton around it stays in code and out of reach: ADR 0006 says
// which parts those are and why.
//
// One row, id 1, or none. No row means the guidance shipped in the code, which
// is what makes «Вернуть исходный текст» a delete rather than a write of
// remembered text — and it keeps an empty block, which is allowed and means
// "nothing beyond the skeleton", distinct from never having been edited.
//
// No version history: this is a text edited twice a year, not a Draft. Who last
// changed it and when is recorded, because a prompt that starts grading
// differently is a question somebody will ask.
export const graderGuidance = sqliteTable('grader_guidance', {
  id: integer('id').primaryKey(),
  guidance: text('guidance').notNull(),
  // Nullable and `set null`, like every other authorship reference in this
  // schema: deleting an account must not fail because that person once edited
  // the guidance, and must not take the guidance with it either. The text is the
  // system's; the name beside it is a courtesy.
  updatedBy: integer('updated_by').references(() => students.id, { onDelete: 'set null' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export type GraderGuidanceRow = typeof graderGuidance.$inferSelect;
