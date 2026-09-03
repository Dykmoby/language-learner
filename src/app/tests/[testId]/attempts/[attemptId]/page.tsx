// One attempt at a Test, reviewed.
//
// This is the screen the Test existed for: everything it withheld, all at once.
// It is server-rendered from the attempt rather than handed over from the
// submission, so a link to it works months later and a reload costs nothing.

import { notFound } from 'next/navigation';
import { ru } from '../../../../../ru.ts';
import { currentStudent } from '../../../../../auth/current-student.ts';
import { getDatabase } from '../../../../../db/index.ts';
import { openAttempt } from '../../../../../tests/taking.ts';
import { AttemptReview } from './review.tsx';

export const dynamic = 'force-dynamic';

export default async function AttemptPage(
  { params }: { params: Promise<{ testId: string; attemptId: string }> },
) {
  const student = await currentStudent();
  if (!student) notFound();

  const { testId: rawTestId, attemptId: rawAttemptId } = await params;
  const testId = Number(rawTestId);
  const attemptId = Number(rawAttemptId);
  if (!Number.isInteger(testId) || !Number.isInteger(attemptId)) notFound();

  const opened = openAttempt(getDatabase().db, student.id, attemptId);
  // An attempt belonging to another Test — or to another Student — is not this
  // address's business, and is answered as missing rather than as forbidden.
  if (!opened.ok || opened.view.testId !== testId) notFound();

  return (
    <main>
      <div className="pageHead">
        <div>
          <p className="muted">
            <a href={`/tests/${testId}`}>{opened.view.testTitle}</a>
          </p>
          <h1>{ru.test.reviewTitle}</h1>
          <p className="muted">{ru.test.attemptNumber(opened.view.attempt)}</p>
        </div>
      </div>

      <AttemptReview initial={opened.view} />
    </main>
  );
}
