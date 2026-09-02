// How much reasoning Claude applies to a call — design.md § Authoring's Effort,
// chosen per request by the Admin.
//
// A module of its own, and a tiny one, for the reason the Exercise Kinds have
// theirs: the picker that offers these runs in the browser, and the harness that
// sends them spawns a subprocess and reads ~/.claude. A constant they shared
// through the harness would drag the whole Agent SDK into the client bundle.
//
// Five entries, and there is deliberately no sixth. «По умолчанию» is the
// *absence* of the parameter rather than a value of it, so it is expressed by
// `Effort | undefined` at every call site and by `null` in the one place a
// `<select>` has to name it.
//
// There is no thinking toggle either. `low` is the fast path, and disabling
// thinking is rejected outright at `xhigh`/`max` on Opus 5 and causes tool-call
// and tag leakage elsewhere — which is precisely what would corrupt a strict
// document contract.

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * Whether an untrusted value names an Effort.
 *
 * Here rather than at each of the three places that read one out of JSON — two
 * endpoints and an exported Course file — because the list is here, and a copy
 * of the membership test somewhere else is a copy that keeps its old five
 * entries the day a sixth is added. What each caller does with "no" differs, and
 * that part stays with the caller: an endpoint refuses the request, and a file
 * from an older format has no Effort in it at all.
 */
export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value);
}

/**
 * How much longer a call gets at each Effort, as a multiple of its base timeout.
 *
 * Raising the Effort has to raise the timeout with it or the setting only
 * pretends to work: the Grader's hard timeout is sized for `low`, and at a high
 * Effort the call would reliably exceed it — the Student would see a failed
 * grading instead of a Verdict, which reads as the application being broken
 * rather than as the setting an Admin chose.
 *
 * The factors are measured against the Grader's own 90s base, giving roughly
 * 90 / 180 / 300 / 480 / 720 seconds. They are factors rather than five absolute
 * numbers because the Test batch path scales from its own, much longer base by
 * the same ladder — a batch is many answers at once, and its clock was already
 * different before Effort was a choice.
 *
 * They bound a call that has stopped coming back. None of them is what an
 * ordinary Verdict costs.
 */
export const EFFORT_TIMEOUT_FACTOR = {
  low: 1,
  medium: 2,
  high: 10 / 3,
  xhigh: 16 / 3,
  max: 8,
} as const satisfies Record<Effort, number>;

/**
 * The factor for «По умолчанию», where the parameter is not sent at all.
 *
 * The absence of the parameter is a real choice and not a level, so there is no
 * entry for it above: what the model will spend is its own decision and cannot
 * be looked up from here. It takes the middle of the ladder rather than either
 * end. The floor would fail a Course that happens to grade slowly, which is the
 * exact failure this whole ladder exists to prevent; the ceiling would make a
 * call that has genuinely hung cost a Student twelve minutes in front of a
 * «Проверяю…» they never asked for.
 */
export const DEFAULT_EFFORT_TIMEOUT_FACTOR = EFFORT_TIMEOUT_FACTOR.high;

/**
 * A base timeout, scaled to the Effort the call will run at.
 *
 * `null` is «По умолчанию» — the parameter is not sent — and is the one input
 * that is not a level.
 */
export function effortTimeoutMs(baseMs: number, effort: Effort | null): number {
  const factor = effort === null ? DEFAULT_EFFORT_TIMEOUT_FACTOR : EFFORT_TIMEOUT_FACTOR[effort];
  return Math.round(baseMs * factor);
}
