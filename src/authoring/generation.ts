// Generation, from an Admin's form to a Draft row.
//
// The join between three tested things: the Course this Lesson belongs to, the
// call that writes the Lesson, and the append-only Draft that stores it. It
// exists as a module rather than as a route handler for the reason every seam in
// this codebase does — a route needs a booted application, and this needs only a
// database.
//
// **Nothing is written until the whole Lesson has come back and passed the
// validity rules.** That is what makes "an Admin can abandon a Generation in
// flight, and abandoning it writes nothing" true by construction: there is no
// half-written row to clean up, because there is no row until the end.

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import type { Effort } from '../claude/effort.ts';
import { openDraft, publishedLessonsUpTo, saveDraft } from '../admin/drafts.ts';
import type { LessonDocument } from '../content/lesson-document.ts';
import {
  earlierLessonContext, generationRequestFaults,
  type GenerationRequest, type MixMismatch, type RequestFaultCode,
} from './contract.ts';
import type { GenerationForm } from './form.ts';
import { generateLesson, theorySoFar } from './call.ts';
import { refusalFrame } from './result.ts';
import type { AuthoringResultFrame } from './wire.ts';
import type { StartedAuthoring } from './respond.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type StartedGeneration = StartedAuthoring<RequestFaultCode>;

/**
 * The whole request, assembled from the form and from the Course the Lesson
 * belongs to.
 *
 * The Language and the CEFR level are read here rather than accepted from the
 * browser: a Course is fixed at one level for its whole duration, and a Lesson
 * generated at a level nobody chose would be wrong in a way that reads as fine.
 */
function requestFrom(db: Db, lessonId: number, form: GenerationForm): GenerationRequest | null {
  const open = openDraft(db, lessonId);
  if (open === null) return null;

  const continueFrom = form.continueFromLessonId === null
    ? []
    : earlierLessonContext(publishedLessonsUpTo(db, form.continueFromLessonId));

  return {
    language: open.course.language,
    level: open.course.level,
    topic: form.topic,
    vocabulary: form.vocabulary,
    exerciseCount: form.exerciseCount,
    kindMix: form.kindMix,
    continueFrom,
    wishes: form.wishes,
  };
}

export function startGeneration(
  db: Db,
  input: { lessonId: number; studentId: number; form: GenerationForm },
): StartedGeneration {
  const request = requestFrom(db, input.lessonId, input.form);
  if (request === null) return { ok: false, reason: 'not_found' };

  const faults = generationRequestFaults(request);
  if (faults.length > 0) return { ok: false, reason: 'invalid_request', faults };

  const call = generateLesson({
    request,
    model: input.form.model,
    ...(input.form.effort === undefined ? {} : { effort: input.form.effort }),
  });

  return {
    ok: true,
    deltas: call.deltas,
    decode: theorySoFar,
    abort: call.abort,
    frame: call.result.then((outcome) => {
      if (!outcome.ok) return refusalFrame(outcome.failure);

      return storeGenerated(db, {
        lessonId: input.lessonId,
        studentId: input.studentId,
        document: outcome.document,
        sessionId: outcome.sessionId,
        mismatches: outcome.mismatches,
      });
    }),
  };
}

/**
 * The Draft, appended with origin `generation`.
 *
 * Appended, exactly like a save an Admin typed — and like every Draft, invisible
 * to a Student until somebody publishes it. Generating twice appends twice, and
 * neither overwrites the Draft before it.
 */
function storeGenerated(
  db: Db,
  input: {
    lessonId: number;
    studentId: number;
    document: LessonDocument;
    sessionId: string | null;
    mismatches: MixMismatch[];
  },
): AuthoringResultFrame {
  const saved = saveDraft(db, {
    lessonId: input.lessonId,
    studentId: input.studentId,
    document: input.document,
    origin: 'generation',
    sessionId: input.sessionId,
  });

  // Unreachable: the document has already been through the whole of
  // `documentFaults`, of which saveDraft checks a subset. Reported rather than
  // asserted away, because "cannot happen" and "is not handled" must not be the
  // same line of code — and because a failure that reached a Student as content
  // is exactly what this path exists to prevent.
  if (!saved.ok) {
    return { t: 'result', ok: false, reason: 'invalid', faults: saved.faults, detail: null };
  }

  return {
    t: 'result',
    ok: true,
    draftId: saved.draft.id,
    document: saved.draft.document,
    mismatches: input.mismatches,
    sessionId: input.sessionId,
    // A Generation starts a conversation rather than continuing one, so there is
    // no thread that could have been lost.
    threadLost: false,
  };
}
