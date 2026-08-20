// The reason build-order step 2 exists.
//
// One real Grader call against a fixed known input, through exactly the Grader
// module every Submission will use. A green result here means the credentials
// path of ADR 0001 works in the shape it actually ships — under systemd, as the
// service user, with the service's real HOME — and not that a simpler path built
// for the check works.

import { grade, type GradeRequest } from './grade.ts';

// English, so the check runs on the faster of the two Grader models (ADR 0002).
// The answer has one planted error: the missing indefinite article.
const KNOWN_INPUT: GradeRequest = {
  model: 'claude-sonnet-5',
  submission: 'I have cat.',
  context: {
    language: 'en',
    level: 'A1',
    lessonTitle: 'Present Simple и артикли',
    grammarFocus: 'Indefinite article with countable nouns',
    prompt: 'Переведите на английский: У меня есть кошка.',
    referenceAnswer: 'I have a cat.',
    acceptedVariants: ['I have got a cat.'],
    priorSubmissions: [],
  },
};

export type HealthResult = {
  healthy: boolean;
  wallMs: number;
  /** Present only when unhealthy. */
  reason: string | null;
  /** A heuristic. ADR 0001: this failure does not present as an auth error. */
  likelyCredentials: boolean;
  /** Also a heuristic: credentials readable, but the request never left the box. */
  likelyEgress: boolean;
  /** Shown to the Admin so a green result can still be eyeballed. */
  detail: {
    verdict: string | null;
    errorCount: number | null;
    contextTokens: number | null;
    modelsInvoked: string[];
    wasFenced: boolean;
    unknownErrorTypes: string[];
  };
};

export async function runHealthCheck(): Promise<HealthResult> {
  const outcome = await grade(KNOWN_INPUT).result;

  if (!outcome.ok) {
    return {
      healthy: false,
      wallMs: Math.round(outcome.wallMs),
      reason: outcome.failure.reason,
      likelyCredentials: outcome.failure.likelyCredentials,
      likelyEgress: outcome.failure.likelyEgress,
      detail: {
        verdict: null, errorCount: null,
        contextTokens: outcome.usage.contextTokens,
        modelsInvoked: outcome.usage.modelsInvoked,
        wasFenced: false, unknownErrorTypes: [],
      },
    };
  }

  // Healthy means the contract held end to end: a real call returned parseable,
  // enum-clean JSON. It deliberately does not assert the model's judgement —
  // this check proves the path, not the pedagogy.
  return {
    healthy: true,
    wallMs: Math.round(outcome.wallMs),
    reason: null,
    likelyCredentials: false,
    likelyEgress: false,
    detail: {
      verdict: outcome.guarded.verdict,
      errorCount: outcome.response.errors.length,
      contextTokens: outcome.usage.contextTokens,
      modelsInvoked: outcome.usage.modelsInvoked,
      wasFenced: outcome.wasFenced,
      unknownErrorTypes: outcome.unknownErrorTypes,
    },
  };
}
