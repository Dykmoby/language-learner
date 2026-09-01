// How content exists until authoring does (build-order step 4). Separate from
// the account seed, because creating people and creating Lessons are different
// decisions and only one of them should ever run unattended.
//
// Re-runnable by design: a fixture is edited and re-seeded, so this matches on
// the natural keys the schema already enforces — a Course by its Language and
// title, a Lesson by its position in that Course, an Exercise by its position in
// the Exercise Set — and updates in place. It never deletes an Exercise that the
// fixture still describes, because deleting one cascades to every Submission
// made against it, and re-seeding must not throw away a Student's work.

import { fileURLToPath } from 'node:url';
import { and, eq, gt, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { courses, lessons, exerciseSets, exercises, enrollments, students } from '../db/schema.ts';
import { openDatabase } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';
import { config } from '../config.ts';
import { ENGLISH_A1, type CourseFixture } from './english-a1.ts';
import { exerciseFaults, type ExerciseFault } from './exercise-validity.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type SeedContentResult = {
  courseId: number;
  courseAction: 'created' | 'updated';
  lessons: Array<{ position: number; title: string; exercises: number }>;
  /** Usernames enrolled by this run — those already enrolled are not repeated. */
  enrolled: string[];
};

/** Where a fault was found, so a report can point at the Exercise rather than the file. */
export type FixtureFault = ExerciseFault & {
  lessonPosition: number;
  lessonTitle: string;
  exercisePosition: number;
};

/** Every incoherent Exercise in a fixture — design.md § Exercise Kinds. */
export function fixtureFaults(fixture: CourseFixture): FixtureFault[] {
  return fixture.lessons.flatMap((lesson, lessonIndex) =>
    lesson.practice.flatMap((exercise, exerciseIndex) =>
      exerciseFaults(exercise).map((fault) => ({
        ...fault,
        lessonPosition: lessonIndex + 1,
        lessonTitle: lesson.title,
        exercisePosition: exerciseIndex + 1,
      }))));
}

function describeFaults(fixture: CourseFixture, faults: readonly FixtureFault[]): string {
  const lines = faults.map((fault) => {
    const offending = fault.offending === undefined ? '' : ` (${JSON.stringify(fault.offending)})`;
    return `  lesson ${fault.lessonPosition} ${JSON.stringify(fault.lessonTitle)}`
      + `, exercise ${fault.exercisePosition}: ${fault.code}${offending}`;
  });
  return `${fixture.title}: ${faults.length} incoherent exercise(s), nothing was seeded\n${lines.join('\n')}`;
}

