// What an Admin may choose when creating a Course: its CEFR level and the model
// that will grade every free-form answer in it.
//
// Apart from the module that writes Courses for the same reason the Exercise
// Kinds live apart from the schema: the form that offers these choices runs in
// the browser, and a constant it shares with a module that opens SQLite is a
// constant that drags SQLite into the bundle. The single import here is the
// Grader's own contract, which imports nothing.

import { graderModelRefusal } from '../grader/contract.ts';
import type { Language } from '../grader/contract.ts';

// A Course is fixed at a single CEFR level for its whole duration, so the level
// is asked for once, when the Course is created, and never resolved per Lesson.
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export function isCefrLevel(value: string): value is CefrLevel {
  return (CEFR_LEVELS as readonly string[]).includes(value);
}

// The models an Admin may choose between — ADR 0002's two, and deliberately not
// a free-text field. A mistyped model name is a Course whose every Submission
// fails to grade, discovered by a Student rather than by whoever typed it.
//
// Haiku is absent by construction, which is the first of two guards: it cannot
// be offered because it is not on this list, and it is refused by name below
// because a list is not a rule.
export const GRADER_MODELS = ['claude-sonnet-5', 'claude-opus-5'] as const;
export type GraderModel = (typeof GRADER_MODELS)[number];

// ADR 0002 — English takes the faster model, Tajik the better one, at no latency
// cost. Defaulted from the Language and overridable per Course.
export const DEFAULT_GRADER_MODEL = {
  en: 'claude-sonnet-5',
  tj: 'claude-opus-5',
} as const satisfies Record<Language, GraderModel>;

/**
 * The models an Admin may choose to write a Lesson with.
 *
 * The same two, and for the same reason ADR 0002 gives for grading: a model that
 * explains grammar confidently and wrongly is worse than no model at all in a
 * language-learning application, and a Theory is read by a Student as fact. Haiku
 * is absent by construction here too — a picker that cannot offer it and a parse
 * that will not accept it are two guards rather than one.
 */
export const AUTHOR_MODELS = GRADER_MODELS;

export type GraderModelFault = 'grader_model_forbidden' | 'grader_model_unknown';

/**
 * Why this model may not grade a Course, or null.
 *
 * The Haiku half defers to the Grader's own rule rather than restating it, so
 * ADR 0002 has one definition in the codebase. The unknown half is this
 * module's: the Grader would accept any string, and a form must not.
 */
export function graderModelFault(model: string): GraderModelFault | null {
  if (/haiku/i.test(model)) {
    // Named apart from `grader_model_unknown` on purpose: an Admin who reached
    // for Haiku is not making a typo, and should be told the rule.
    return graderModelRefusal(model) === null ? null : 'grader_model_forbidden';
  }
  return (GRADER_MODELS as readonly string[]).includes(model) ? null : 'grader_model_unknown';
}
