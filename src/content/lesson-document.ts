// The Draft's document: a whole Lesson as one value.
//
// ADR 0004 settles the shape. Refinement exchanges the whole Draft each turn
// rather than mutating one server-side through tool calls, because full-document
// exchange eliminates a class of partial-mutation bugs and makes every turn a
// restorable version for free. So a Draft is not a column per field — it is this,
// stored as JSON, and everything a Lesson is lives inside it.
//
// It carries the Exercises even where nothing edits them yet. A document that
// held only Theory would have to be reshaped when the Exercise forms arrive and
// again when Generation does, and every stored Draft would have to be migrated
// with it.
//
// Pure: this is what is checked before a document is stored, and again before it
// is published into the tables a Student reads.

import { exerciseFaults, type AuthoredExercise, type ExerciseFaultCode } from './exercise-validity.ts';

export type DocumentExercise = AuthoredExercise & {
  /**
   * The Exercise row this came from, where it came from one. Carried through
   * every Draft so that publishing can update in place: an Exercise that is
   * deleted and re-inserted takes every Submission made against it with it.
   */
  id?: number;
};

export type LessonDocument = {
  title: string;
  grammarFocus: string;
  theoryMarkdown: string;
  exercises: DocumentExercise[];
};

/** The Theory half — the only half an Admin edits until the Exercise forms land. */
export type LessonTheory = Pick<LessonDocument, 'title' | 'grammarFocus' | 'theoryMarkdown'>;

export const DOCUMENT_FAULTS = ['title_empty', 'grammar_focus_empty', 'theory_empty'] as const;
export type DocumentFaultCode = (typeof DOCUMENT_FAULTS)[number];

export type DocumentFault = {
  code: DocumentFaultCode | ExerciseFaultCode;
  /** Present when the fault is about one Exercise rather than the Lesson itself. */
  exercisePosition?: number;
  offending?: string;
};

function blank(value: string): boolean {
  return value.trim() === '';
}

/**
 * Every reason this document is not publishable, or an empty array.
 *
 * A Practice with no Exercises is not one of them: a Lesson whose Exercises have
 * not been written yet is an ordinary state while authoring, and the Practice
 * screen already says so in Russian rather than breaking.
 */
export function documentFaults(document: LessonDocument): DocumentFault[] {
  const faults: DocumentFault[] = [];

  if (blank(document.title)) faults.push({ code: 'title_empty' });
  // Not cosmetic: design.md § Grading hands the grammar focus to the Grader on
  // every call, so a blank one silently removes context from every Submission
  // made in this Lesson.
  if (blank(document.grammarFocus)) faults.push({ code: 'grammar_focus_empty' });
  if (blank(document.theoryMarkdown)) faults.push({ code: 'theory_empty' });

  document.exercises.forEach((exercise, index) => {
    for (const fault of exerciseFaults(exercise)) {
      faults.push({ ...fault, exercisePosition: index + 1 });
    }
  });

  return faults;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The Theory fields as they arrive over the wire, or null if the body is not
 * that shape at all.
 *
 * Shaping, not judging: an empty title parses fine and is then reported as a
 * fault the Admin can read, rather than as a parse failure that throws away
 * everything else they typed.
 */
export function parseLessonTheory(value: unknown): LessonTheory | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;

  const title = asString(body.title);
  const grammarFocus = asString(body.grammarFocus);
  const theoryMarkdown = asString(body.theoryMarkdown);
  if (title === null || grammarFocus === null || theoryMarkdown === null) return null;

  return { title, grammarFocus, theoryMarkdown };
}