export function seedCourseContent(db: Db, fixture: CourseFixture = ENGLISH_A1): SeedContentResult {
  // Before the transaction, not inside it. A fixture that is wrong in its ninth
  // Exercise should write none of the first eight — and a rollback is a weaker
  // promise than never having started, because the seed is also what the tests
  // and the Pi run by hand.
  const faults = fixtureFaults(fixture);
  if (faults.length > 0) throw new Error(describeFaults(fixture, faults));

  return db.transaction((tx) => {
    const existing = tx.select().from(courses)
      .where(and(eq(courses.language, fixture.language), eq(courses.title, fixture.title)))
      .get();

    const course = existing
      ? (tx.update(courses)
          .set({ level: fixture.level, graderModel: fixture.graderModel })
          .where(eq(courses.id, existing.id)).returning().get())
      : (tx.insert(courses).values({
          language: fixture.language, level: fixture.level,
          graderModel: fixture.graderModel, title: fixture.title, createdAt: new Date(),
        }).returning().get());

    const seededLessons = fixture.lessons.map((lessonFixture, index) => {
      const position = index + 1;
      const found = tx.select().from(lessons)
        .where(and(eq(lessons.courseId, course.id), eq(lessons.position, position)))
        .get();

      // A seeded Lesson is published by definition — the fixture is the content
      // a Student is meant to be reading. Only Lessons authored through the
      // Admin screens start unpublished, and re-seeding one that is already live
      // must not change when it went live.
      const lesson = found
        ? (tx.update(lessons).set({
            title: lessonFixture.title,
            theoryMarkdown: lessonFixture.theoryMarkdown,
            grammarFocus: lessonFixture.grammarFocus,
            publishedAt: found.publishedAt ?? new Date(),
          }).where(eq(lessons.id, found.id)).returning().get())
        : (tx.insert(lessons).values({
            courseId: course.id, position,
            title: lessonFixture.title,
            theoryMarkdown: lessonFixture.theoryMarkdown,
            grammarFocus: lessonFixture.grammarFocus,
            publishedAt: new Date(),
          }).returning().get());

      // The Practice's Exercise Set, owned by the Lesson and never by a Test —
      // an invariant the database enforces, which this simply has to satisfy.
      const set = tx.select().from(exerciseSets).where(eq(exerciseSets.lessonId, lesson.id)).get()
        ?? tx.insert(exerciseSets).values({ lessonId: lesson.id, testId: null }).returning().get();

      lessonFixture.practice.forEach((exerciseFixture, exerciseIndex) => {
        const exercisePosition = exerciseIndex + 1;
        const values = {
          kind: exerciseFixture.kind,
          prompt: exerciseFixture.prompt,
          referenceAnswer: exerciseFixture.referenceAnswer,
          acceptedAnswers: (exerciseFixture.acceptedAnswers ?? []).map((values) => [...values]),
          caseSensitive: exerciseFixture.caseSensitive ?? false,
          choices: exerciseFixture.choices ?? [],
        };

        const currentExercise = tx.select().from(exercises)
          .where(and(eq(exercises.exerciseSetId, set.id), eq(exercises.position, exercisePosition)))
          .get();

        if (currentExercise) {
          tx.update(exercises).set(values).where(eq(exercises.id, currentExercise.id)).run();
        } else {
          tx.insert(exercises).values({ exerciseSetId: set.id, position: exercisePosition, ...values }).run();
        }
      });

      // Only Exercises the fixture no longer describes — a shortened Practice.
      // This is the one deletion, and it is the one the author asked for.
      tx.delete(exercises).where(and(
        eq(exercises.exerciseSetId, set.id),
        gt(exercises.position, lessonFixture.practice.length),
      )).run();

      return { position, title: lessonFixture.title, exercises: lessonFixture.practice.length };
    });

    // Until authoring exists there is no screen that enrolls anyone, and a Course
    // nobody is enrolled in is unreachable by design (a Student cannot reach a
    // Lesson in a Course they are not enrolled in). So the fixture enrolls the
    // seeded accounts — the same place the content comes from.
    const everyStudent = tx.select().from(students).all();
    const alreadyEnrolled = new Set(
      everyStudent.length === 0 ? [] : tx.select().from(enrollments)
        .where(and(
          eq(enrollments.courseId, course.id),
          inArray(enrollments.studentId, everyStudent.map((s) => s.id)),
        ))
        .all().map((e) => e.studentId),
    );

    const enrolled = everyStudent.filter((student) => !alreadyEnrolled.has(student.id));
    for (const student of enrolled) {
      tx.insert(enrollments).values({
        studentId: student.id, courseId: course.id, createdAt: new Date(),
      }).run();
    }

    return {
      courseId: course.id,
      courseAction: existing ? 'updated' : 'created',
      lessons: seededLessons,
      enrolled: enrolled.map((s) => s.username),
    };
  });
}

// CLI: node src/content/seed-content.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handle = openDatabase(config.databasePath);
  try {
    runMigrations(handle);
    const result = seedCourseContent(handle.db);
    console.log(`${ENGLISH_A1.title}: ${result.courseAction} (course ${result.courseId})`);
    for (const lesson of result.lessons) {
      console.log(`  ${lesson.position}. ${lesson.title} — ${lesson.exercises} exercises`);
    }
    console.log(result.enrolled.length > 0
      ? `  enrolled: ${result.enrolled.join(', ')}`
      : '  enrolled: nobody new');
  } finally {
    handle.close();
  }
}
