// Seam 2/3 — authoring against a real database, with no HTTP in the way.
//
// Everything here is a write that used to be a seed script: a Course, a Lesson,
// an Enrollment. The claims worth asserting are the ones the seed script never
// had to make — that a new Lesson is invisible to a Student until it is
// published, that reordering never leaves two Lessons sharing a position, and
// that Haiku cannot be chosen to grade (ADR 0002).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asc, eq } from 'drizzle-orm';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { lessons, students, lessonDrafts, submissions, type CourseRow } from '../src/db/schema.ts';
import {
  createCourse, createLesson, reorderLessons, enrollStudent,
  type CourseInput,
} from '../src/admin/authoring.ts';
import { GRADER_MODELS, CEFR_LEVELS, DEFAULT_GRADER_MODEL } from '../src/content/course-options.ts';
import { AUTHORING_FAULTS } from '../src/admin/authoring.ts';
import { DRAFT_ORIGINS } from '../src/db/schema.ts';
import { ru } from '../src/ru.ts';
import { adminCourse, courseRoster } from '../src/admin/catalogue.ts';
import { courseOutline, enrolledCourses, openLesson } from '../src/practice/lessons.ts';
import { latestDraft, publishDraft, saveDraft } from '../src/admin/drafts.ts';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  seedStudents(handle.db, [
    { username: 'igor', password: 'correct horse battery', isAdmin: true },
    { username: 'student', password: 'staple monkey trombone', isAdmin: false },
  ]);
  return { ...handle, cleanup: () => { handle.close(); cleanup(); } };
}

type Db = ReturnType<typeof freshDatabase>['db'];

const admin = (db: Db) => db.select().from(students).where(eq(students.username, 'igor')).get()!;
const learner = (db: Db) => db.select().from(students).where(eq(students.username, 'student')).get()!;

const A_COURSE: CourseInput = {
  language: 'en',
  level: 'A1',
  graderModel: DEFAULT_GRADER_MODEL.en,
  title: 'Английский с нуля',
};

function newCourse(db: Db, overrides: Partial<CourseInput> = {}): CourseRow {
  const created = createCourse(db, { ...A_COURSE, ...overrides });
  if (!created.ok) throw new Error(`the Course was refused: ${created.faults.join(', ')}`);
  return created.course;
}

function newLesson(db: Db, courseId: number, title: string) {
  const created = createLesson(db, { courseId, title, studentId: admin(db).id });
  if (!created.ok) throw new Error(`the Lesson was refused: ${created.faults.join(', ')}`);
  return created.lesson;
}

function savedDocument(db: Db, lessonId: number, title: string) {
  const result = saveDraft(db, {
    lessonId,
    studentId: admin(db).id,
    document: {
      title,
      grammarFocus: 'Indefinite article a/an.',
      theoryMarkdown: '## Теория\n\nПеред согласным звуком — **a**.',
      exercises: [],
    },
  });
  if (!result.ok) throw new Error(`the Draft was refused: ${result.faults.map((f) => f.code).join(', ')}`);
  return result.draft;
}

// --- Creating a Course -------------------------------------------------------

test('an Admin creates a Course with a Language, a CEFR level and a title', () => {
  const handle = freshDatabase();
  try {
    const course = newCourse(handle.db);

    assert.equal(course.language, 'en');
    assert.equal(course.level, 'A1');
    assert.equal(course.title, A_COURSE.title);
    assert.equal(course.graderModel, 'claude-sonnet-5');
  } finally {
    handle.cleanup();
  }
});

test('the Grader model defaults from the Language per ADR 0002, and is overridable', () => {
  const handle = freshDatabase();
  try {
    assert.equal(DEFAULT_GRADER_MODEL.en, 'claude-sonnet-5', 'English takes the faster model');
    assert.equal(DEFAULT_GRADER_MODEL.tj, 'claude-opus-5', 'Tajik takes the better one');

    // Defaulted by the write path, not only by the form: a Course created by
    // anything else still grades on the model the ADR says it should.
    const english = newCourse(handle.db, { title: 'Английский', graderModel: undefined });
    assert.equal(english.graderModel, 'claude-sonnet-5');

    const tajik = newCourse(handle.db, { title: 'Таджикский', language: 'tj', graderModel: undefined });
    assert.equal(tajik.graderModel, 'claude-opus-5');

    // The override is the point of the column: a Course whose Language says
    // Sonnet can still be set to Opus without a code change.
    const overridden = newCourse(handle.db, {
      title: 'Английский с Opus',
      graderModel: 'claude-opus-5',
    });
    assert.equal(overridden.graderModel, 'claude-opus-5');
  } finally {
    handle.cleanup();
  }
});

