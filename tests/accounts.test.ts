// Seam 2/3 — accounts against a real database, with no HTTP in the way.
//
// Three acts that did not exist before: making an account, removing one, and
// replacing the password on one. What is asserted is what each act is *for* —
// that a new account cannot be used for anything until its Temporary Password is
// gone, that removing an account takes the work with it and leaves the Lessons
// alone, and that the two accounts nobody can remove really cannot be removed.
//
// Nothing here asserts a hash or a session row directly where an observable
// answer exists: `verifyPassword` is how the application itself finds out
// whether a password is a password, so it is how these tests ask.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import {
  students, enrollments, sessions, submissions, lessonDrafts, loginThrottle,
} from '../src/db/schema.ts';
import {
  ACCOUNT_FAULTS, MIN_PASSWORD_LENGTH, USERNAME_MAX_LENGTH,
  createStudent, deleteStudent, changePassword, usernameFaults,
} from '../src/auth/accounts.ts';
import { newTemporaryPassword } from '../src/auth/temporary-password.ts';
import { verifyPassword } from '../src/auth/password.ts';
import { createSession, findSessionStudent } from '../src/auth/session.ts';
import { createCourse, createLesson, enrollStudent, withdrawStudent } from '../src/admin/authoring.ts';
import { saveDraft } from '../src/admin/drafts.ts';
import { everyStudent } from '../src/admin/catalogue.ts';
import { enrolledCourses } from '../src/practice/lessons.ts';
import { ru } from '../src/ru.ts';

const ADMIN_PASSWORD = 'correct horse battery';
const STUDENT_PASSWORD = 'staple monkey trombone';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [
    { username: 'igor', password: ADMIN_PASSWORD, isAdmin: true },
    { username: 'student', password: STUDENT_PASSWORD, isAdmin: false },
  ]);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

type Db = ReturnType<typeof freshDatabase>['db'];

const byName = (db: Db, username: string) =>
  db.select().from(students).where(eq(students.username, username)).get();

const admin = (db: Db) => byName(db, 'igor')!;

async function newAccount(db: Db, username: string) {
  const created = await createStudent(db, { username });
  if (!created.ok) throw new Error(`the account was refused: ${created.faults.join(', ')}`);
  return created;
}

// --- Making one --------------------------------------------------------------

test('a new account is a Student with a Temporary Password that actually signs in', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student, temporaryPassword } = await newAccount(db, 'anna');

    assert.equal(student.username, 'anna');
    assert.equal(student.isAdmin, false, 'never an Admin: the role is granted by the seed script');
    assert.equal(student.passwordIsTemporary, true);
    assert.equal(student.currentCourseId, null);

    const stored = byName(db, 'anna')!;
    assert.ok(
      await verifyPassword(stored.passwordHash, temporaryPassword),
      'the password handed to the Admin is the one the account has',
    );
    assert.ok(
      !/anna/.test(stored.passwordHash),
      'and the row holds a hash rather than anything the password can be read out of',
    );
  } finally {
    handle.cleanup();
  }
});

test('two accounts never receive the same Temporary Password', () => {
  // Not a proof of entropy — a generated password is not chosen by a person, and
  // this is the property that claim exists for.
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) seen.add(newTemporaryPassword());
  assert.equal(seen.size, 200);
});

test('a Temporary Password can be read aloud without ambiguity', () => {
  for (let i = 0; i < 50; i += 1) {
    const password = newTemporaryPassword();
    assert.match(password, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
    assert.ok(
      !/[ilo01]/.test(password),
      'the characters that are read back as one another are not in the alphabet',
    );
  }
});

test('a username that is taken, empty, spaced or overlong is refused', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    await newAccount(db, 'anna');

    const taken = await createStudent(db, { username: 'anna' });
    assert.equal(taken.ok, false);
    assert.deepEqual(taken.ok ? [] : taken.faults, ['username_taken']);

    // Case matters, because the sign-in lookup is exact: `Anna` is not `anna`
    // there, so it must not be refused as a duplicate here.
    const cased = await createStudent(db, { username: 'Anna' });
    assert.equal(cased.ok, true, 'a different name is a different account');

    assert.deepEqual(usernameFaults('   '), ['username_empty']);
    assert.deepEqual(usernameFaults('anna petrova'), ['username_has_space']);
    assert.deepEqual(usernameFaults('a'.repeat(USERNAME_MAX_LENGTH + 1)), ['username_too_long']);
    assert.deepEqual(usernameFaults('анна'), [], 'the interface is Russian; so may a name be');
    assert.deepEqual(usernameFaults('  anna  '), [], 'and it is trimmed rather than refused');
  } finally {
    handle.cleanup();
  }
});

