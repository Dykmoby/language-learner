// Seam 1 — a booted application, driven over HTTP with fetch.
//
// This is the primary seam: everything that can be tested here is tested here.
// Tests assert only what an actor outside the module can observe — the status a
// browser receives, the cookie attributes it is given, the Russian string on the
// page. Never hash internals, never session table contents.

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../src/db/client.ts';
import { runMigrations } from '../../src/db/migrate.ts';
import { seedStudents, type SeedAccount } from '../../src/db/seed.ts';
import { seedCourseContent } from '../../src/content/seed-content.ts';
import type { CourseFixture } from '../../src/content/english-a1.ts';
import { tempDatabasePath } from './temp-db.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

export const ADMIN: SeedAccount = { username: 'igor', password: 'correct horse battery', isAdmin: true };
export const STUDENT: SeedAccount = { username: 'student', password: 'staple monkey trombone', isAdmin: false };

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(full));
    else if (/\.(ts|tsx|css)$/.test(entry.name)) newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

// `next start` serves whatever was built last. Without this guard, editing a
// source file and re-running the suite would quietly test the previous build.
function assertBuildIsFresh(): void {
  let builtAt: number;
  try {
    builtAt = statSync(join(REPO, '.next/BUILD_ID')).mtimeMs;
  } catch {
    throw new Error('No production build found. Run `npm run build` before the HTTP tests.');
  }
  const newest = Math.max(newestSourceMtime(join(REPO, 'src')), statSync(join(REPO, 'next.config.ts')).mtimeMs);
  if (newest > builtAt) {
    throw new Error('The production build is older than the sources. Run `npm run build` before the HTTP tests.');
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export type BootedApp = {
  baseUrl: string;
  databasePath: string;
  /** Where uploaded images land. Beside the throwaway database, never in the repo. */
  uploadDir: string;
  /** Restarts the process against the same database file — throttle state must survive it. */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
};

export type BootOptions = {
  accounts?: SeedAccount[];
  /** Extra environment for the child. Used to boot with a deliberately broken HOME. */
  env?: Record<string, string>;
  /**
   * Content to seed, through the same script the Pi runs. Left out by default so
   * a test that is not about Lessons boots an application with none.
   */
  content?: CourseFixture[];
};

async function waitUntilServing(baseUrl: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the application exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/login`, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the application never started: ${String(lastError)}`);
}

export async function bootApp(options: BootOptions = {}): Promise<BootedApp> {
  assertBuildIsFresh();

  const { path: databasePath, cleanup } = tempDatabasePath();
  // Uploads default to `data/uploads` under the working directory, which for a
  // booted test is the repo itself. Pointed at the throwaway directory instead,
  // so a suite that uploads an image leaves nothing behind.
  const uploadDir = join(dirname(databasePath), 'uploads');

  // Seeded through the same modules the application uses, never hand-written SQL.
  const handle = openDatabase(databasePath);
  runMigrations(handle);
  seedStudents(handle.db, options.accounts ?? [ADMIN, STUDENT]);
  for (const fixture of options.content ?? []) seedCourseContent(handle.db, fixture);
  handle.close();

  let child: ChildProcess | null = null;
  let baseUrl = '';

  const start = async () => {
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)],
      {
        cwd: REPO,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          DATABASE_PATH: databasePath,
          UPLOAD_DIR: uploadDir,
          // The tests speak plain HTTP to localhost, but the cookie's Secure flag
          // is an acceptance criterion, so it stays on and is asserted.
          SESSION_COOKIE_SECURE: 'true',
          ...options.env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    await waitUntilServing(baseUrl, child);
  };

  const stopChild = async () => {
    const current = child;
    if (!current || current.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      current.once('exit', () => resolve());
      current.kill('SIGTERM');
      setTimeout(() => current.kill('SIGKILL'), 5000).unref();
    });
  };

  await start();

  return {
    get baseUrl() { return baseUrl; },
    databasePath,
    uploadDir,
    restart: async () => { await stopChild(); await start(); },
    stop: async () => { await stopChild(); cleanup(); },
  };
}

// --- a browser-ish cookie jar ------------------------------------------------

export class Client {
  #cookies = new Map<string, string>();
  #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  get cookieHeader(): string {
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  setRawCookie(name: string, value: string): void {
    this.#cookies.set(name, value);
  }

  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader;
    if (cookie) headers.set('cookie', cookie);

    const response = await fetch(`${this.#baseUrl}${path}`, { ...init, headers, redirect: 'manual' });

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(raw)) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
    return response;
  }

  async signIn(username: string, password: string): Promise<Response> {
    return this.fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }).toString(),
    });
  }
}

export function setCookieFor(response: Response, name: string): string | null {
  return response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? null;
}
