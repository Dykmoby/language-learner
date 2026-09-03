'use client';

// The accounts of this application, from the one screen that can add to them and
// take them away.
//
// Two things here are unlike the rest of the Admin section, and both are because
// the acts are unlike the rest of the Admin section.
//
// A Temporary Password is shown once and never again. It arrives in the response
// to the request that made the account, is held in this component's state, and
// goes when the tab does — nothing stores it and no later request can ask for it
// back. So the panel that shows it says so, plainly, before the Admin navigates
// away from it.
//
// And deleting takes two presses. Every other button in this section writes
// something an Admin can rewrite; this one removes a person's Submissions,
// Attempts and Disputes along with their account, and there is no Draft history
// behind an account to restore it from. The second press is not a modal and not
// a typed confirmation — it is the same button having plainly changed into a
// different one, which is enough to stop a mis-click and short enough not to
// become something to click twice out of habit.

import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { ru, faultMessage } from '../../../ru.ts';

export type AccountRow = {
  id: number;
  username: string;
  isAdmin: boolean;
  passwordIsTemporary: boolean;
  enrollmentCount: number;
  /** Formatted on the server: a client component and a server render disagree about locales. */
  createdAt: string;
};

type Props = {
  initialAccounts: AccountRow[];
  /** The Admin looking at the screen. Their own row offers no delete button. */
  actingStudentId: number;
};

type Issued = { username: string; temporaryPassword: string };

export function StudentsAdmin({ initialAccounts, actingStudentId }: Props) {
  const [accounts, setAccounts] = useState(initialAccounts);
  const [username, setUsername] = useState('');
  const [issued, setIssued] = useState<Issued | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function clearMessages() {
    setFaults([]);
    setProblem(null);
    setNotice(null);
  }

  function report(body: Record<string, unknown> | null) {
    const codes = Array.isArray(body?.faults) ? (body.faults as string[]) : [];
    setFaults(codes);
    if (codes.length === 0) setProblem(ru.admin.writeFailed);
  }

  async function create() {
    setBusy(true);
    clearMessages();
    // The previous one goes the moment another account is made: two passwords on
    // one screen is how the wrong one gets read out.
    setIssued(null);
    try {
      const response = await fetch('/api/admin/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || body?.ok !== true) return report(body);

      const student = body.student as { id: number; username: string };
      setAccounts((current) => [...current, {
        id: student.id,
        username: student.username,
        isAdmin: false,
        passwordIsTemporary: true,
        enrollmentCount: 0,
        createdAt: '',
      }]);
      setIssued({ username: student.username, temporaryPassword: body.temporaryPassword as string });
      setUsername('');
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setBusy(true);
    clearMessages();
    try {
      const response = await fetch(`/api/admin/students/${id}`, { method: 'DELETE' });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || body?.ok !== true) return report(body);

      setAccounts((current) => current.filter((account) => account.id !== id));
      setNotice(ru.admin.accountDeleted(body.username as string));
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setConfirming(null);
      setBusy(false);
    }
  }

  return (
    <>
      <h2>{ru.admin.accountsListTitle}</h2>
      <p className="muted">{ru.admin.accountsHint}</p>

      <ul className="cards">
        {accounts.map((account) => (
          <li key={account.id}>
            {account.username}
            <span className="muted">
              {account.isAdmin ? ` — ${ru.home.adminBadge}` : ''}
              {' · '}{ru.admin.enrollmentCount(account.enrollmentCount)}
              {account.createdAt === '' ? '' : ` · ${ru.admin.accountCreatedAt(account.createdAt)}`}
            </span>
            {account.passwordIsTemporary ? (
              <>
                <br />
                <span className="muted">{ru.admin.temporaryPasswordStanding}</span>
              </>
            ) : null}

            {/* An Admin cannot be deleted here at all, and neither can the person
                doing the deleting. Both are refused by the endpoint as well —
                this is the half a person sees, not the rule itself. */}
            {account.isAdmin || account.id === actingStudentId ? (
              <>
                <br />
                <span className="muted">
                  {account.id === actingStudentId ? ru.admin.cannotDeleteSelfHint : ru.admin.cannotDeleteAdminHint}
                </span>
              </>
            ) : confirming === account.id ? (
              <span className="actions">
                <span className="error">{ru.admin.deleteWarning(account.username)}</span>
                <Button color="red" onClick={() => remove(account.id)} disabled={busy}>
                  {busy ? ru.admin.deletingAccount : ru.admin.confirmDeleteAccount}
                </Button>
                <Button variant="default" onClick={() => setConfirming(null)} disabled={busy}>
                  {ru.common.cancel}
                </Button>
              </span>
            ) : (
              <span className="actions">
                <Button
                  variant="default"
                  onClick={() => { clearMessages(); setConfirming(account.id); }}
                  disabled={busy}
                >
                  {ru.admin.deleteAccount}
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>

      <h2>{ru.admin.newAccountTitle}</h2>
      <p className="muted">{ru.admin.newAccountHint}</p>
      <TextInput
        label={ru.admin.usernameField}
        value={username}
        autoComplete="off"
        disabled={busy}
        onChange={(event) => { setUsername(event.currentTarget.value); clearMessages(); }}
      />
      <p className="actions">
        <Button onClick={create} disabled={busy}>
          {busy ? ru.admin.creatingAccount : ru.admin.createAccount}
        </Button>
      </p>

      {issued === null ? null : (
        <div className="issuedPassword">
          <h3>{ru.admin.temporaryPasswordTitle}</h3>
          <p>{ru.admin.temporaryPasswordFor(issued.username)}</p>
          {/* Selectable, large, and monospaced: it exists to be read out or
              copied, once. */}
          <p className="temporaryPassword"><code>{issued.temporaryPassword}</code></p>
          <p className="muted">{ru.admin.temporaryPasswordOnce}</p>
          <p className="muted">{ru.admin.temporaryPasswordRule}</p>
        </div>
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
