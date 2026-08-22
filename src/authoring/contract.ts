// The Author's contract: structured inputs in, a Lesson document out.
//
// The half of Generation that can be tested without a model — the same split the
// Grader made, and for the same reason: what a live model cannot be made to
// produce on demand is testable directly only if it lives apart from the call
// that produces it. A refusal, a fenced answer, a Lesson that came back with
// seven multiple choices when four were asked for — none of those can be ordered
// up from a real call, and all of them are ordinary values here.
//
// Two things live here. First, the prompt an Admin's structured inputs become.
// Second, the parse: whatever text comes back becomes a Lesson document — the
// shape ADR 0004 settled and the Draft already stores — or a refusal that says
// why.
//
// **The faults are the ones that already exist.** An Exercise Claude writes is
// judged by exactly the validity rules an Exercise an Admin types is judged by,
// reported as the same stable codes and resolved to Russian through the same
// dictionary. A second vocabulary for "this multiple choice's Reference Answer is
// not among its options" would be a second thing to keep in step with the
// Deterministic Check.
//
// This module calls nothing. No SDK import and no database import, asserted by a
// test rather than left to convention.

import { extractJsonObject, type Language } from '../grader/contract.ts';
import {
  EXERCISE_KINDS, answersAreChoices, isBlank, isDeterministic, offersChoices,
  type ExerciseKind,
} from '../content/exercise-validity.ts';
import {
  documentFaults, parseLessonDocument,
  type DocumentFault, type LessonDocument,
} from '../content/lesson-document.ts';

// --- What an Admin asks for --------------------------------------------------

/** How many of each Kind the Lesson should contain. Absent means "no preference". */
export type KindMix = Partial<Record<ExerciseKind, number>>;

/**
 * An earlier Lesson, as context — a value, never a query. Reading the Course is
 * the caller's job; what belongs here is the decision about what such context
 * costs and how much of it is worth carrying.
 */
export type EarlierLesson = {
  title: string;
  grammarFocus: string;
  /** A bounded extract of the Theory, never the whole of it. */
  summary: string;
};

export type GenerationRequest = {
  language: Language;
  level: string;
  topic: string;
  vocabulary: string[];
  exerciseCount: number;
  kindMix: KindMix;
  /** Published Lessons this one continues from, newest last. */
  continueFrom: EarlierLesson[];
  wishes: string;
};

/**
 * The cap on a Lesson's Practice.
 *
 * Not arbitrary at either end: nought Exercises is not a Practice, and past
 * twenty the wait grows without the Lesson getting better — the Kind mix is what
 * makes a Practice useful, not its length.
 */
export const MIN_EXERCISES = 1;
export const MAX_EXERCISES = 20;

/**
 * How much earlier-Lesson context is worth paying for.
 *
 * The whole finding of the spike was about how much context costs: stripping
 * 8-11k tokens of harness prompt was worth 2-3× the wall time, and carrying
 * every word of every earlier Theory would put it straight back. Three Lessons
 * of a few hundred characters each is enough for "do not teach the article
 * again" and cheap enough not to notice.
 */
export const MAX_EARLIER_LESSONS = 3;
export const EARLIER_LESSON_SUMMARY_CHARS = 600;

/** The last few published Lessons, bounded, as the prompt should carry them. */
export function earlierLessonContext(
  published: readonly { title: string; grammarFocus: string; theoryMarkdown: string }[],
): EarlierLesson[] {
  return published.slice(-MAX_EARLIER_LESSONS).map((lesson) => ({
    title: lesson.title,
    grammarFocus: lesson.grammarFocus,
    summary: boundedSummary(lesson.theoryMarkdown),
  }));
}

/**
 * The opening of a Theory, cut at a word boundary.
 *
 * Cut rather than summarised by a second model call: what this context is for is
 * continuity — what has already been taught — and the first few hundred
 * characters of a Theory carry that. Paying for a model call to compress context
 * for a model call is the shape of thing that looks clever and costs twice.
 */