test('Haiku cannot be chosen to grade, in any Language', () => {
  const handle = freshDatabase();
  try {
    // ADR 0002: Haiku reported Tajik `-ед` as third person singular. A grader
    // that teaches false morphology with confidence is worse than no grader.
    for (const model of ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'CLAUDE-HAIKU-4-5']) {
      for (const language of ['en', 'tj']) {
        const refused = createCourse(handle.db, { ...A_COURSE, language, graderModel: model });
        assert.equal(refused.ok, false, `${model} in ${language} is refused`);
        assert.deepEqual(refused.faults, ['grader_model_forbidden']);
      }
    }

    assert.ok(
      !GRADER_MODELS.some((model) => /haiku/i.test(model)),
      'and it is not on the list the form offers either',
    );
    assert.deepEqual(handle.db.select().from(lessons).all(), [], 'nothing was written');
  } finally {
    handle.cleanup();
  }
});

test('a Course that is not coherent is refused with every reason at once', () => {
  const handle = freshDatabase();
  try {
    const refused = createCourse(handle.db, {
      language: 'ru', level: 'Z9', graderModel: 'gpt-9', title: '   ',
    });
    assert.equal(refused.ok, false);
    assert.deepEqual(
      [...refused.faults].sort(),
      ['course_title_empty', 'grader_model_unknown', 'language_unknown', 'level_unknown'],
      'an author fixes a form, not one field per attempt',
    );

    assert.ok(CEFR_LEVELS.includes('A1'), 'the levels the form offers are the CEFR ones');
  } finally {
    handle.cleanup();
  }
});

// --- Creating a Lesson -------------------------------------------------------

test('a Lesson starts as an unpublished Draft, invisible to an enrolled Student', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const student = learner(db);
    assert.equal(enrollStudent(db, { courseId: course.id, studentId: student.id }).ok, true);

    const lesson = newLesson(db, course.id, 'Артикли');
    assert.equal(lesson.publishedAt, null, 'created, never published');
    assert.equal(lesson.position, 1);

    // An empty published Lesson would appear in a Student's Course as something
    // they can open and cannot do, and would sit in the middle of sequential
    // unlocking. So it is not in their Course at all.
    assert.deepEqual(courseOutline(db, student.id, course.id), [], 'not in the Student\'s Course');
    assert.deepEqual(
      openLesson(db, student.id, lesson.id),
      { ok: false, reason: 'not_found' },
      'and not reachable by guessing its address',
    );

    // The Admin sees it, because an unpublished Lesson is what an Admin is
    // working on.
    const seen = adminCourse(db, course.id)!;
    assert.equal(seen.lessons.length, 1);
    assert.equal(seen.lessons[0]!.publication, 'draft');

    // "Starts as an unpublished Draft" literally: the Draft exists from creation,
    // so the history has a first version rather than a special case.
    const draft = latestDraft(db, lesson.id);
    assert.notEqual(draft, null);
    assert.equal(draft!.document.title, 'Артикли');
    assert.equal(draft!.publishedAt, null);
  } finally {
    handle.cleanup();
  }
});

test('publishing a created Lesson is what makes the Student able to open it', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const student = learner(db);
    enrollStudent(db, { courseId: course.id, studentId: student.id });

    const lesson = newLesson(db, course.id, 'Артикли');
    const filled = savedDocument(db, lesson.id, 'Артикли');
    assert.equal(publishDraft(db, filled.id).ok, true);

    const outline = courseOutline(db, student.id, course.id);
    assert.equal(outline.length, 1, 'now in the Student\'s Course');
    assert.equal(outline[0]!.unlocked, true, 'and the first Lesson is unlocked on enrollment');
    assert.equal(openLesson(db, student.id, lesson.id).ok, true);

    const published = db.select().from(lessons).where(eq(lessons.id, lesson.id)).get()!;
    assert.notEqual(published.publishedAt, null, 'the Lesson records when it went live');
  } finally {
    handle.cleanup();
  }
});

