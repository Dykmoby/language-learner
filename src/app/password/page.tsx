// Choosing your own password.
//
// One screen for two arrivals, and the difference between them is a sentence
// rather than a second form. A Student sent here by the middleware is holding a
// Temporary Password and can go nowhere else until they replace it; a Student
// who came here on purpose is changing a password that is already theirs. The
// fields, the rules and the endpoint are identical, and the only thing that
// varies is what the screen says about why they are standing in front of it.
//
// A plain server-rendered form with no client JavaScript, like the sign-in
// screen it follows on from — and for a stronger version of the same reason. The
// one thing that must never fail here is the ability to replace a password
// somebody else knows, and a form that needs a bundle to load first is a form
// with one more way to not be there.

import { ru, faultMessage } from '../../ru.ts';
import { currentStudent } from '../../auth/current-student.ts';
import { ACCOUNT_FAULTS } from '../../auth/accounts.ts';

export const dynamic = 'force-dynamic';

const KNOWN_FAULTS = new Set<string>(ACCOUNT_FAULTS);

/**
 * The refusals to show, read out of the query string.
 *
 * The value arrives in a URL anyone can edit, so an unrecognised code becomes no
 * message rather than a message nobody wrote. Everywhere else in the application
 * an unknown fault code is shown as it came — deliberately, so a real fault is
 * never silently hidden from the person who has to fix it — but everywhere else
 * the code came from the server. Here it came from the address bar, and a screen
 * that turns whatever is in the address bar into a sentence is a screen somebody
 * can put a sentence on.
 */
function faultsFrom(raw: string | string[] | undefined): string[] {
  const codes = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return codes.filter((code) => KNOWN_FAULTS.has(code));
}

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const student = await currentStudent();
  const params = await searchParams;

  // The middleware has already turned away anyone without a session; this is the
  // narrowing, not a second gate.
  const forced = student?.passwordIsTemporary ?? false;
  const faults = faultsFrom(params.error);
  const changed = params.changed !== undefined && faults.length === 0;

  return (
    <main className="signIn">
      <h1>{ru.password.title}</h1>

      {changed ? (
        <>
          <p className="ok" role="status">{ru.password.changed}</p>
          <p className="actions"><a className="button" href="/">{ru.password.onward}</a></p>
        </>
      ) : null}

      <p className="lead">{forced ? ru.password.forcedLead : ru.password.voluntaryLead}</p>

      {faults.length === 0 ? null : (
        <ul className="cards" role="alert">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}

      <form method="post" action="/api/password">
        <label>
          <span>{forced ? ru.password.temporaryField : ru.password.currentField}</span>
          <input type="password" name="current" autoComplete="current-password" required autoFocus />
        </label>
        <label>
          <span>{ru.password.newField}</span>
          <input type="password" name="next" autoComplete="new-password" required />
        </label>
        <label>
          <span>{ru.password.confirmField}</span>
          <input type="password" name="confirmation" autoComplete="new-password" required />
        </label>
        <p className="muted">{ru.password.lengthHint}</p>
        <button type="submit">{ru.password.submit}</button>
      </form>

      {/* Every other session of this account is signed out by the change, and
          that is worth saying before it happens rather than discovering on the
          other device. */}
      <p className="muted">{ru.password.otherSessionsHint}</p>
    </main>
  );
}
