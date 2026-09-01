// The password an Admin hands a new Student, and nothing else.
//
// It exists for one journey: an Admin reads it off the screen, says it out loud
// or writes it down, and the Student types it once. Every decision here follows
// from that.
//
// **Generated, never chosen.** The alternative was a field on the New Student
// form, and the alternative is how a two-person application ends up with two
// accounts whose first password was the same word. Nobody picks a good one for
// somebody else.
//
// **Read aloud without ambiguity.** `0`/`O` and `1`/`l`/`I` are dropped from the
// alphabet, and the result is grouped in fours with hyphens. A password that has
// to be dictated and cannot be dictated is a support call, and the support is
// one person.
//
// **Not a secret worth keeping.** It is known to two people from the moment it
// is generated, which is exactly why the account carrying one may do nothing at
// all until it is replaced — `students.password_is_temporary` and the middleware
// are that half of the rule, and this module is the other.

import { randomInt } from 'node:crypto';

// 31 characters: the digits and lowercase Latin, less the five that are read
// back as one another — i, l, o, 0 and 1. Lowercase only: a password dictated
// across a table does not carry case, and asking for it back exactly is how the
// first sign-in fails.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const GROUPS = 3;
const PER_GROUP = 4;

/**
 * A new Temporary Password: twelve characters from a 31-symbol alphabet, in
 * three hyphenated groups — a little under 60 bits.
 *
 * `randomInt` rather than `randomBytes(n) % alphabet.length`: the modulo is
 * biased towards the front of the alphabet, and a CSPRNG used with a bias is a
 * CSPRNG that was not worth reaching for. It draws from the same source and
 * rejects rather than folds.
 */
export function newTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let i = 0; i < PER_GROUP; i += 1) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}