test('an unpublished Lesson between two published ones does not gate the second', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const student = learner(db);
    enrollStudent(db, { courseId: course.id, studentId: student.id });

    const titles = ['Первый', 'Черновик', 'Третий'];
    const made = titles.map((title) => newLesson(db, course.id, title));

    // The first Lesson gets an Exercise, so completing it is a thing that can
    // happen: an empty Practice is deliberately never complete, and a Course of
    // empty Lessons could not tell "unlocked" from "never gated" apart.
    const withPractice = saveDraft(db, {
      lessonId: made[0]!.id,
      studentId: admin(db).id,
      document: {
        title: 'Первый',
        grammarFocus: 'Indefinite article a/an.',
        theoryMarkdown: 'Теория.',
        exercises: [{
          kind: 'fill_gap',
          prompt: 'Вставьте артикль: I have ___ cat.',
          referenceAnswer: 'a',
          acceptedAnswers: [['a']],
          caseSensitive: false,
          choices: [],
        }],
      },
    });
    if (!withPractice.ok) throw new Error('the Draft was refused');
    assert.equal(publishDraft(db, withPractice.draft.id).ok, true);

    // The third is published; the second is left as a Draft.
    assert.equal(publishDraft(db, savedDocument(db, made[2]!.id, 'Третий').id).ok, true);

    const locked = courseOutline(db, student.id, course.id);
    assert.deepEqual(locked.map((o) => o.lesson.title), ['Первый', 'Третий'], 'the Draft is not there');
    assert.deepEqual(locked.map((o) => o.unlocked), [true, false], 'and the third is gated by the first');

    const exerciseId = locked[0]!.progress.exercises[0]!.exerciseId;
    db.insert(submissions).values({
      studentId: student.id, exerciseId, attempt: 1, answer: 'a',
      status: 'graded', proposedVerdict: 'correct', guardedVerdict: 'correct',
      feedbackRu: 'Верно', corrected: null, failureReason: null, createdAt: new Date(),
    }).run();

    // Completing the first Lesson unlocks the third directly. If the unpublished
    // Lesson sat in the chain, the third would stay locked behind a Lesson no
    // Student can open — which is the whole reason it is absent rather than
    // hidden.
    assert.deepEqual(
      courseOutline(db, student.id, course.id).map((o) => o.unlocked),
      [true, true],
    );
  } finally {
    handle.cleanup();
  }
});

test('a Lesson is created at the end of the Course, and a bad request writes nothing', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const studentId = admin(db).id;

    for (const title of ['Первый', 'Второй', 'Третий']) newLesson(db, course.id, title);
    assert.deepEqual(
      db.select().from(lessons).orderBy(asc(lessons.position)).all().map((l) => l.position),
      [1, 2, 3],
    );

    assert.deepEqual(
      createLesson(db, { courseId: course.id, title: '  ', studentId }),
      { ok: false, faults: ['lesson_title_empty'] },
    );
    assert.deepEqual(
      createLesson(db, { courseId: 9999, title: 'Урок', studentId }),
      { ok: false, faults: ['course_not_found'] },
    );
    assert.equal(db.select().from(lessons).all().length, 3, 'and neither wrote a Lesson');
  } finally {
    handle.cleanup();
  }
});

// --- Reordering --------------------------------------------------------------

test('Lessons reorder in one transaction that never leaves two sharing a position', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const made = ['Первый', 'Второй', 'Третий'].map((title) => newLesson(db, course.id, title));

    // A swap of the first two is the case a naive sequence of writes breaks on:
    // the first write collides with the position the second is about to leave.
    const reordered = reorderLessons(db, course.id, [made[1]!.id, made[0]!.id, made[2]!.id]);
    assert.equal(reordered.ok, true);

    const after = db.select().from(lessons)
      .where(eq(lessons.courseId, course.id)).orderBy(asc(lessons.position)).all();
    assert.deepEqual(after.map((l) => l.title), ['Второй', 'Первый', 'Третий']);
    assert.deepEqual(after.map((l) => l.position), [1, 2, 3], 'and 1..n with no gaps');
  } finally {
    handle.cleanup();
  }
});