test('a refused account writes nothing at all', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const before = db.select().from(students).all().length;
    const refused = await createStudent(db, { username: '  ' });
    assert.equal(refused.ok, false);
    assert.equal(db.select().from(students).all().length, before);
  } finally {
    handle.cleanup();
  }
});

// --- Replacing the Temporary Password ----------------------------------------

test('changing the password clears the Temporary flag and takes effect immediately', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student, temporaryPassword } = await newAccount(db, 'anna');
    const session = createSession(db, student.id, 30);

    const result = await changePassword(db, {
      studentId: student.id,
      currentPassword: temporaryPassword,
      newPassword: 'her own password',
      confirmation: 'her own password',
      sessionId: session.id,
    });
    assert.equal(result.ok, true);

    const after = byName(db, 'anna')!;
    assert.equal(after.passwordIsTemporary, false, 'the password is nobody else’s now');
    assert.ok(await verifyPassword(after.passwordHash, 'her own password'));
    assert.ok(
      !(await verifyPassword(after.passwordHash, temporaryPassword)),
      'and the one the Admin knows no longer signs in',
    );
  } finally {
    handle.cleanup();
  }
});

test('a password change signs out every other device and keeps the one asking', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student, temporaryPassword } = await newAccount(db, 'anna');
    const here = createSession(db, student.id, 30);
    const elsewhere = createSession(db, student.id, 30);
    const somebodyElse = createSession(db, admin(db).id, 30);

    await changePassword(db, {
      studentId: student.id,
      currentPassword: temporaryPassword,
      newPassword: 'her own password',
      confirmation: 'her own password',
      sessionId: here.id,
    });

    assert.ok(findSessionStudent(db, here.id), 'the screen doing the right thing stays signed in');
    assert.equal(findSessionStudent(db, elsewhere.id), null, 'the window the password was known in closes');
    assert.ok(findSessionStudent(db, somebodyElse.id), 'and nobody else is touched');
  } finally {
    handle.cleanup();
  }
});

test('every way of getting a password change wrong is reported at once', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');
    const session = createSession(db, student.id, 30);

    const refused = await changePassword(db, {
      studentId: student.id,
      currentPassword: 'not the temporary one',
      newPassword: 'short',
      confirmation: 'different',
      sessionId: session.id,
    });

    assert.equal(refused.ok, false);
    assert.deepEqual(
      (refused.ok ? [] : refused.faults).slice().sort(),
      ['current_password_wrong', 'password_mismatch', 'password_too_short'],
      'an Admin fixes a form rather than a field, and so does a Student',
    );
    assert.equal(byName(db, 'anna')!.passwordIsTemporary, true, 'and nothing changed');
  } finally {
    handle.cleanup();
  }
});

test('typing the Temporary Password back in as the new one is refused', async () => {
  // The one outcome the whole mechanism exists to prevent: an account whose
  // password somebody else knows, left exactly as it was.
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student, temporaryPassword } = await newAccount(db, 'anna');
    const session = createSession(db, student.id, 30);

    const refused = await changePassword(db, {
      studentId: student.id,
      currentPassword: temporaryPassword,
      newPassword: temporaryPassword,
      confirmation: temporaryPassword,
      sessionId: session.id,
    });

    assert.equal(refused.ok, false);
    assert.deepEqual(refused.ok ? [] : refused.faults, ['password_unchanged']);
    assert.equal(byName(db, 'anna')!.passwordIsTemporary, true);
  } finally {
    handle.cleanup();
  }
});

test('a Student who never held a Temporary Password can still change their own', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const seeded = byName(db, 'student')!;
    const session = createSession(db, seeded.id, 30);

    const result = await changePassword(db, {
      studentId: seeded.id,
      currentPassword: STUDENT_PASSWORD,
      newPassword: 'a password of their own',
      confirmation: 'a password of their own',
      sessionId: session.id,
    });

    assert.equal(result.ok, true);
    const after = byName(db, 'student')!;
    assert.ok(await verifyPassword(after.passwordHash, 'a password of their own'));
    assert.equal(after.passwordIsTemporary, false, 'and it was never true, so it stays false');
  } finally {
    handle.cleanup();
  }
});