export function boundedSummary(theoryMarkdown: string): string {
  const flat = theoryMarkdown.replace(/\s+/g, ' ').trim();
  if (flat.length <= EARLIER_LESSON_SUMMARY_CHARS) return flat;
  const cut = flat.slice(0, EARLIER_LESSON_SUMMARY_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const REQUEST_FAULTS = [
  // A Generation that cannot be asked for.
  'topic_empty', 'exercise_count_out_of_range', 'kind_mix_exceeds_count',
  // A Refinement turn that cannot be asked for. It lives on this list rather
  // than on one of its own because it is the same kind of thing — a request
  // refused before it costs anything — and a second list would be a second place
  // for a code to end up without a Russian sentence behind it.
  'message_empty',
] as const;
export type RequestFaultCode = (typeof REQUEST_FAULTS)[number];

/**
 * Why this request cannot be sent, or an empty array.
 *
 * Checked before the call rather than after it: a Generation is minutes of work,
 * and refusing an impossible request afterwards spends all of them to say
 * something that was knowable at the moment the button was pressed.
 */
export function generationRequestFaults(request: GenerationRequest): RequestFaultCode[] {
  const faults: RequestFaultCode[] = [];

  if (isBlank(request.topic)) faults.push('topic_empty');

  const countIsWorkable = Number.isInteger(request.exerciseCount)
    && request.exerciseCount >= MIN_EXERCISES
    && request.exerciseCount <= MAX_EXERCISES;
  if (!countIsWorkable) faults.push('exercise_count_out_of_range');

  // A mix that asks for more Exercises than the Lesson has is not a preference,
  // it is a contradiction — and one nothing downstream could satisfy.
  //
  // Only asked once the count itself makes sense: "your mix exceeds -3" points
  // an Admin at the mix, and the mix is not what is wrong.
  if (countIsWorkable && askedTotal(request.kindMix) > request.exerciseCount) {
    faults.push('kind_mix_exceeds_count');
  }

  return faults;
}

function askedTotal(mix: KindMix): number {
  return EXERCISE_KINDS.reduce((total, kind) => total + (mix[kind] ?? 0), 0);
}

// --- The prompt --------------------------------------------------------------

const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', tj: 'Tajik' };

/**
 * The per-Kind field rules, written out of the same predicates the validity rules
 * are written out of.
 *
 * Derived rather than typed out, so the prompt cannot drift from what will judge
 * the answer. A prompt that described a rule the validator does not enforce would
 * produce Lessons refused for obeying it.
 */
function kindRules(): string[] {
  return EXERCISE_KINDS.map((kind) => {
    const parts: string[] = [];
    if (offersChoices(kind)) {
      parts.push(kind === 'multiple_choice'
        ? '"choices": at least two options the student picks between'
        : '"choices": the fragments the student arranges, each used exactly once');
    } else {
      parts.push('"choices": []');
    }

    if (isDeterministic(kind)) {
      parts.push(answersAreChoices(kind)
        ? '"acceptedAnswers": one or more entries, each copied EXACTLY from "choices"'
        : '"acceptedAnswers": every wording that is correct, at least one');
      parts.push(kind === 'word_order'
        ? '"referenceAnswer": the canonical ordering, and it must be one of "acceptedAnswers"'
        : '"referenceAnswer": the canonical answer, and it must be one of "acceptedAnswers"');
    } else {
      parts.push('"acceptedAnswers": [] — this Kind is judged by a model, not by comparison');
      parts.push('"referenceAnswer": a model answer, used as context when the student is graded');
    }

    return `  ${kind}\n${parts.map((part) => `    ${part}`).join('\n')}`;
  });
}

/**
 * Passed to the SDK as a plain string, which REPLACES Claude Code's harness
 * prompt rather than adding to it (design.md § Configuration).
 */
export function buildAuthorSystemPrompt(language: Language): string {
  const langName = LANGUAGE_NAMES[language];
  return [
    `You write one lesson for a Russian-speaking student learning ${langName}.`,
    ``,
    `Everything the student reads in their own language is Russian: the lesson title,`,
    `the theory, and every exercise prompt. Answers, options and fragments are in`,
    `${langName}, because they are what the student is learning to produce.`,
    ``,
    `Return ONE JSON object and nothing else. No prose before or after. No markdown fences.`,
    `Emit the fields in exactly this order:`,
    `  "title"           — the lesson's name, in Russian`,
    `  "grammarFocus"    — one short line naming the grammar, in English`,
    `  "theoryMarkdown"  — the explanation, in Russian, as markdown`,
    `  "exercises"       — an array of exercise objects, in the order they are worked through`,
    ``,
    // Not cosmetic: the grammar focus is handed to the Grader on every single
    // Submission made in this Lesson, so a vague one silently weakens grading
    // for every answer a Student ever writes here.
    `"grammarFocus" is given to the model that grades every answer in this lesson.`,
    `Write what a teacher would write on a lesson plan — "Indefinite article with`,
    `countable nouns", not "grammar" and not a sentence.`,
    ``,
    `Every exercise object has exactly these fields:`,
    `  "kind"            — one of the kinds below`,
    `  "prompt"          — the task, in Russian`,
    `  "referenceAnswer" — see the kind`,
    `  "acceptedAnswers" — see the kind`,
    `  "caseSensitive"   — true only where capitalisation is the point of the exercise`,
    `  "choices"         — see the kind`,
    ``,
    `The kinds, and what each one's fields mean:`,
    ...kindRules(),
    ``,
    // Every one of these is a rule the validator enforces, and an Exercise that
    // breaks one is refused rather than stored. Stating them is cheaper than
    // spending a minutes-long call to be told off.
    `Rules that will be checked, and that reject the whole lesson when broken:`,
    `  - answers are compared after trimming, collapsing spaces, ignoring case`,
    `    (unless "caseSensitive"), and dropping a trailing . ! or ?`,
    `  - two accepted answers that compare equal are one answer written twice`,
    `  - a word-order exercise has at most 12 fragments, and every accepted ordering`,
    `    must use every fragment exactly once`,
    `  - no field is empty except where a kind says it is []`,
  ].join('\n');
}

export function buildAuthorPrompt(request: GenerationRequest): string {
  const parts = [
    `Level: ${request.level}`,
    `Topic: ${request.topic}`,
  ];

  if (request.vocabulary.length > 0) {
    parts.push(`Vocabulary the lesson must teach:`, ...request.vocabulary.map((word) => `  - ${word}`));
  }

  parts.push(``, `Write exactly ${request.exerciseCount} exercises.`);

  const asked = EXERCISE_KINDS
    .filter((kind) => (request.kindMix[kind] ?? 0) > 0)
    .map((kind) => `  ${request.kindMix[kind]} × ${kind}`);
  if (asked.length > 0) {
    // design.md § Authoring: an explicit control because generation over-produces
    // multiple choice — the cheapest Kind to write and the least useful to learn
    // from. So it is asked for as counts, and what comes back is counted.
    parts.push(`Of those, exactly:`, ...asked);
    const remainder = request.exerciseCount - askedTotal(request.kindMix);
    if (remainder > 0) parts.push(`  the remaining ${remainder} are yours to choose.`);
  }

  if (request.continueFrom.length > 0) {
    parts.push(
      ``,
      `This lesson continues a course. The student has already worked through these,`,
      `oldest first — do not teach them again, and build on them where it helps:`,
    );
    for (const lesson of request.continueFrom) {
      parts.push(
        `  ${lesson.title} — ${lesson.grammarFocus}`,
        `    ${lesson.summary}`,
      );
    }
  }

  if (!isBlank(request.wishes)) {
    // Fenced as data for the reason design.md § Security fences a Student's
    // answer: it is a box someone types prose into, and prose that reads like an
    // instruction is still prose.
    parts.push(``, `Additional wishes from the author, between the tags. Follow them where`,
      `they do not conflict with the rules above:`,
      `<wishes>`, request.wishes, `</wishes>`);
  }

  return parts.join('\n');
}

/**
 * One turn of the conversation over an existing Draft.
 *
 * **The whole document goes over, and the whole document comes back.** ADR 0004
 * settles this against server-side mutation through tool calls: Drafts are
 * small, full-document exchange eliminates an entire class of partial-mutation
 * bugs, and it makes every turn a restorable version for free.
 *
 * It also means the document is in the prompt whether or not the conversation
 * was resumed — which is what lets a lost session degrade to a fresh one that
 * still knows the Lesson. Resuming is an optimisation for continuity, never a
 * requirement for correctness.
 *
 * The Admin's request is delimited but **not** fenced as never-to-be-followed,
 * unlike a Student's answer or the wishes box: it is an instruction from the
 * person authoring the Lesson, and following it is the entire point.
 */
export function buildRefinementPrompt(document: LessonDocument, message: string): string {
  return [
    `Here is the lesson as it stands right now. It includes any edits its author`,
    `has made by hand since your last turn, so treat it as the truth rather than`,
    `anything you remember writing.`,
    ``,
    JSON.stringify(document, null, 2),
    ``,
    `The author asks for this change:`,
    `<request>`,
    message,
    `</request>`,
    ``,
    `Return the WHOLE lesson again, in the same JSON shape, with that change made`,
    `and everything else left as it is. Do not return a patch, a fragment, or a`,
    `description of what you changed.`,
  ].join('\n');
}

// --- The parse ---------------------------------------------------------------

export const AUTHOR_REFUSALS = [
  'no_document', 'field_missing', 'unknown_exercise_kind', 'malformed_exercise',
] as const;
export type AuthorRefusalCode = (typeof AUTHOR_REFUSALS)[number];

export type AuthorRefusal = {
  code: AuthorRefusalCode;
  /** The field or value at fault, where one is nameable. */
  offending?: string;
  /** What came back, kept as evidence. Never rendered as a Lesson. */
  raw: string;
};

export type ParsedLesson =
  | { ok: true; document: LessonDocument; wasFenced: boolean }
  // Never a partial document: half a Lesson is not a Lesson, and an Admin must
  // never be left unsure whether what they are reading came from Claude or was
  // already on the screen.
  | { ok: false; refusal: AuthorRefusal };

/**
 * Whatever came back, as a Lesson document or as a refusal that says why.
 *
 * The shape decision belongs to `parseLessonDocument` — the same function the
 * editor's saves go through, so a generated document is admitted on exactly the
 * terms a typed one is. What is added here is the explanation: that function
 * answers yes or no, and an Admin who has just waited two minutes deserves to be
 * told which field was missing.
 */
export function parseGeneratedLesson(raw: string): ParsedLesson {
  const extracted = extractJsonObject(raw);
  if (!extracted.ok) return { ok: false, refusal: { code: 'no_document', raw: extracted.raw } };

  const document = parseLessonDocument(extracted.value);
  if (document === null) {
    return { ok: false, refusal: { ...explainShapeFailure(extracted.value), raw: extracted.raw } };
  }

  return { ok: true, document, wasFenced: extracted.wasFenced };
}

/**
 * Which part of a value `parseLessonDocument` turned down.
 *
 * An explainer, not a second judge: it runs only once the parse has already said
 * no, and its fallback is a refusal rather than an acceptance, so it can make a
 * message worse but never let a document through.
 */
function explainShapeFailure(value: unknown): { code: AuthorRefusalCode; offending?: string } {
  // Unreachable through `extractJsonObject`, which slices from a `{` to a `}` and
  // so only ever yields an object or nothing at all. Kept as the honest answer
  // rather than as a fault code of its own: an entry in the dictionary for a
  // sentence nobody can ever read is a sentence that will never be reviewed.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { code: 'no_document' };
  }

  const body = value as Record<string, unknown>;
  for (const field of ['title', 'grammarFocus', 'theoryMarkdown'] as const) {
    if (typeof body[field] !== 'string') return { code: 'field_missing', offending: field };
  }

  const raw = body.exercises;
  if (raw !== undefined && !Array.isArray(raw)) return { code: 'field_missing', offending: 'exercises' };

  for (const [index, entry] of ((raw ?? []) as unknown[]).entries()) {
    const at = String(index + 1);
    if (typeof entry !== 'object' || entry === null) {
      return { code: 'malformed_exercise', offending: at };
    }

    // Named apart from the rest: a Kind nobody has heard of is the one shape
    // failure with an obvious cause, and saying which word it was is the
    // difference between a report and a shrug.
    const kind = (entry as Record<string, unknown>).kind;
    if (typeof kind !== 'string' || !(EXERCISE_KINDS as readonly string[]).includes(kind)) {
      return { code: 'unknown_exercise_kind', offending: typeof kind === 'string' ? kind : at };
    }

    // Which entry the parse turned down, asked of the parse itself one Exercise
    // at a time, so this stays an explainer rather than becoming a second copy
    // of the field rules that could disagree with the first.
    if (parseLessonDocument({ title: '', grammarFocus: '', theoryMarkdown: '', exercises: [entry] }) === null) {
      return { code: 'malformed_exercise', offending: at };
    }
  }

  return { code: 'malformed_exercise' };
}

// --- What was asked for against what came back -------------------------------

export type MixMismatch =
  | { code: 'exercise_count_mismatch'; asked: number; produced: number }
  | { code: 'kind_mix_mismatch'; kind: ExerciseKind; asked: number; produced: number };

/**
 * Where the Lesson that came back differs from the one that was asked for.
 *
 * Reported rather than refused, and the two are deliberately different. An
 * incoherent Exercise must never reach a Draft — nothing downstream can repair
 * a multiple choice whose Reference Answer is not among its options. A Lesson
 * with five multiple choices where four were asked for is a whole, coherent,
 * publishable Lesson that is not quite what was ordered, and throwing away
 * minutes of work over it would be worse than saying so.
 *
 * It is said, though. design.md § Authoring makes the Kind mix an explicit
 * control because generation over-produces multiple choice, and a control whose
 * result nobody checks is not a control.
 */
export function mixMismatches(
  document: LessonDocument,
  request: GenerationRequest,
): MixMismatch[] {
  const mismatches: MixMismatch[] = [];

  if (document.exercises.length !== request.exerciseCount) {
    mismatches.push({
      code: 'exercise_count_mismatch',
      asked: request.exerciseCount,
      produced: document.exercises.length,
    });
  }

  for (const kind of EXERCISE_KINDS) {
    const asked = request.kindMix[kind] ?? 0;
    if (asked === 0) continue;
    const produced = document.exercises.filter((exercise) => exercise.kind === kind).length;
    if (produced !== asked) mismatches.push({ code: 'kind_mix_mismatch', kind, asked, produced });
  }

  return mismatches;
}

// --- The whole judgement -----------------------------------------------------

export type GenerationCheck = {
  /** Reasons no Draft may be written. Empty means the document is storable. */
  faults: DocumentFault[];
  /** Facts about what came back. Never a reason to throw the Lesson away. */
  mismatches: MixMismatch[];
};

// A *check*, not a review. The word "review" is spoken for in this codebase: it
// means the thing a person does before a Lesson reaches a Student, which no rule
// here can do — a Reference Answer that is fluent, plausible and wrong passes
// every check below. See authoring/review.ts.

/**
 * Everything wrong with a generated Lesson, split by what it costs.
 *
 * The faults are the existing validity rules, unchanged and reported as the
 * existing stable codes — including the Lesson-level ones. Saving a hand-typed
 * Draft tolerates a missing Theory because that is an ordinary state halfway
 * through writing one; a Generation that came back without a Theory is not
 * halfway through anything, it is a failed Generation.
 */
export function checkGeneratedLesson(
  document: LessonDocument,
  request: GenerationRequest,
): GenerationCheck {
  return { faults: documentFaults(document), mismatches: mixMismatches(document, request) };
}
