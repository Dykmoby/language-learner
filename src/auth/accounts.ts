// Accounts: making one, removing one, and changing the password on one.
//
// Until this module existed the only way an account came into being was the seed
// script, which says of itself that "account creation is deliberately not a web
// surface at all". That was true and is no longer: the script can only make the
// accounts it was written with, and an Admin who wants a third person studying
// here had to sit down at the Pi with a shell.
//
// What has *not* changed is why the script said it. There is still no
// registration route: nobody makes an account for themselves, and every account
// here is made by an Admin who then hands over a Temporary Password. The two
// screens in front of this module are inside the Admin section, behind its
// guard.
//
// Nothing here checks who is asking — the Admin narrowing happens once, at the
// page or the endpoint, the same way the rest of the section does it. The one
// exception is deliberate and is not a guard: `deleteStudent` is *told* who is
// acting, because "you cannot delete yourself" is a rule about the act rather
// than about permission to perform it.
//
// Refusals are reported as stable codes, the same split the rest of the
// application makes: the Russian wording is resolved from the central dictionary
// at display time, and every reason is reported at once rather than one per
// attempt.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { students, loginThrottle, type StudentRow } from '../db/schema.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { newTemporaryPassword } from './temporary-password.ts';
import { deleteOtherSessions } from './session.ts';

type Db = BetterSQLite3Database<typeof schema>;

export const ACCOUNT_FAULTS = [
  'username_empty',
  'username_too_long',
  'username_has_space',
  'username_taken',
  'account_not_found',
  'cannot_delete_self',
  'cannot_delete_admin',
  'password_too_short',
  'password_mismatch',
  'password_unchanged',
  'current_password_wrong',
] as const;
export type AccountFaultCode = (typeof ACCOUNT_FAULTS)[number];

type Refused = { ok: false; faults: AccountFaultCode[] };

// --- Usernames ---------------------------------------------------------------

// Long enough for a name, short enough to fit a sign-in field and a header.
// Nothing downstream breaks at 33 characters; the limit exists so the value is
// bounded before it is stored, rather than because something measured it.
export const USERNAME_MAX_LENGTH = 32;

/**
 * Every reason a string cannot be a username, or an empty array.
 *
 * Deliberately not an alphabet. The interface is Russian and the two Languages
 * taught are written in Latin and in Cyrillic, so a rule of `[a-z0-9]` would
 * refuse a person their own name for the convenience of a regular expression.
 * What is refused is what actually goes wrong: nothing at all, something that
 * will not fit, and a space — which is invisible at both ends of the exchange
 * and turns "sign in as Anna Petrova" into a wrong password nobody can explain.
 */
export function usernameFaults(raw: string): AccountFaultCode[] {
  const username = raw.trim();
  const faults: AccountFaultCode[] = [];
  if (username === '') faults.push('username_empty');
  if (username.length > USERNAME_MAX_LENGTH) faults.push('username_too_long');
  if (/\s/.test(username)) faults.push('username_has_space');
  return faults;
}

// --- Passwords ---------------------------------------------------------------

/**
 * The shortest password this application accepts.
 *
 * Eight, and the reasoning is worth writing down because eight is otherwise
 * indefensible. Guessing at the sign-in screen is not the threat: five failures
 * lock the account for fifteen minutes, keyed by username, and the lockout
 * survives a restart. The threat is a stolen copy of the database file, and what
 * answers that is argon2id rather than a longer minimum. So the floor is set
 * where it stops the passwords that are not passwords, and the strength that
 * matters is bought elsewhere.
 *
 * The Russian message names this number, and a test asserts the two agree.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Every reason a new password cannot be accepted, or an empty array.
 *
 * `password_unchanged` is here rather than in the caller because it means
 * something different for each of the two ways this is reached. A Student
 * choosing a new password over their own old one has simply not changed
 * anything; a Student replacing a Temporary Password by typing it back in has
 * left an account whose password somebody else knows exactly as it was, which is
 * the one outcome the whole Temporary Password mechanism exists to prevent.
 */
export function newPasswordFaults(
  next: string,
  options: { current: string; confirmation: string },
): AccountFaultCode[] {
  const faults: AccountFaultCode[] = [];
  if (next.length < MIN_PASSWORD_LENGTH) faults.push('password_too_short');
  if (next !== options.confirmation) faults.push('password_mismatch');
  if (next === options.current) faults.push('password_unchanged');
  return faults;
}

// --- Creating a Student ------------------------------------------------------

export type CreateStudentResult =
  /**
   * The Temporary Password is returned **once**, in the only form it will ever
   * exist in: the stored hash cannot produce it again, and nothing writes it
   * anywhere. If the Admin closes the screen without reading it, the account
   * needs deleting and making again — which is a worse outcome than storing it
   * would be for exactly one person, and a better one for the account.
   */
  | { ok: true; student: StudentRow; temporaryPassword: string }
  | Refused;