test('a reorder that does not name exactly this Course\'s Lessons is refused whole', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const other = newCourse(db, { title: 'Другой курс' });
    const made = ['Первый', 'Второй'].map((title) => newLesson(db, course.id, title));
    const elsewhere = newLesson(db, other.id, 'Чужой');

    const cases: Array<{ what: string; order: number[] }> = [
      { what: 'a Lesson left out', order: [made[0]!.id] },
      { what: 'a Lesson named twice', order: [made[0]!.id, made[0]!.id] },
      { what: 'a Lesson from another Course', order: [made[0]!.id, elsewhere.id] },
    ];
    for (const { what, order } of cases) {
      assert.deepEqual(reorderLessons(db, course.id, order), { ok: false, faults: ['order_mismatch'] }, what);
    }

    assert.deepEqual(
      db.select().from(lessons).where(eq(lessons.courseId, course.id))
        .orderBy(asc(lessons.position)).all().map((l) => l.title),
      ['Первый', 'Второй'],
      'and the order is untouched',
    );
  } finally {
    handle.cleanup();
  }
});

// --- Enrollment --------------------------------------------------------------

test('enrolling a Student puts the Course on their home page, and twice does not', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    const student = learner(db);

    assert.deepEqual(enrolledCourses(db, student.id), [], 'nobody is enrolled by creating a Course');

    assert.deepEqual(enrollStudent(db, { courseId: course.id, studentId: student.id }), { ok: true, created: true });
    assert.deepEqual(enrolledCourses(db, student.id).map((c) => c.id), [course.id]);

    // Ignored rather than duplicated: an Enrollment is a fact, and asserting it
    // twice does not make it two facts.
    assert.deepEqual(enrollStudent(db, { courseId: course.id, studentId: student.id }), { ok: true, created: false });
    assert.deepEqual(enrolledCourses(db, student.id).map((c) => c.id), [course.id]);
  } finally {
    handle.cleanup();
  }
});

test('enrolling into or as something that does not exist is refused', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    assert.deepEqual(
      enrollStudent(db, { courseId: 9999, studentId: learner(db).id }),
      { ok: false, faults: ['course_not_found'] },
    );
    assert.deepEqual(
      enrollStudent(db, { courseId: course.id, studentId: 9999 }),
      { ok: false, faults: ['student_not_found'] },
    );
  } finally {
    handle.cleanup();
  }
});

test('the roster names every Student and says which of them is enrolled', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    enrollStudent(db, { courseId: course.id, studentId: learner(db).id });

    assert.deepEqual(
      courseRoster(db, course.id).map((entry) => [entry.student.username, entry.enrolled]),
      [['igor', false], ['student', true]],
    );
  } finally {
    handle.cleanup();
  }
});

// --- A Course with nothing in it ---------------------------------------------

test('a Course with no Lessons is an ordinary state, not an error', () => {
  const handle = freshDatabase();
  try {
    const db = handle.db;
    const course = newCourse(db);
    enrollStudent(db, { courseId: course.id, studentId: learner(db).id });

    assert.deepEqual(adminCourse(db, course.id)!.lessons, [], 'for the Admin');
    assert.deepEqual(courseOutline(db, learner(db).id, course.id), [], 'and for the Student');
    assert.deepEqual(db.select().from(lessonDrafts).all(), [], 'and nothing was written to get there');
  } finally {
    handle.cleanup();
  }
});

// --- The Russian half --------------------------------------------------------

test('every authoring fault has a Russian message, and the dictionary invents none', () => {
  // Same split the validity rules make: the code is what is checked and stored,
  // the sentence is only what is read. A code with no sentence reaches an Admin
  // as `grader_model_forbidden`, which tells them nothing.
  assert.deepEqual(
    Object.keys(ru.authoringFaults).sort(),
    [...AUTHORING_FAULTS].sort(),
  );
});

test('every Draft origin has a Russian name, and the dictionary invents none', () => {
  assert.deepEqual(
    Object.keys(ru.draftOrigins).sort(),
    [...DRAFT_ORIGINS].sort(),
  );
});
