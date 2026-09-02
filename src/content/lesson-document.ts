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

import {
  EXERCISE_KINDS, answersAreChoices, exerciseFaults, gapsOf, isBlank, isDeterministic, offersChoices,
  type AcceptedAnswers, type AuthoredExercise, type ExerciseFaultCode, type ExerciseKind,
} from './exercise-validity.ts';

/**
 * The accepted answers copied Gap by Gap, so an edit to one document cannot
 * reach into the one it was made from.
 */
function copyAccepted(accepted: AcceptedAnswers | undefined): string[][] {
  return (accepted ?? []).map((values) => [...values]);
}

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

export const DOCUMENT_FAULTS = [
  'title_empty', 'grammar_focus_empty', 'theory_empty', 'duplicate_exercise_id',
] as const;
export type DocumentFaultCode = (typeof DOCUMENT_FAULTS)[number];

export type DocumentFault = {
  code: DocumentFaultCode | ExerciseFaultCode;
  /** Present when the fault is about one Exercise rather than the Lesson itself. */
  exercisePosition?: number;
  offending?: string;
};

/**
 * Every reason this document is not publishable, or an empty array.
 *
 * A Practice with no Exercises is not one of them: a Lesson whose Exercises have
 * not been written yet is an ordinary state while authoring, and the Practice
 * screen already says so in Russian rather than breaking.
 */