// --- Removing one ------------------------------------------------------------

test('deleting a Student takes their Enrollments, work and sessions with it', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');

    const course = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    assert.equal(course.ok, true);
    const courseId = course.ok ? course.course.id : 0;
    enrollStudent(db, { courseId, studentId: student.id });
    const session = createSession(db, student.id, 30);

    const removed = deleteStudent(db, { studentId: student.id, actingStudentId: admin(db).id });
    assert.equal(removed.ok, true);
    assert.equal(removed.ok ? removed.username : '', 'anna');

    assert.equal(byName(db, 'anna'), undefined);
    assert.deepEqual(
      db.select().from(enrollments).where(eq(enrollments.studentId, student.id)).all(), [],
      'the Enrollment goes with the account',
    );
    assert.deepEqual(
      db.select().from(submissions).where(eq(submissions.studentId, student.id)).all(), [],
      'and so does their work',
    );
    assert.equal(
      findSessionStudent(db, session.id), null,
      'and a device already signed in stops being signed in',
    );
  } finally {
    handle.cleanup();
  }
});

test('deleting a Student leaves the Lessons they wrote, without an author', async () => {
  // The schema says `set null` rather than `cascade` on a Draft's author, and
  // this is the sentence that says why: losing an account must not take a Lesson
  // with it.
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');

    const course = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    const courseId = course.ok ? course.course.id : 0;
    const lesson = createLesson(db, { courseId, title: 'Первый урок', studentId: student.id });
    assert.equal(lesson.ok, true);
    const lessonId = lesson.ok ? lesson.lesson.id : 0;
    saveDraft(db, {
      lessonId,
      studentId: student.id,
      document: {
        title: 'Первый урок',
        grammarFocus: 'Indefinite article a/an.',
        theoryMarkdown: '## Первый урок',
        exercises: [],
      },
    });

    deleteStudent(db, { studentId: student.id, actingStudentId: admin(db).id });

    const drafts = db.select().from(lessonDrafts).where(eq(lessonDrafts.lessonId, lessonId)).all();
    assert.ok(drafts.length > 0, 'the Drafts are still there');
    assert.ok(drafts.every((draft) => draft.createdBy === null), 'and have lost their author');
  } finally {
    handle.cleanup();
  }
});

test('an Admin cannot delete themselves, and cannot delete another Admin either', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const igor = admin(db);

    const itself = deleteStudent(db, { studentId: igor.id, actingStudentId: igor.id });
    assert.equal(itself.ok, false);
    assert.deepEqual(itself.ok ? [] : itself.faults, ['cannot_delete_self'], 'the mis-click');

    // A second Admin, made the only way the role is ever granted.
    seedStudents(db, [{ username: 'second', password: 'another long password', isAdmin: true }]);
    const other = byName(db, 'second')!;
    const refused = deleteStudent(db, { studentId: other.id, actingStudentId: igor.id });
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.ok ? [] : refused.faults, ['cannot_delete_admin']);

    assert.ok(byName(db, 'igor'), 'both are still here');
    assert.ok(byName(db, 'second'));
  } finally {
    handle.cleanup();
  }
});

test('deleting an account frees its username and its lockout', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');

    // A lockout earned by the account that is about to go. Left behind, the next
    // `anna` would be refused a correct Temporary Password by somebody else's
    // failures.
    db.insert(loginThrottle).values({
      username: 'anna',
      consecutiveFailures: 5,
      lastFailureAt: new Date(),
      lockedUntil: new Date(Date.now() + 60 * 60_000),
    }).run();

    deleteStudent(db, { studentId: student.id, actingStudentId: admin(db).id });

    assert.deepEqual(
      db.select().from(loginThrottle).where(eq(loginThrottle.username, 'anna')).all(), [],
      'the throttle is keyed by username, so nothing cascades it away — this does',
    );
    const again = await createStudent(db, { username: 'anna' });
    assert.equal(again.ok, true, 'and the name is free again');
  } finally {
    handle.cleanup();
  }
});

test('deleting an unknown account is refused rather than silently accepted', () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const refused = deleteStudent(db, { studentId: 9999, actingStudentId: admin(db).id });
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.ok ? [] : refused.faults, ['account_not_found']);
  } finally {
    handle.cleanup();
  }
});

