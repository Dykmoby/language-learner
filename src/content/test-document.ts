// A Test as an author has it: its title, its pass threshold and its Exercises.
//
// The shape a Lesson keeps in a Draft, without the Draft. A Test has no Theory to
// write and no conversation to hold over it, so nothing is versioned here — its
// Exercises are edited in place and saved, and the deliberate act a Test needs is
// the publish. What is shared with a Lesson is the part that matters: the same
// validity rules judge these Exercises, with the same stable codes and the same
// Russian, because an incoherent Exercise is incoherent wherever it was written.
//
// Pure: this is what is checked before a Test is written, and again before it is
// published into the Course a Student reads.

import { exerciseFaults, isBlank, type ExerciseFaultCode } from './exercise-validity.ts';
import { parseDocumentExercise, type DocumentExercise } from './lesson-document.ts';

export type TestDocument = {
  title: string;
  /** Percentage correct an attempt must reach to have passed. */
  passThreshold: number;
  exercises: DocumentExercise[];
};

export const TEST_FAULTS = [
  'test_title_empty',
  'pass_threshold_out_of_range',
  'test_empty',
  'test_duplicate_exercise_id',
] as const;
export type TestFaultCode = (typeof TEST_FAULTS)[number];

export type TestFault = {
  code: TestFaultCode | ExerciseFaultCode;
  /** Present when the fault is about one Exercise rather than the Test itself. */
  exercisePosition?: number;
  offending?: string;
};

/** design.md § Tests: a percentage, defaulting to 80. */
export const DEFAULT_PASS_THRESHOLD = 80;

/**
 * Every reason this Test cannot be saved, or an empty array.
 *
 * A Test with no Exercises is not one of them — that is what a Test looks like a
 * second after it is created, and refusing to save it would mean an Admin could
 * name a Test and then lose the name. It is refused at publish instead, where an
 * empty Test would be a Student opening something they cannot do.
 */
export function testFaults(document: TestDocument): TestFault[] {
  const faults: TestFault[] = [];

  if (isBlank(document.title)) faults.push({ code: 'test_title_empty' });
  // A threshold outside 1..100 is not a stricter or looser Test, it is a Test
  // whose score can never be read against anything.
  if (!Number.isInteger(document.passThreshold)
    || document.passThreshold < 1 || document.passThreshold > 100) {
    faults.push({ code: 'pass_threshold_out_of_range' });
  }

  // Two entries claiming the same Exercise row would both be written to it and
  // the second would win: two Exercises in the form, one row in the Test.
  const claimed = new Set<number>();
  document.exercises.forEach((exercise, index) => {
    if (exercise.id !== undefined) {
      if (claimed.has(exercise.id)) {
        faults.push({ code: 'test_duplicate_exercise_id', exercisePosition: index + 1 });
      }
      claimed.add(exercise.id);
    }

    for (const fault of exerciseFaults(exercise)) {
      faults.push({ ...fault, exercisePosition: index + 1 });
    }
  });

  return faults;
}

/**
 * Every reason this Test cannot be published.
 *
 * The save rules plus the one that only matters here: a Test with no Exercises
 * is nothing to sit down to. Publishing is the moment it becomes something a
 * Student can open, and design.md's rule about an empty published Lesson holds
 * for a Test with no less force.
 */
export function testPublishFaults(document: TestDocument): TestFault[] {
  const faults = testFaults(document);
  if (document.exercises.length === 0) faults.push({ code: 'test_empty' });
  return faults;
}

/**
 * A Test as it arrives over the wire, or null if the body is not that shape.
 *
 * Shaping, not judging — the same split the Lesson document makes. An empty
 * title parses fine and is then reported as a fault the Admin can read, rather
 * than as a parse failure that throws away everything else they typed.
 */
export function parseTestDocument(value: unknown): TestDocument | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;

  if (typeof body.title !== 'string') return null;
  // Not a number at all is a shape failure; a number out of range is a fault an
  // Admin reads, because the form that sent it can show it beside the field.
  if (typeof body.passThreshold !== 'number' || !Number.isFinite(body.passThreshold)) return null;

  const raw = body.exercises;
  if (raw !== undefined && !Array.isArray(raw)) return null;

  const exercises: DocumentExercise[] = [];
  for (const entry of (raw ?? []) as unknown[]) {
    const exercise = parseDocumentExercise(entry);
    if (exercise === null) return null;
    exercises.push(exercise);
  }

  return { title: body.title, passThreshold: body.passThreshold, exercises };
}
