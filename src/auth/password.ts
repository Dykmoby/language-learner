// argon2id via @node-rs/argon2, which ships prebuilt aarch64 binaries — a native
// compile step on the Pi is a deployment hazard for no benefit.

import { hashSync, verify } from '@node-rs/argon2';

// @node-rs/argon2 exposes Algorithm as a `declare const enum`, which has no
// runtime value and cannot be imported under verbatimModuleSyntax. 2 is
// Argon2id (0 = Argon2d, 1 = Argon2i). Stated explicitly rather than left to
// the library default, because which variant hashes our passwords is not a
// detail to inherit silently.
const ARGON2ID = 2;

const OPTIONS = { algorithm: ARGON2ID } as const;

// Hashing happens only in the seed script, a one-shot CLI with nothing else to
// serve, so it blocks. Verification on the login path is async — argon2 is
// deliberately expensive and must not sit on the event loop.
export function hashPasswordSync(password: string): string {
  return hashSync(password, OPTIONS);
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