/**
 * A new Student, with a Temporary Password its owner must replace at first
 * sign-in.
 *
 * Never an Admin. The role is granted by the seed script and by nothing else,
 * and that is not an omission to be filled in later: a button that creates an
 * account able to author, delete other accounts and read every Course is a
 * button that only ever needed pressing once, and it was pressed at seed time.
 * An Admin who needs a second Admin has a shell.
 */
export async function createStudent(db: Db, input: { username: string }): Promise<CreateStudentResult> {
  const faults = usernameFaults(input.username);
  const username = input.username.trim();

  // Checked before the hash, because argon2 is expensive on a Pi and a taken
  // username is the common refusal.
  if (faults.length === 0 && db.select().from(students).where(eq(students.username, username)).get()) {
    faults.push('username_taken');
  }
  if (faults.length > 0) return { ok: false, faults };

  const temporaryPassword = newTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  // Between the check above and this insert there is a window, and the unique
  // index rather than the check is what actually closes it. With one Admin the
  // window is theoretical; the index is what makes saying so safe.
  const student = db.insert(students).values({
    username,
    passwordHash,
    isAdmin: false,
    passwordIsTemporary: true,
    currentCourseId: null,
    createdAt: new Date(),
  }).returning().get();

  return { ok: true, student, temporaryPassword };
}

// --- Deleting a Student ------------------------------------------------------

export type DeleteStudentResult = { ok: true; username: string } | Refused;

/**
 * Removes a Student and everything that was theirs.
 *
 * This is a genuinely destructive act and it is not softened into an archive
 * flag. Every Enrollment, Submission, Error, Test Attempt, Dispute and session
 * of theirs goes with the row, by the cascades the schema already declares — the
 * screen says so before the button is pressed. What survives is what was never
 * theirs alone: a Draft they wrote and a Dispute they resolved keep their text
 * and lose their author, because losing an account must not take a Lesson with
 * it.
 *
 * Two accounts cannot be deleted here, and both refusals are about the same
 * thing — an application with nobody who can author is an application with no
 * way back:
 *
 *   - yourself, which is the mis-click this exists to catch; and
 *   - any Admin, including one who is not you. The role is granted by the seed
 *     script, so an Admin deleted here cannot be restored from inside the
 *     application at all. Whoever genuinely means it has the same shell that
 *     granted the role.
 */
export function deleteStudent(
  db: Db,
  input: { studentId: number; actingStudentId: number },
): DeleteStudentResult {
  const student = db.select().from(students).where(eq(students.id, input.studentId)).get();
  if (!student) return { ok: false, faults: ['account_not_found'] };

  // One at a time, in this order: told "you cannot delete yourself" rather than
  // "you cannot delete an Admin", an Admin learns the thing that is actually
  // about them.
  if (student.id === input.actingStudentId) return { ok: false, faults: ['cannot_delete_self'] };
  if (student.isAdmin) return { ok: false, faults: ['cannot_delete_admin'] };

  db.transaction((tx) => {
    tx.delete(students).where(eq(students.id, student.id)).run();
    // The throttle is keyed by username rather than by id — it has to answer for
    // usernames that do not exist — so nothing cascades it away. Left behind, a
    // lockout earned by the deleted account would be inherited by the next
    // account made with the same name, and would present as a correct Temporary
    // Password being refused.
    tx.delete(loginThrottle).where(eq(loginThrottle.username, student.username)).run();
  });

  return { ok: true, username: student.username };
}

// --- Changing a password -----------------------------------------------------

export type ChangePasswordResult = { ok: true } | Refused;

/**
 * A Student replacing their own password — the first sign-in after an Admin
 * handed them a Temporary Password, and any time afterwards they choose to.
 *
 * The current password is required even on the forced first change, where the
 * Student typed it a moment ago at the sign-in screen. That is not ceremony: the
 * screen is reachable by a session, and a session is what an unattended browser
 * hands to whoever sits down next. Knowing the password is what says this is the
 * person whose password it is.
 *
 * Clearing `passwordIsTemporary` is the same write as setting the hash, in one
 * statement, because the two are one fact: the password is no longer one
 * somebody else knows.
 */
export async function changePassword(
  db: Db,
  input: {
    studentId: number;
    currentPassword: string;
    newPassword: string;
    confirmation: string;
    /** The session doing the changing. Every other one of this Student's is dropped. */
    sessionId: string;
  },
): Promise<ChangePasswordResult> {
  const student = db.select().from(students).where(eq(students.id, input.studentId)).get();
  if (!student) return { ok: false, faults: ['account_not_found'] };

  const faults = newPasswordFaults(input.newPassword, {
    current: input.currentPassword,
    confirmation: input.confirmation,
  });

  // Verified after the cheap rules and reported with them, so a Student who
  // mistyped both the old password and the confirmation is told both at once.
  if (!(await verifyPassword(student.passwordHash, input.currentPassword))) {
    faults.push('current_password_wrong');
  }
  if (faults.length > 0) return { ok: false, faults };

  const passwordHash = await hashPassword(input.newPassword);
  db.update(students)
    .set({ passwordHash, passwordIsTemporary: false })
    .where(eq(students.id, student.id))
    .run();

  deleteOtherSessions(db, student.id, input.sessionId);

  return { ok: true };
}