// --- Withdrawing from a Course -----------------------------------------------

test('withdrawing removes the Course and keeps the work in it', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');
    const course = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    const courseId = course.ok ? course.course.id : 0;

    enrollStudent(db, { courseId, studentId: student.id });
    // As if they had been working in it: the Current Course is what their next
    // visit is restored to.
    db.update(students).set({ currentCourseId: courseId }).where(eq(students.id, student.id)).run();

    const removed = withdrawStudent(db, { courseId, studentId: student.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.removed, true);

    assert.deepEqual(enrolledCourses(db, student.id), [], 'the Course is out of reach');
    assert.equal(
      byName(db, 'anna')!.currentCourseId, null,
      'and their next visit is not restored to a Course they cannot open',
    );
    assert.ok(byName(db, 'anna'), 'the account itself is untouched');

    // Putting them back resumes rather than restarts, which is the whole
    // difference between this and deleting the account.
    const again = enrollStudent(db, { courseId, studentId: student.id });
    assert.equal(again.ok, true);
    assert.equal(enrolledCourses(db, student.id).length, 1);
  } finally {
    handle.cleanup();
  }
});

test('withdrawing someone who was not enrolled is reported, not refused', () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const course = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    const courseId = course.ok ? course.course.id : 0;
    const result = withdrawStudent(db, { courseId, studentId: byName(db, 'student')!.id });
    assert.equal(result.ok, true);
    assert.equal(result.removed, false, 'an Enrollment is a fact rather than an event');
  } finally {
    handle.cleanup();
  }
});

test('withdrawing from one Course leaves the others alone', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');
    const first = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    const second = createCourse(db, {
      language: 'tj', level: 'A1', graderModel: 'claude-opus-5', title: 'Таджикский с нуля',
    });
    const firstId = first.ok ? first.course.id : 0;
    const secondId = second.ok ? second.course.id : 0;

    enrollStudent(db, { courseId: firstId, studentId: student.id });
    enrollStudent(db, { courseId: secondId, studentId: student.id });
    db.update(students).set({ currentCourseId: secondId }).where(eq(students.id, student.id)).run();

    withdrawStudent(db, { courseId: firstId, studentId: student.id });

    assert.deepEqual(enrolledCourses(db, student.id).map((c) => c.id), [secondId]);
    assert.equal(
      byName(db, 'anna')!.currentCourseId, secondId,
      'the Current Course is cleared only when it is the one being taken away',
    );
  } finally {
    handle.cleanup();
  }
});

// --- What the Admin's screen reads -------------------------------------------

test('the accounts list counts the Courses each account can reach', async () => {
  const handle = freshDatabase();
  try {
    const { db } = handle;
    const { student } = await newAccount(db, 'anna');
    const course = createCourse(db, {
      language: 'en', level: 'A1', graderModel: 'claude-sonnet-5', title: 'Английский с нуля',
    });
    enrollStudent(db, { courseId: course.ok ? course.course.id : 0, studentId: student.id });

    const listed = everyStudent(db);
    assert.deepEqual(
      listed.map(({ student: s, enrollmentCount }) => [s.username, enrollmentCount]),
      [['igor', 0], ['student', 0], ['anna', 1]],
      'every account including the Admin, in the order they were made',
    );
    assert.equal(
      listed.find(({ student: s }) => s.username === 'anna')!.student.passwordIsTemporary, true,
      'and the screen can say which of them has not chosen a password yet',
    );
  } finally {
    handle.cleanup();
  }
});

// --- The Russian half --------------------------------------------------------

test('every account fault has a Russian message, and the dictionary invents none', () => {
  assert.deepEqual(
    Object.keys(ru.accountFaults).sort(),
    [...ACCOUNT_FAULTS].sort(),
  );
});

test('the sentences a person reads name the limits the rules enforce', () => {
  // A hint promising eight characters in front of a rule that wants ten is worse
  // than no hint: it turns a refusal into an accusation that the application is
  // broken.
  assert.match(ru.accountFaults.password_too_short, new RegExp(String(MIN_PASSWORD_LENGTH)));
  assert.match(ru.password.lengthHint, new RegExp(String(MIN_PASSWORD_LENGTH)));
  assert.match(ru.accountFaults.username_too_long, new RegExp(String(USERNAME_MAX_LENGTH)));
});
