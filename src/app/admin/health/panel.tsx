'use client';

import { useState } from 'react';
import { ru } from '../../../ru.ts';
import type { HealthResult } from '../../../grader/health-check.ts';

export function HealthPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<HealthResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function run() {
    setRunning(true);
    setResult(null);
    setFailed(false);
    try {
      const response = await fetch('/api/admin/health', { method: 'POST' });
      if (!response.ok) throw new Error(String(response.status));
      setResult((await response.json()) as HealthResult);
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button type="button" onClick={run} disabled={running}>
        {running ? ru.health.running : ru.health.run}
      </button>

      {failed ? <p className="error">{ru.errors.serverError}</p> : null}

      {result ? (
        <div>
          <p className={result.healthy ? 'ok' : 'error'}>
            {result.healthy ? ru.health.healthy : ru.health.unhealthy}
          </p>
          <p className="muted">{ru.health.tookMs(result.wallMs)}</p>
          {result.reason ? <p className="muted">{ru.health.reason(result.reason)}</p> : null}
          {result.likelyCredentials ? <p className="error">{ru.health.likelyCredentials}</p> : null}
          {result.likelyEgress ? <p className="error">{ru.health.likelyEgress}</p> : null}
          {/* Muted rather than red, deliberately: the other two say something on
              this box is broken and want fixing, and this one says the API is
              busy and wants waiting out. The result above it is still red — the
              check really did fail — and this line says why without dressing a
              queue as a fault. */}
          {result.likelyRateLimit ? <p className="muted">{ru.health.likelyRateLimit}</p> : null}
        </div>
      ) : null}
    </>
  );
}
