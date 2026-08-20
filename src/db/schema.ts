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

// A Student is every account. Admin is a role a Student additionally holds —
// a flag, not a separate table and not a separate account, because the Admin
// studies in the same account they author with.
export const students = sqliteTable('students', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  // argon2id. A stolen copy of the database file must not hand over passwords.
  passwordHash: text('password_hash').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  // The Course a Student last worked in, restored on their next visit. Nullable:
  // a freshly seeded Student has not worked anywhere yet.
  currentCourseId: integer('current_course_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [index('students_username_idx').on(t.username)]);

export type StudentRow = typeof students.$inferSelect;

// --- Content -----------------------------------------------------------------

// design.md § Exercise Kinds. The Kind is what decides whether an Exercise goes
// to the Grader or to a Deterministic Check, so it is recorded rather than
// inferred from the content.
export const EXERCISE_KINDS = [
  'composition', 'translation', 'open_writing',
  'fill_gap', 'multiple_choice', 'word_order',
] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

// design.md § Exercise Kinds — which Kinds are settled in code and which go to
// the Grader. A property of the Kind itself, so it lives beside the Kind rather
// than as a branch in whichever module happens to need it first.
export const DETERMINISTIC_KINDS = [
  'fill_gap', 'multiple_choice', 'word_order',
] as const satisfies readonly ExerciseKind[];

export function isDeterministic(kind: ExerciseKind): boolean {
  return (DETERMINISTIC_KINDS as readonly ExerciseKind[]).includes(kind);
}

// A Course sits inside one Language and is fixed at a single CEFR level for its
// whole duration, so the level never has to be resolved per Lesson.
export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  language: text('language', { enum: LANGUAGES }).notNull(),
  level: text('level').notNull(),
  // Per ADR 0002: Sonnet 5 for English, Opus 5 for Tajik, overridable per Course
  // without a code change.
  graderModel: text('grader_model').notNull(),
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
}, (t) => [unique('lessons_course_position_unq').on(t.courseId, t.position)]);

// A Test is owned by a Course rather than a Lesson. It gives no feedback until
// submitted, and gates nothing — a mirror, not a gate.
export const tests = sqliteTable('tests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('course_id').notNull().references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  passThreshold: integer('pass_threshold').notNull().default(80),
});

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
  // Deterministic Check Kinds only: an array, because "put the word in the
  // correct form" may have several right answers. Unused by Grader-judged Kinds.
  acceptedAnswers: text('accepted_answers', { mode: 'json' }).$type<string[]>().notNull().default([]),
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
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export type CourseRow = typeof courses.$inferSelect;
export type LessonRow = typeof lessons.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;

// --- Progress ----------------------------------------------------------------

// 'revealed' is the Reveal offered after three failed attempts: the Student took
// the Reference Answer instead of a fourth attempt. It is a row here rather than
// a flag on the Exercise because completion is derived from Submissions — a
// separate flag is a second source of truth that can disagree with them.
export const SUBMISSION_STATUSES = ['graded', 'grading_failed', 'revealed'] as const;
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

// One Student's answer to one Exercise on one attempt.
export const submissions = sqliteTable('submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: integer('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
  // What produces Progressive Hints: attempt N is graded with attempts 1..N-1 in
  // context, and no session state exists anywhere (ADR 0004).
  attempt: integer('attempt').notNull(),
  answer: text('answer').notNull(),

  // A failed grading is not a wrong answer, and must never be rendered as one
  // (design.md § Failure behaviour).
  status: text('status', { enum: SUBMISSION_STATUSES }).notNull(),
  failureReason: text('failure_reason'),

  // BOTH Verdicts, deliberately. The Verdict is unstable run-to-run within a
  // single model; keeping only the guarded value makes that unmeasurable later
  // (ADR 0003). Null on a failed grading — there was no judgement to record.
  proposedVerdict: text('proposed_verdict', { enum: VERDICTS }),
  guardedVerdict: text('guarded_verdict', { enum: VERDICTS }),

  feedbackRu: text('feedback_ru'),
  corrected: text('corrected'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
  unique('submissions_student_exercise_attempt_unq').on(t.studentId, t.exerciseId, t.attempt),
  index('submissions_student_exercise_idx').on(t.studentId, t.exerciseId),
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
