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
