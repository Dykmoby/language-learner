import { ru } from '../../ru.ts';

// The failure reason travels as a query parameter so this page stays a plain
// server-rendered form with no client JavaScript. It never names which field was
// wrong — that is a decision, not an omission.
function messageFor(params: Record<string, string | string[] | undefined>): string | null {
  const error = typeof params.error === 'string' ? params.error : null;
  if (!error) return null;

  const number = (key: string, fallback: number) => {
    const raw = params[key];
    const n = typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.ceil(n) : fallback;
  };

  if (error === 'locked') return ru.login.lockedOut(number('minutes', 15));
  if (error === 'slow') return ru.login.slowDown(number('seconds', 2));
  return ru.login.invalid;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const message = messageFor(await searchParams);

  return (
    <main>
      <h1>{ru.login.title}</h1>
      {message ? <p className="error" role="alert">{message}</p> : null}
      <form method="post" action="/api/login">
        <label>
          <span>{ru.login.username}</span>
          <input type="text" name="username" autoComplete="username" required autoFocus />
        </label>
        <label>
          <span>{ru.login.password}</span>
          <input type="password" name="password" autoComplete="current-password" required />
        </label>
        <button type="submit">{ru.login.submit}</button>
      </form>
    </main>
  );
}
