// The order the choices of one Exercise are put in front of the Student, as a
// permutation of the order they were authored in.
//
// The authored order is not neutral. Whatever writes an Exercise writes its
// answer at the same time, and it writes them in the order it is thinking in:
// the fragments of a word order come out already arranged into the sentence,
// and the right option of a multiple choice lands first or second far more
// often than it lands fourth. Neither is a fact about the Exercise — both are
// habits of the author — and a Student who notices either is answering the
// habit rather than the question.
//
// So the order is decided in the browser, on the way to the screen, and the
// authored order is shown nowhere a Student answers. Nothing on the server
// changes: an answer is submitted as the text that was chosen or built, so
// where that text sat on the screen was never something the check knew.
//
// A permutation of positions rather than a reordered list of strings, because
// two identical fragments in one sentence are two fragments — the word order
// tells them apart by where they sit, and a list of strings would lose that.

/** The authored order: what is rendered before anything has been shuffled. */
export function inOrder(count: number): number[] {
  return Array.from({ length: count }, (_, at) => at);
}

/**
 * A shuffled order. Every position appears exactly once, and no attempt is made
 * to avoid landing back on the authored order — a shuffle that refused to
 * produce one particular arrangement would be a shuffle a Student could learn
 * something from, and with two fragments it would be no shuffle at all.
 */
export function shuffle(count: number, random: () => number = Math.random): number[] {
  const order = inOrder(count);

  for (let at = order.length - 1; at > 0; at -= 1) {
    // Clamped: `Math.random` never returns 1, but this takes any random, and one
    // that did would otherwise pick a position that is not there.
    const swap = Math.min(at, Math.floor(random() * (at + 1)));
    const held = order[at] ?? at;
    order[at] = order[swap] ?? swap;
    order[swap] = held;
  }

  return order;
}

/**
 * Whether something read back out of storage is still an order for this many
 * choices. An Admin can edit an Exercise between two visits in one session, so
 * a remembered order is not to be trusted for being one — a shorter one would
 * drop a choice off the screen, and a repeated position would show one twice.
 */
export function isOrder(value: unknown, count: number): value is number[] {
  if (!Array.isArray(value) || value.length !== count) return false;

  const seen = new Set<unknown>();
  for (const at of value) {
    if (!Number.isInteger(at) || at < 0 || at >= count || seen.has(at)) return false;
    seen.add(at);
  }

  return true;
}
