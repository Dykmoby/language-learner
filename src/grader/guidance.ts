// The one block of the Grader's system prompt an Admin can edit — issue #79,
// ADR 0006.
//
// How the Grader judges — how strict to be, what to let pass — was settled in
// code and could only be changed by editing a source file and redeploying. It is
// the part of the prompt most likely to want tuning and the least dangerous to
// touch, so it is the part that moves into the database.
//
// What stays in code is everything the parser and the security rule stand on:
// the JSON contract and its field order, the Error Type list, the `span` rule,
// and the block that fences a Student's answer as data. ADR 0006 records where
// that line is drawn and why. One bad edit to the contract would fail every
// Submission in the application, for both Courses at once, and present as
// "Claude broke".
//
// Absent and empty are different. No row is "never edited", and reads as the
// text shipped below; a row holding '' is a deliberate "nothing beyond the
// skeleton". That is what makes «Вернуть исходный текст» a delete rather than a
// write of remembered text — the default has exactly one home, here.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { graderGuidance, students } from '../db/schema.ts';

type Db = BetterSQLite3Database<typeof schema>;

// One row or none, and the key is fixed rather than looked up: a second row
// would be a second answer to a question with one.
const ROW_ID = 1;

/**
 * What ships in the code, and what «Вернуть исходный текст» restores.
 *
 * These are the lines that were in the system prompt before this was editable:
 * one about inventing errors, and issue #78's about typography. Both are
 * requests to the model rather than guarantees — #78's guarantee is the server
 * dropping the Error Type, and it holds whatever an Admin does to this text.
 */
export const SHIPPED_GUIDANCE = [
  `Do not invent errors that are not there.`,
  ``,
  `Capitalisation of the first word, a missing or extra full stop at the end, and`,
  `stray whitespace are typography, not language. Report them as "typography" and`,
  `never as "punctuation" or "capitalization". A missing comma inside a sentence IS`,
  `"punctuation", and a proper noun written in lower case IS "capitalization".`,
].join('\n');

// Long enough for several paragraphs of instruction, short enough that nobody
// pastes a Lesson into it. The bound is on the stored text, so an over-long
// guidance can never reach a prompt rather than being trimmed on the way in.
export const GUIDANCE_MAX_LENGTH = 4000;

/** Every code this can report, so the Russian dictionary can be checked against it. */
export const GUIDANCE_FAULTS = ['guidance_too_long'] as const;

/** Every reason the text is refused, reported at once — the repo's form idiom. */
export function guidanceFaults(text: string): string[] {
  return text.length > GUIDANCE_MAX_LENGTH ? ['guidance_too_long'] : [];
}

export type GuidanceStanding = {
  text: string;
  /** True while no Admin has edited it — the text below is the shipped one. */
  isShipped: boolean;
  editedBy: string | null;
  editedAt: Date | null;
};

/**
 * What the Grader is told, and where it came from.
 *
 * The provenance is beside the text rather than fetched separately because the
 * screen that shows one always shows the other, and a Grader that starts judging
 * differently is a question somebody will ask.
 */
export function guidanceStanding(db: Db): GuidanceStanding {
  // Left, not inner: the author's account may since have been deleted, and an
  // inner join would then report the edited guidance as the shipped one — the
  // Grader would be handed the text on the screen while a different text was in
  // the database. The edit is what matters; the name beside it is a courtesy.
  const row = db.select({ guidance: graderGuidance.guidance, updatedAt: graderGuidance.updatedAt, username: students.username })
    .from(graderGuidance)
    .leftJoin(students, eq(students.id, graderGuidance.updatedBy))
    .where(eq(graderGuidance.id, ROW_ID))
    .get();

  if (row === undefined) {
    return { text: SHIPPED_GUIDANCE, isShipped: true, editedBy: null, editedAt: null };
  }
  return { text: row.guidance, isShipped: false, editedBy: row.username ?? null, editedAt: row.updatedAt };
}

/** What goes into a prompt. The Grader has no use for who wrote it. */
export function currentGuidance(db: Db): string {
  return guidanceStanding(db).text;
}

export type GuidanceSaveOutcome =
  | { ok: true; standing: GuidanceStanding }
  | { ok: false; faults: string[] };

export function saveGuidance(db: Db, text: string, adminId: number): GuidanceSaveOutcome {
  const faults = guidanceFaults(text);
  if (faults.length > 0) return { ok: false, faults };

  // An upsert onto the fixed key: whether this is the first edit or the
  // hundredth is not something a caller should have to know, and there is no
  // version history for a second row to be part of.
  db.insert(graderGuidance)
    .values({ id: ROW_ID, guidance: text, updatedBy: adminId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: graderGuidance.id,
      set: { guidance: text, updatedBy: adminId, updatedAt: new Date() },
    })
    .run();

  return { ok: true, standing: guidanceStanding(db) };
}

/**
 * «Вернуть исходный текст» — a delete, not a write of the shipped text.
 *
 * Writing it back would put a copy of the default in the database, and the next
 * change to the constant would leave every restored installation on the old one
 * with nothing to show that it had happened.
 */
export function restoreShippedGuidance(db: Db): GuidanceStanding {
  db.delete(graderGuidance).where(eq(graderGuidance.id, ROW_ID)).run();
  return guidanceStanding(db);
}
