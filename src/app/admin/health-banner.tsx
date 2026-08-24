// Whether grading works, on a page that did not spend a Grader call to find out.
//
// The same result the health page shows after the button is pressed, read back
// from the last recorded run instead of produced. Four states, because two of
// them are not about the Grader at all — see `healthStanding`, which decides
// which one this is and is where the reasoning lives.

import { ru } from '../../ru.ts';
import type { HealthStanding } from '../../ops/health-history.ts';

/**
 * Four states, and four ways of looking — which they did not have. `unhealthy`
 * and `stale` were both plain red and told apart by their wording alone, and
 * they are not the same claim: one says grading was tried and failed, the other
 * says nobody has tried recently enough for the answer to mean anything. Stale
 * keeps its red, because a check that passed a week ago is not evidence that
 * grading works this afternoon, and takes a broken rail — evidence that has
 * lapsed rather than evidence of a fault.
 *
 * `never` is muted and dotted rather than red: an absence of evidence is not a
 * failure, and a dashboard that cried wolf on a fresh install would be trained
 * away within a week.
 */
const TONE: Record<HealthStanding['state'], string> = {
  never: 'bannerNever',
  healthy: 'bannerHealthy',
  unhealthy: 'bannerUnhealthy',
  stale: 'bannerStale',
};

const HEADLINE: Record<HealthStanding['state'], string> = {
  never: ru.health.never,
  healthy: ru.health.healthy,
  unhealthy: ru.health.unhealthy,
  stale: ru.health.stale,
};

const HINT: Record<HealthStanding['state'], string | null> = {
  never: ru.health.neverHint,
  healthy: null,
  unhealthy: null,
  stale: ru.health.staleHint,
};

export function HealthBanner({ standing }: { standing: HealthStanding }) {
  const { state, check } = standing;
  const hint = HINT[state];

  return (
    <section className={`healthBanner ${state}`}>
      <p className={TONE[state]}>{HEADLINE[state]}</p>
      {hint === null ? null : <p className="muted">{hint}</p>}

      {check === null ? null : (
        <p className="muted">
          {ru.health.lastRunAt(new Date(check.ranAt).toLocaleString(ru.locale))}
          {' · '}{ru.health.ranBy[check.source] ?? check.source}
          {' · '}{ru.health.tookMs(check.wallMs)}
        </p>
      )}

      {/* What the run said, where it failed — including a run that has since
          gone stale, which is red for its own reason but still knows why it
          failed. Both heuristics stay phrased as guesses, per ADR 0001. */}
      {check !== null && !check.healthy ? (
        <>
          {check.reason === null ? null : <p className="muted">{ru.health.reason(check.reason)}</p>}
          {check.likelyCredentials ? <p className="error">{ru.health.likelyCredentials}</p> : null}
          {check.likelyEgress ? <p className="error">{ru.health.likelyEgress}</p> : null}
        </>
      ) : null}
    </section>
  );
}
