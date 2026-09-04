'use client';

// One Course, from an author's side: its Lessons in order, its Tests, and who
// can reach the Course at all.
//
// The Lesson list is interactive because reordering is, and the order it shows
// is the order it will send. A reorder is one request carrying the whole order —
// positions are unique within a Course, so anything less is a state the database
// refuses halfway through.
//
// Adding is a plus in the corner of the section it adds to, and it adds
// immediately: there used to be a whole second section under each list — a
// heading, a title field and a button — asking for a name before the thing
// existed. The name was the wrong question at that moment. It is the first field
// in the editor the plus opens, and the first thing an author changes.
//
// Removing is the opposite shape, because it is the opposite act: a Lesson takes
// every Submission made against it when it goes, so it is confirmed by typing
// the Lesson's own name. See `deleteLesson` for what the cascade actually
// reaches.

import { useState, type ReactNode } from 'react';
import { ActionIcon, Button, Modal, TextInput } from '@mantine/core';
import { ru, faultMessage } from '../../../../ru.ts';
import type { LessonPublication } from '../../../../admin/catalogue.ts';
import { movedWithin } from '../../../../content/ordering.ts';

export type LessonEntry = {
  id: number;
  title: string;
  exerciseCount: number;
  publication: LessonPublication;
  /** What deleting this Lesson would destroy, named before the act rather than after. */
  submissionCount: number;
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

/* Three glyphs on three square controls, and their words live in `aria-label`
   rather than beside them. A list of Lessons carries the same three acts on every
   row, and spelled out that is three buttons per row wider than the titles they
   act on — the list becomes a column of controls with the Lessons hidden behind
   it. The words are still the ones the dictionary holds, so a translator sees
   them once and a screen reader reads them out. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const PlusIcon = <Glyph><path d="M12 5v14" /><path d="M5 12h14" /></Glyph>;
const UpIcon = <Glyph><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></Glyph>;
const DownIcon = <Glyph><path d="M12 5v14" /><path d="M18 13l-6 6-6-6" /></Glyph>;
const TrashIcon = (
  <Glyph>
    <path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" />
    <path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" />
  </Glyph>
);

function publicationLabel(publication: LessonPublication): string {
  if (publication === 'draft') return ru.admin.draft;
  return publication === 'published' ? ru.admin.published : ru.admin.unpublishedChanges;
}

export function CourseAdmin({ courseId, initialLessons, initialTests, initialRoster }: Props) {
  const [lessons, setLessons] = useState(initialLessons);
  const [tests] = useState(initialTests);
  const [roster, setRoster] = useState(initialRoster);
  const [busy, setBusy] = useState(false);
  // The Lesson the confirmation is about, and the name typed into it. Held as one
  // pair so two confirmations cannot be open at once, and cleared together.
  const [doomed, setDoomed] = useState<LessonEntry | null>(null);
  const [typedTitle, setTypedTitle] = useState('');
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
      const { ok, body } = await post(`/api/admin/courses/${courseId}/lessons`, {
        title: ru.admin.newLessonTitle,
      });
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
      const { ok, body } = await post(`/api/admin/courses/${courseId}/tests`, {
        title: ru.admin.newTestTitle,
      });
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

  // Everything the Lesson had, gone. The typed name is sent rather than merely
  // checked here: the endpoint refuses a request whose name does not match, so a
  // confirmation nobody can route around is a rule on the server and not a
  // disabled button in a dialog.
  async function removeLesson() {
    if (doomed === null) return;
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/admin/lessons/${doomed.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: typedTitle }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || body?.ok !== true) return report(body);
      setLessons((current) => current.filter((lesson) => lesson.id !== doomed.id));
      setNotice(ru.admin.lessonDeleted(doomed.title));
      setDoomed(null);
      setTypedTitle('');
    } catch {
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

  const canDelete = doomed !== null && typedTitle.trim() === doomed.title.trim();

  return (
    <>
    <div className="sideBySide">
      {/* One section, one frame — and now two sections rather than four: the two
          forms that used to stand under these lists are the plus in each list's
          own corner. */}
      <div className="main sections">
      <section className="panel">
      <div className="panelHead">
        <h2>{ru.admin.lessonsTitle}</h2>
        <ActionIcon
          variant="default" size="lg"
          aria-label={ru.admin.createLesson}
          title={ru.admin.createLesson}
          onClick={addLesson}
          disabled={busy}
        >
          {PlusIcon}
        </ActionIcon>
      </div>
      {lessons.length === 0 ? (
        <p className="muted">{ru.admin.noLessons}</p>
      ) : (
        <ol className="cards">
          {lessons.map((lesson, index) => (
            <li key={lesson.id}>
              {/* Title over standing rather than one long line. A Lesson's name
                  is as long as its name is, and beside it on one line it pushed
                  the three controls until they wrapped — so «Выше» and «Ниже»
                  sat side by side on one row and stacked on the next. */}
              <span className="body">
                <a href={`/admin/lessons/${lesson.id}`}>{lesson.title}</a>
                <span className="muted">
                  {publicationLabel(lesson.publication)}
                  {' · '}{ru.admin.exerciseCount(lesson.exerciseCount)}
                </span>
              </span>
              <span className="actions">
                <ActionIcon
                  variant="default"
                  aria-label={ru.common.moveUp}
                  title={ru.common.moveUp}
                  onClick={() => move(index, -1)}
                  disabled={busy || index === 0}
                >
                  {UpIcon}
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  aria-label={ru.common.moveDown}
                  title={ru.common.moveDown}
                  onClick={() => move(index, 1)}
                  disabled={busy || index === lessons.length - 1}
                >
                  {DownIcon}
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  className="danger"
                  aria-label={ru.admin.deleteLesson}
                  title={ru.admin.deleteLesson}
                  onClick={() => { clearMessages(); setTypedTitle(''); setDoomed(lesson); }}
                  disabled={busy}
                >
                  {TrashIcon}
                </ActionIcon>
              </span>
            </li>
          ))}
        </ol>
      )}
      </section>

      <section className="panel">
      <div className="panelHead">
        <h2>{ru.admin.testsTitle}</h2>
        <ActionIcon
          variant="default" size="lg"
          aria-label={ru.admin.createTest}
          title={ru.admin.createTest}
          onClick={addTest}
          disabled={busy}
        >
          {PlusIcon}
        </ActionIcon>
      </div>
      {tests.length === 0 ? (
        <p className="muted">{ru.admin.noTests}</p>
      ) : (
        <ul className="cards">
          {tests.map((test) => (
            <li key={test.id}>
              <span className="body">
                <a href={`/admin/tests/${test.id}`}>{test.title}</a>
                <span className="muted">
                  {test.published ? ru.testAdmin.published : ru.testAdmin.unpublished}
                  {' · '}{ru.admin.exerciseCount(test.exerciseCount)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      </section>
      </div>

      {/* Who can reach the Course at all, beside the Course rather than after
          it: it is a fact about this Course, not the last item in its Lessons. */}
      <div className="side panel">
      <h2>{ru.admin.rosterTitle}</h2>
      <p className="muted">{ru.admin.rosterHint}</p>
      {roster.length === 0 ? (
        <p className="muted">{ru.admin.noStudents}</p>
      ) : (
        <ul className="cards">
          {roster.map((entry) => (
            <li key={entry.id}>
              {/* Name over standing, and a standing on every row including the
                  one that has nothing to say. This column is twenty rem wide:
                  «debug_student — Записан» beside a button on one line was a row
                  whose button hung through the frame and whose words took two
                  lines while its neighbour's took one. */}
              <span className="body">
                <span>{entry.username}</span>
                <span className="muted">
                  {entry.enrolled ? ru.admin.enrolledAlready : ru.admin.notEnrolled}
                </span>
              </span>
              <span className="actions">
                {entry.enrolled ? (
                  <Button variant="default" size="compact-sm" onClick={() => withdraw(entry.id)} disabled={busy}>
                    {busy ? ru.admin.withdrawing : ru.admin.withdraw}
                  </Button>
                ) : (
                  <Button size="compact-sm" onClick={() => enroll(entry.id)} disabled={busy}>
                    {busy ? ru.admin.enrolling : ru.admin.enroll}
                  </Button>
                )}
              </span>
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
      </div>
    </div>

    {/* The confirmation names what goes rather than asking whether the Admin is
        sure, and it asks for the Lesson's own title typed out. A second button
        would be a click tax on an act that is one press away from destroying
        every answer a Student ever gave in this Lesson; a name is a sentence you
        cannot type by accident. */}
    <Modal
      opened={doomed !== null}
      onClose={() => { setDoomed(null); setTypedTitle(''); }}
      title={doomed === null ? '' : ru.admin.deleteLessonTitle(doomed.title)}
      centered
      closeButtonProps={{ 'aria-label': ru.common.close }}
    >
      {doomed === null ? null : (
        <div className="confirmPane">
          <p className="error">{ru.admin.deleteLessonWhatGoes}</p>
          <p className="muted">
            {doomed.submissionCount === 0
              ? ru.admin.deleteLessonNoSubmissions
              : ru.admin.deleteLessonSubmissions(doomed.submissionCount)}
          </p>

          <TextInput
            label={ru.admin.deleteLessonConfirmField}
            description={ru.admin.deleteLessonConfirmHint(doomed.title)}
            value={typedTitle}
            disabled={busy}
            data-autofocus
            onChange={(event) => setTypedTitle(event.currentTarget.value)}
          />

          <p className="actions">
            {/* The ordinary primary button, like the publish confirmation. The
                weight of this act is carried by the sentence above it and by
                having to type the Lesson's name — not by a second red, which
                this palette does not have as a fill and could not measure for
                contrast in both themes if it did. */}
            <Button onClick={removeLesson} disabled={busy || !canDelete}>
              {busy ? ru.admin.deletingLesson : ru.admin.confirmDeleteLesson}
            </Button>
            <Button
              variant="default"
              onClick={() => { setDoomed(null); setTypedTitle(''); }}
              disabled={busy}
            >
              {ru.common.cancel}
            </Button>
          </p>
        </div>
      )}
    </Modal>
    </>
  );
}
