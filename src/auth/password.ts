// argon2id via @node-rs/argon2, which ships prebuilt aarch64 binaries — a native
// compile step on the Pi is a deployment hazard for no benefit.

import { hash, hashSync, verify } from '@node-rs/argon2';

// @node-rs/argon2 exposes Algorithm as a `declare const enum`, which has no
// runtime value and cannot be imported under verbatimModuleSyntax. 2 is
// Argon2id (0 = Argon2d, 1 = Argon2i). Stated explicitly rather than left to
// the library default, because which variant hashes our passwords is not a
// detail to inherit silently.
const ARGON2ID = 2;

const OPTIONS = { algorithm: ARGON2ID } as const;

// The seed script is a one-shot CLI with nothing else to serve, so it blocks.
// Nothing that answers a request may: argon2 is deliberately expensive, and a
// synchronous hash on a Pi with one Student mid-Practice stops the event loop
// for every one of them.
export function hashPasswordSync(password: string): string {
  return hashSync(password, OPTIONS);
}

// The same hash, for the two paths that run inside a request — an Admin creating
// an account, and a Student choosing their own password.
export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // A malformed or truncated hash is a failed verification, never a crash on
    // the login path.
    return false;
  }
}
