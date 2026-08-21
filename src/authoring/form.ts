// What the Generation form offers, and what it sends.
//
// Both sides import this: the form runs in the browser and the route runs on the
// server, and a second definition of "the six Effort entries" is how the two end
// up offering and accepting different things. Nothing here touches the database
// or the SDK, which is what lets the browser import it at all.

import { EXERCISE_KINDS, type ExerciseKind } from '../content/exercise-validity.ts';
import { AUTHOR_MODELS } from '../content/course-options.ts';
import { EFFORTS, type Effort } from '../claude/effort.ts';
import type { KindMix } from './contract.ts';
import { parseLessonDocument, type LessonDocument } from '../content/lesson-document.ts';

/**
 * The six entries of design.md § Authoring: five Efforts, and «По умолчанию»,
 * which omits the parameter altogether.
 *
 * `null` is that sixth entry — the absence of the parameter, expressed as a
 * value because a `<select>` cannot offer an absence and a JSON body cannot
 * carry one. It is turned back into an absence at the edge, in `parseEffort`.
 *
 * There is no thinking toggle. `low` is the fast path, and disabling thinking is
 * rejected outright at `xhigh`/`max` on Opus 5 and causes tool-call and tag
 * leakage elsewhere — which is precisely what would corrupt a document contract.
 */
export const EFFORT_CHOICES: readonly (Effort | null)[] = [null, ...EFFORTS];

export type GenerationForm = {
  topic: string;
  vocabulary: string[];
  exerciseCount: number;
  kindMix: KindMix;
  wishes: string;
  /** A published Lesson of this Course to continue from, or null. */
  continueFromLessonId: number | null;
  model: string;
  /** Absent where the Admin chose «По умолчанию». */
  effort?: Effort;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** A list of short strings as a textarea sends it. Blank entries are absent. */
function asStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return (value as string[]).map((item) => item.trim()).filter((item) => item !== '');
}

/** `null` and absence both mean «По умолчанию»: the parameter is not sent at all. */
function parseEffort(value: unknown): { ok: true; effort?: Effort } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true };
  if (typeof value !== 'string' || !(EFFORTS as readonly string[]).includes(value)) return { ok: false };
  return { ok: true, effort: value as Effort };
}

function parseKindMix(value: unknown): KindMix | null {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const mix: KindMix = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    if (!(EXERCISE_KINDS as readonly string[]).includes(key)) return null;
    if (!Number.isInteger(count) || (count as number) < 0) return null;
    // Nought of a Kind is no preference about that Kind, which is what an absent
    // entry already means. Dropped so the two cannot be told apart downstream.
    if ((count as number) > 0) mix[key as ExerciseKind] = count as number;
  }
  return mix;
}

/**
 * The form as it arrives over the wire, or null if the body is not that shape.
 *
 * Shaping, not judging — the same split the Lesson document's parse makes. An
 * empty topic parses fine and is reported as a fault the Admin can read; a Kind
 * nobody has heard of is a shape failure, because there is no control that could
 * have produced it.
 *
 * A model outside the offered list is a shape failure too, and that is what
 * keeps ADR 0002's rule closed here: the picker offers two models, Haiku is on
 * neither list, and a hand-crafted request naming it is refused before anything
 * is written rather than left to a check further in.
 */
export function parseGenerationForm(value: unknown): GenerationForm | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;

  const topic = asString(body.topic);
  const wishes = asString(body.wishes) ?? '';
  const vocabulary = asStringArray(body.vocabulary);
  const kindMix = parseKindMix(body.kindMix);
  const effort = parseEffort(body.effort);
  const model = asString(body.model);

  if (topic === null || vocabulary === null || kindMix === null || !effort.ok) return null;
  if (model === null || !(AUTHOR_MODELS as readonly string[]).includes(model)) return null;
  // Not range-checked here: how many Exercises are workable is the Author's
  // contract's rule, and it is reported as a fault an Admin can read rather than
  // as a body nobody can see.
  if (typeof body.exerciseCount !== 'number') return null;

  const continueFrom = body.continueFromLessonId;
  if (continueFrom !== null && continueFrom !== undefined && !Number.isInteger(continueFrom)) return null;

  return {
    topic,
    vocabulary,
    exerciseCount: body.exerciseCount,
    kindMix,
    wishes,
    continueFromLessonId: (continueFrom as number | null | undefined) ?? null,
    model,
    ...(effort.effort === undefined ? {} : { effort: effort.effort }),
  };
}

// --- Refinement --------------------------------------------------------------

export type RefinementForm = {
  /** The document as the editor has it right now, hand edits included. */
  document: LessonDocument;
  message: string;
  /** The Draft the conversation is being continued from, or null. */
  fromDraftId: number | null;
  model: string;
  effort?: Effort;
};

/**
 * One turn as it arrives over the wire, or null if the body is not that shape.
 *
 * The document is parsed by the same function a save goes through, because it is
 * the same thing: whatever is in the editor at this moment, hand edits included.
 * A turn that shaped it differently would be a second definition of what a Lesson
 * is, and the two would drift.
 */
export function parseRefinementForm(value: unknown): RefinementForm | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;

  const document = parseLessonDocument(body.document);
  const message = asString(body.message);
  const effort = parseEffort(body.effort);
  const model = asString(body.model);

  if (document === null || message === null || !effort.ok) return null;
  if (model === null || !(AUTHOR_MODELS as readonly string[]).includes(model)) return null;

  const from = body.fromDraftId;
  if (from !== null && from !== undefined && !Number.isInteger(from)) return null;

  return {
    document,
    message,
    fromDraftId: (from as number | null | undefined) ?? null,
    model,
    ...(effort.effort === undefined ? {} : { effort: effort.effort }),
  };
}