export function documentFaults(document: LessonDocument): DocumentFault[] {
  const faults: DocumentFault[] = [];

  if (isBlank(document.title)) faults.push({ code: 'title_empty' });
  // Not cosmetic: design.md § Grading hands the grammar focus to the Grader on
  // every call, so a blank one silently removes context from every Submission
  // made in this Lesson.
  if (isBlank(document.grammarFocus)) faults.push({ code: 'grammar_focus_empty' });
  if (isBlank(document.theoryMarkdown)) faults.push({ code: 'theory_empty' });

  // Two entries claiming the same Exercise row would both be written to it, and
  // the second would win: two Exercises in the document, one row in the Practice,
  // no complaint. Nothing can produce this today — the document is composed on
  // the server — but the Exercise forms are what will, so it is refused here
  // rather than discovered as a Practice that silently lost an Exercise.
  const claimed = new Set<number>();
  document.exercises.forEach((exercise, index) => {
    if (exercise.id !== undefined) {
      if (claimed.has(exercise.id)) {
        faults.push({ code: 'duplicate_exercise_id', exercisePosition: index + 1 });
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
 * The faults that are about one Exercise rather than about the Lesson itself.
 *
 * The two are treated differently on the way in: a Lesson missing its Theory is
 * an ordinary state halfway through writing one and is refused only at publish,
 * while an incoherent Exercise never reaches a Draft at all. An Exercise is a
 * thing an author finishes before moving on, and a Draft full of half-Exercises
 * is a Draft that cannot be published and cannot say why without being read
 * whole.
 */
export function exerciseLevelFaults(faults: readonly DocumentFault[]): DocumentFault[] {
  return faults.filter((fault) => fault.exercisePosition !== undefined);
}

/**
 * The same Exercise under a different Kind, carrying across only what the new
 * Kind uses.
 *
 * Changing a Kind and leaving the old fields behind is the mistake the validity
 * rules were written for — a composition still holding the options of the
 * multiple choice it used to be. The form could rely on being told off, but
 * silently dropping what the new Kind cannot use is better than refusing a save
 * over a field the author cannot see any more.
 */
export function withKind(exercise: DocumentExercise, kind: ExerciseKind): DocumentExercise {
  // A multiple choice's answers *are* its options; every other Kind's are typed
  // out. Nothing crosses that line in either direction, because nothing means
  // the same on both sides of it: an option label is not a word-order sentence,
  // and a typed answer is not among options nobody has written yet.
  //
  // Getting this wrong is not a tidiness matter. Carrying a multiple choice's
  // options into a word order hands it three fragments its accepted answer
  // cannot tile, which raises `fragments_do_not_build_answer` and blocks the
  // save — leaving an Admin stuck on fields the form never showed them.
  const answersMeanTheSame = answersAreChoices(kind) === answersAreChoices(exercise.kind);

  const keepsAcceptedAnswers = answersMeanTheSame
    && isDeterministic(kind) && isDeterministic(exercise.kind);
  const keepsChoices = answersMeanTheSame
    && offersChoices(kind) && offersChoices(exercise.kind);

  const next: DocumentExercise = {
    ...(exercise.id === undefined ? {} : { id: exercise.id }),
    kind,
    prompt: exercise.prompt,
    referenceAnswer: answersMeanTheSame ? exercise.referenceAnswer : '',
    acceptedAnswers: keepsAcceptedAnswers ? copyAccepted(exercise.acceptedAnswers) : [],
    caseSensitive: isDeterministic(kind) ? exercise.caseSensitive ?? false : false,
    choices: keepsChoices ? [...(exercise.choices ?? [])] : [],
  };

  // Becoming a fill-gap means the prompt now says how many places there are to
  // answer, and a word order's single accepted ordering is not one per gap.
  // Routed through the same function a prompt edit uses, so there is one rule
  // about what a fill-gap's Gaps are rather than two that can disagree —
  // and `discardedByKindChange` asks this function, so the author is warned.
  return next.kind === 'fill_gap' ? withPrompt(next, next.prompt) : next;
}

/**
 * How many filled-in values a Kind change would throw away.
 *
 * A question about Kinds, not about a form: the answer is the same whoever asks
 * it, so it is a pure function over the Exercise and the Kind it is becoming and
 * every pair is tested as a table rather than through a browser. The form asks it
 * and renders the answer.
 *
 * A **count**, not a list of field names. What an author needs to decide is how
 * much of their typing is about to go, and «три заполненных поля» says that;
 * "referenceAnswer, acceptedAnswers, choices" names the implementation and
 * answers a different question.
 *
 * Nought is the important value. A Kind change that discards nothing must apply
 * immediately — a newly added Exercise with empty fields, or a change between two
 * Kinds that use the same fields, such as fill-gap to word order. A confirmation
 * that always appears is one nobody reads, which is worse than none.
 */
export function discardedByKindChange(exercise: DocumentExercise, kind: ExerciseKind): number {
  // Asked of `withKind` rather than re-derived from the Kind properties: what
  // survives a Kind change is that function's rule, and a second copy of it here
  // would be a warning that could disagree with what actually happens.
  const after = withKind(exercise, kind);

  // Held to the same standard the validity rules hold a value to: one that
  // normalises away is absent, so losing it loses nothing.
  const filled = (values: readonly string[] | undefined) => (values ?? []).filter((v) => !isBlank(v)).length;
  // Across every position, because the question is how much typing goes — an
  // author counts answers, not the gaps they were written against.
  const filledAnswers = (accepted: AcceptedAnswers | undefined) => filled((accepted ?? []).flat());

  const lostReference = !isBlank(exercise.referenceAnswer) && isBlank(after.referenceAnswer) ? 1 : 0;
  const lostAnswers = Math.max(0, filledAnswers(exercise.acceptedAnswers) - filledAnswers(after.acceptedAnswers));
  const lostChoices = Math.max(0, filled(exercise.choices) - filled(after.choices));

  return lostReference + lostAnswers + lostChoices;
}

/**
 * The same Exercise under a new prompt, with its accepted answers following the
 * gaps the prompt now has.
 *
 * A fill-gap's prompt is what says how many places there are to answer, so
 * editing it is editing that count. The lists are kept by position and the
 * surplus is dropped — visibly, because the form shows one box per gap and the
 * box goes with the gap. Leaving them would be an Exercise the validity rules
 * refuse over a list the author can no longer see, let alone delete.
 *
 * Every other Kind has one place to answer whatever its prompt says, so nothing
 * about its answers depends on the prompt.
 */
export function withPrompt(exercise: DocumentExercise, prompt: string): DocumentExercise {
  if (exercise.kind !== 'fill_gap') return { ...exercise, prompt };

  const accepted = exercise.acceptedAnswers ?? [];
  return {
    ...exercise,
    prompt,
    acceptedAnswers: Array.from(
      { length: gapsOf(exercise.kind, prompt) },
      (_, at) => [...(accepted[at] ?? [])],
    ),
  };
}

/** An empty Exercise of a Kind, as a form hands one to an author. */
export function blankExercise(kind: ExerciseKind): DocumentExercise {
  return {
    kind,
    prompt: '',
    referenceAnswer: '',
    acceptedAnswers: [],
    caseSensitive: false,
    choices: [],
  };
}

// What the Student is offered and what is judged correct are stored apart, and
// for a multiple choice the second is drawn from the first: an accepted answer
// is one of the options, by value. Editing an option therefore has to carry the
// answers with it, or renaming «an» to «an apple» would leave an Exercise whose
// correct answer is not among its options — the exact fault the validity rules
// exist to catch, produced by the form meant to prevent it.
function rewriteAnswers(exercise: DocumentExercise, from: string, to: string): Partial<DocumentExercise> {
  return {
    referenceAnswer: exercise.referenceAnswer === from ? to : exercise.referenceAnswer,
    acceptedAnswers: (exercise.acceptedAnswers ?? [])
      .map((values) => values.map((answer) => (answer === from ? to : answer))),
  };
}

/** One option or fragment rewritten, and any answer that named it rewritten with it. */
export function renameChoice(exercise: DocumentExercise, index: number, value: string): DocumentExercise {
  const choices = [...(exercise.choices ?? [])];
  const previous = choices[index];
  if (previous === undefined) return exercise;
  choices[index] = value;

  return { ...exercise, choices, ...rewriteAnswers(exercise, previous, value) };
}

/** One option or fragment removed, and any answer that named it removed with it. */
export function removeChoice(exercise: DocumentExercise, index: number): DocumentExercise {
  const choices = [...(exercise.choices ?? [])];
  const [removed] = choices.splice(index, 1);
  if (removed === undefined) return exercise;

  return {
    ...exercise,
    choices,
    referenceAnswer: exercise.referenceAnswer === removed ? '' : exercise.referenceAnswer,
    acceptedAnswers: (exercise.acceptedAnswers ?? [])
      .map((values) => values.filter((answer) => answer !== removed)),
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * A list of short strings as a form sends it.
 *
 * Blank entries are dropped, because a value that normalises away is absent —
 * the same rule the validity checks already apply when they judge one. It is
 * applied here so the form does not have to apply it while someone is typing: a
 * trailing newline is how a second answer gets started, and an empty option is
 * how one gets added before it is written.
 */
function asStringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((item) => typeof item === 'string')) return null;
  return (value as string[]).filter((item) => item.trim() !== '');
}

/**
 * The accepted answers as they arrive: one list of short strings per Gap.
 *
 * Blank entries go the same way `asStringArray` drops them, and for the same
 * reason. An empty one is **kept**: a Gap nobody has written an answer for yet
 * is a real thing an author can produce, and dropping it would turn an Exercise
 * that is refused by name into one whose Gaps silently stopped matching its
 * prompt.
 */
function asAcceptedAnswers(value: unknown): string[][] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const gaps: string[][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || !entry.every((item) => typeof item === 'string')) return null;
    gaps.push((entry as string[]).filter((item) => item.trim() !== ''));
  }
  return gaps;
}

/**
 * One Exercise as a form sends it, or null if it is not that shape at all.
 *
 * Exported because a Test's Exercises arrive in exactly this shape and are
 * judged by exactly these rules — a second copy would be a second place for the
 * id-preserving rule below to be got wrong, and losing an id turns an edit into a
 * delete-and-reinsert that takes a Student's Submissions with it.
 */
export function parseDocumentExercise(value: unknown): DocumentExercise | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;

  const kind = body.kind;
  if (typeof kind !== 'string' || !(EXERCISE_KINDS as readonly string[]).includes(kind)) return null;

  const prompt = asString(body.prompt);
  const referenceAnswer = asString(body.referenceAnswer);
  const acceptedAnswers = asAcceptedAnswers(body.acceptedAnswers);
  const choices = asStringArray(body.choices);
  if (prompt === null || referenceAnswer === null || acceptedAnswers === null || choices === null) return null;

  if (body.caseSensitive !== undefined && typeof body.caseSensitive !== 'boolean') return null;
  // An id that is not a whole number never named a row. Refused as a shape
  // failure rather than dropped, because dropping it would turn an edit of an
  // existing Exercise into a delete-and-reinsert, taking its Submissions with it.
  if (body.id !== undefined && !Number.isInteger(body.id)) return null;

  return {
    ...(body.id === undefined ? {} : { id: body.id as number }),
    kind: kind as ExerciseKind,
    prompt,
    referenceAnswer,
    acceptedAnswers,
    caseSensitive: (body.caseSensitive as boolean | undefined) ?? false,
    choices,
  };
}

/**
 * A whole Lesson document as it arrives over the wire, or null if the body is
 * not that shape at all.
 *
 * Shaping, not judging — the same split `parseLessonTheory` makes. An Exercise
 * with an empty prompt parses fine and is then reported as a fault the Admin can
 * read; an Exercise whose Kind is a word nobody has heard of is a shape failure,
 * because there is no form to show it in.
 */
export function parseLessonDocument(value: unknown): LessonDocument | null {
  const theory = parseLessonTheory(value);
  if (theory === null) return null;

  const body = value as Record<string, unknown>;
  const raw = body.exercises;
  if (raw !== undefined && !Array.isArray(raw)) return null;

  const exercises: DocumentExercise[] = [];
  for (const entry of (raw ?? []) as unknown[]) {
    const exercise = parseDocumentExercise(entry);
    if (exercise === null) return null;
    exercises.push(exercise);
  }

  return { ...theory, exercises };
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
