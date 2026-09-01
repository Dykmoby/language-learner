'use client';

// One Course, from an author's side: its Lessons in order, a form that adds
// another, and who can reach the Course at all.
//
// The Lesson list is interactive because reordering is, and the order it shows
// is the order it will send. A reorder is one request carrying the whole order —
// positions are unique within a Course, so anything less is a state the database
// refuses halfway through.

import { useState } from 'react';
import { ru, faultMessage } from '../../../../ru.ts';
import type { LessonPublication } from '../../../../admin/catalogue.ts';
import { movedWithin } from '../../../../content/ordering.ts';

export type LessonEntry = {
  id: number;
  title: string;
  exerciseCount: number;
  publication: LessonPublication;
};

export type TestEntry = {
  id: number;
  title: string;
  exerciseCount: number;
  published: boolean;
};

export type StudentEntry = {
  id: number;
  username: string;
  enrolled: boolean;
};

type Props = {
  courseId: number;
  initialLessons: LessonEntry[];
  initialTests: TestEntry[];
  initialRoster: StudentEntry[];
};

function publicationLabel(publication: LessonPublication): string {
  if (publication === 'draft') return ru.admin.draft;
  return publication === 'published' ? ru.admin.published : ru.admin.unpublishedChanges;
}

export function CourseAdmin({ courseId, initialLessons, initialTests, initialRoster }: Props) {
  const [lessons, setLessons] = useState(initialLessons);
  const [tests] = useState(initialTests);
  const [roster, setRoster] = useState(initialRoster);
  const [title, setTitle] = useState('');
  const [testTitle, setTestTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function clearMessages() {
    setFaults([]);
    setProblem(null);
    setNotice(null);
  }

  async function post(path: string, body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: response.ok && parsed?.ok === true, body: parsed };
  }

  function report(body: Record<string, unknown> | null) {
    const codes = Array.isArray(body?.faults) ? (body.faults as string[]) : [];
    setFaults(codes);
    if (codes.length === 0) setProblem(ru.admin.writeFailed);
  }

  async function addLesson() {
    setBusy(true);
    clearMessages();
    try {
      const { ok, body } = await post(`/api/admin/courses/${courseId}/lessons`, { title });
      if (!ok) return report(body);
      // Into the new Lesson's Draft: an empty Lesson is not something anyone
      // wants to look at a list entry for, they want to write it.
      window.location.href = `/admin/lessons/${body!.lessonId as number}`;
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function addTest() {
    setBusy(true);
    clearMessages();
    try {
      const { ok, body } = await post(`/api/admin/courses/${courseId}/tests`, { title: testTitle });
      if (!ok) return report(body);
      // Into the Test itself: what an Admin came to do is write its Exercises,
      // and an empty Test is not something anyone wants a list entry for.
      window.location.href = `/admin/tests/${body!.testId as number}`;
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, by: -1 | 1) {
    const reordered = movedWithin(lessons, index, by);
    // Shown immediately and put back if the write is refused — the alternative
    // is a list that jumps a second after every click.
    const before = lessons;
    if (reordered.every((lesson, at) => lesson === before[at])) return;
    setLessons(reordered);

    setBusy(true);
    clearMessages();
    try {
      const { ok, body } = await post(`/api/admin/courses/${courseId}/lessons/order`, {
        lessonIds: reordered.map((lesson) => lesson.id),
      });
      if (!ok) {
        setLessons(before);
        return report(body);
      }
      setNotice(ru.admin.orderSaved);
    } catch {
      setLessons(before);
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function enroll(studentId: number) {
    setBusy(true);
    clearMessages();
    try {
      const { ok, body } = await post(`/api/admin/courses/${courseId}/enrollments`, { studentId });
      if (!ok) return report(body);
      setRoster((current) => current.map((entry) =>
        entry.id === studentId ? { ...entry, enrolled: true } : entry));
      setNotice(ru.admin.enrolledNow);
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  // The other half of enrolling, and deliberately reversible: it takes away
  // access to the Course and touches none of the Student's work in it, so
  // enrolling them again resumes where they stopped. That is why there is no
  // confirmation step in front of it — the act it undoes is one press away.
  async function withdraw(studentId: number) {
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/admin/courses/${courseId}/enrollments/${studentId}`, {
        method: 'DELETE',
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || body?.ok !== true) return report(body);
      setRoster((current) => current.map((entry) =>
        entry.id === studentId ? { ...entry, enrolled: false } : entry));
      setNotice(ru.admin.withdrawnNow);
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2>{ru.admin.lessonsTitle}</h2>
      {lessons.length === 0 ? (
        <p className="muted">{ru.admin.noLessons}</p>
      ) : (
        <ol className="lessons">
          {lessons.map((lesson, index) => (
            <li key={lesson.id}>
              <a href={`/admin/lessons/${lesson.id}`}>{lesson.title}</a>
              <span className="muted">
                {' — '}
                {publicationLabel(lesson.publication)}
                {' · '}{ru.admin.exerciseCount(lesson.exerciseCount)}
              </span>
              <span className="actions">
                <button
                  type="button" className="secondary"
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                >
                  {ru.common.moveUp}
                </button>
                <button
                  type="button" className="secondary"
                  onClick={() => move(index, 1)}
                  disabled={busy || index === lessons.length - 1}
                >
                  {ru.common.moveDown}
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <h2>{ru.admin.newLessonTitle}</h2>
      <label>
        <span>{ru.admin.lessonTitleField}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); clearMessages(); }}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.admin.lessonStartsAsDraft}</p>
      <p className="actions">
        <button type="button" onClick={addLesson} disabled={busy}>
          {busy ? ru.admin.creatingLesson : ru.admin.createLesson}
        </button>
      </p>

      <h2>{ru.admin.testsTitle}</h2>
      {tests.length === 0 ? (
        <p className="muted">{ru.admin.noTests}</p>
      ) : (
        <ul className="cards">
          {tests.map((test) => (
            <li key={test.id}>
              <a href={`/admin/tests/${test.id}`}>{test.title}</a>
              <span className="muted">
                {' — '}
                {test.published ? ru.testAdmin.published : ru.testAdmin.unpublished}
                {' · '}{ru.admin.exerciseCount(test.exerciseCount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3>{ru.admin.newTestTitle}</h3>
      <label>
        <span>{ru.admin.testTitleField}</span>
        <input
          type="text"
          value={testTitle}
          onChange={(e) => { setTestTitle(e.target.value); clearMessages(); }}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.admin.testStartsAsDraft}</p>
      <p className="actions">
        <button type="button" onClick={addTest} disabled={busy}>
          {busy ? ru.admin.creatingTest : ru.admin.createTest}
        </button>
      </p>

      <h2>{ru.admin.rosterTitle}</h2>
      <p className="muted">{ru.admin.rosterHint}</p>
      {roster.length === 0 ? (
        <p className="muted">{ru.admin.noStudents}</p>
      ) : (
        <ul className="cards">
          {roster.map((entry) => (
            <li key={entry.id}>
              {entry.username}
              {entry.enrolled ? (
                <>
                  <span className="muted"> — {ru.admin.enrolledAlready}</span>
                  <span className="actions">
                    <button type="button" className="secondary" onClick={() => withdraw(entry.id)} disabled={busy}>
                      {busy ? ru.admin.withdrawing : ru.admin.withdraw}
                    </button>
                  </span>
                </>
              ) : (
                <span className="actions">
                  <button type="button" className="secondary" onClick={() => enroll(entry.id)} disabled={busy}>
                    {busy ? ru.admin.enrolling : ru.admin.enroll}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}
    </>
  );
}
