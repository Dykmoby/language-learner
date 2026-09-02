// How unstable the Verdict actually is, measured rather than remembered.
//
// design.md § Open risks carried an anecdote: five identical calls returned
// `partially_correct` ×3 and `incorrect` ×2, **with an identical error list
// every time**. One case, one model. Enough to know something is there and not
// enough to decide anything — and the Coherence Guard does not address it,
// because the output is coherent every run. It is the label that moves, not the
// reasoning.
//
// So this is the same shape as the step-0 and step-1 spikes: N identical calls
// per case per model, over cases chosen to sit at the `partially_correct` /
// `incorrect` boundary, with a clearly-correct and a clearly-wrong case as
// controls — because a measurement of instability has to show where there
// isn't any.
//
// **It produces a measurement, not a behaviour change.** What a Student should
// read when the label is unreproducible is a product decision; this is what
// makes it answerable. Progression is unaffected either way — neither Verdict
// advances the Student.
//
// It spends real Grader calls: N per case per model. Nothing here is run by the
// application, by a test, or by a timer.
//
//   node src/ops/verdict-stability.ts [--runs N]

import { fileURLToPath } from 'node:url';
import { grade } from '../grader/grade.ts';
import { SHIPPED_GUIDANCE } from '../grader/guidance.ts';
import type { ExerciseContext, GraderError, Verdict } from '../grader/contract.ts';

/**
 * Both Grader models on every case, deliberately crossing ADR 0002's per-Language
 * assignment: the question is how stable a model is on one input, and answering
 * it per Language would leave each half resting on one model's temperament.
 */
export const MODELS = ['claude-sonnet-5', 'claude-opus-5'] as const;

export type StabilityCase = {
  id: string;
  /** Why this case is in the set: which side of the boundary it is meant to sit on. */
  why: string;
  context: ExerciseContext;
  submission: string;
};

const EN: Omit<ExerciseContext, 'prompt' | 'referenceAnswer' | 'acceptedVariants'> = {
  language: 'en',
  level: 'A1',
  lessonTitle: 'Present Simple и артикли',
  grammarFocus: 'Articles and subject-verb agreement',
  priorSubmissions: [],
};

export const CASES: StabilityCase[] = [
  {
    id: 'boundary-two-faults',
    why: 'two ordinary A1 faults in a sentence that still communicates: the classic place the label wavers',
    submission: 'I have cat and she like fish.',
    context: {
      ...EN,
      prompt: 'Переведите на английский: У меня есть кошка, и она любит рыбу.',
      referenceAnswer: 'I have a cat and she likes fish.',
      acceptedVariants: ['I have got a cat and she likes fish.'],
    },
  },
  {
    id: 'boundary-tense-and-article',
    why: 'three faults, none of them fatal to the meaning — further from correct, still arguably partial',
    submission: 'Yesterday I go to shop and buyed bread.',
    context: {
      ...EN,
      grammarFocus: 'Past Simple of irregular verbs, and articles',
      lessonTitle: 'Past Simple',
      prompt: 'Переведите на английский: Вчера я ходил в магазин и купил хлеб.',
      referenceAnswer: 'Yesterday I went to the shop and bought some bread.',
      acceptedVariants: ['Yesterday I went to the store and bought bread.'],
    },
  },
  {
    id: 'control-correct',
    why: 'a control: the Reference Answer itself, where there should be no instability at all',
    submission: 'I have a cat.',
    context: {
      ...EN,
      prompt: 'Переведите на английский: У меня есть кошка.',
      referenceAnswer: 'I have a cat.',
      acceptedVariants: ['I have got a cat.'],
    },
  },
  {
    id: 'control-wrong',
    why: 'a control at the other end: an answer that does not attempt the task',
    submission: 'I like pizza very much.',
    context: {
      ...EN,
      prompt: 'Переведите на английский: У меня есть кошка.',
      referenceAnswer: 'I have a cat.',
      acceptedVariants: ['I have got a cat.'],
    },
  },
];

// --- The pure half -----------------------------------------------------------

export type Run = {
  proposed: Verdict | null;
  guarded: Verdict | null;
  /** The faults, as a comparable string. Null where the call failed. */
  errors: string | null;
  failure: string | null;
  wallMs: number;
  costUsd: number | null;
};

/**
 * The error list as one comparable value.
 *
 * Type and span only: the Russian explanation is prose and will differ in wording
 * between two runs that found exactly the same fault, so including it would
 * report instability that is not there. Sorted, because the claim being tested is
 * that the *set* of faults is reproducible while the label is not — two runs that
 * found the same two faults in the other order have not disagreed about anything.
 */
export function errorSignature(errors: readonly GraderError[]): string {
  if (errors.length === 0) return '(none)';
  // Joined with a plus rather than a pipe: this string goes into a markdown
  // table, and a pipe inside a cell ends the cell.
  return errors.map((error) => `${error.type}:${error.span}`).sort().join(' + ');
}

/** How many times each value came back, most frequent first. */
export function distribution(values: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export type CaseSummary = {
  runs: number;
  failures: number;
  /** The Grader's own label, before the Coherence Guard. */
  proposed: Array<[string, number]>;
  /** What a Student would have read. */
  guarded: Array<[string, number]>;
  /** How many runs the guard moved. Kept apart so a firing is not read as instability. */
  guardFirings: number;
  errorLists: Array<[string, number]>;
  /** True where the label moved but the faults did not: the finding the anecdote claimed. */
  labelMovedAlone: boolean;
};

export function summarise(runs: readonly Run[]): CaseSummary {
  const judged = runs.filter((run) => run.guarded !== null);
  const proposed = distribution(judged.map((run) => run.proposed ?? '(none)'));
  const guarded = distribution(judged.map((run) => run.guarded ?? '(none)'));
  const errorLists = distribution(judged.map((run) => run.errors ?? '(none)'));

  return {
    runs: runs.length,
    failures: runs.length - judged.length,
    proposed,
    guarded,
    guardFirings: judged.filter((run) => run.proposed !== run.guarded).length,
    errorLists,
    // The distinction the whole measurement exists to draw. A model that returned
    // three labels off three different error lists is not unstable — it is
    // reading the answer differently each time, which is a different problem with
    // a different fix.
    labelMovedAlone: proposed.length > 1 && errorLists.length === 1,
  };
}

/** One row of the table this prints, as it will be pasted into design.md. */
export function row(caseId: string, model: string, summary: CaseSummary): string {
  const cell = (pairs: Array<[string, number]>) =>
    pairs.map(([value, count]) => `${value} ×${count}`).join(', ') || '—';
  const errors = summary.errorLists.length === 1
    ? `identical (${summary.errorLists[0]![0]})`
    : `${summary.errorLists.length} different lists`;

  return `| ${caseId} | ${model.replace('claude-', '')} | ${cell(summary.proposed)} `
    + `| ${cell(summary.guarded)} | ${summary.guardFirings} | ${errors} |`;
}

// --- The half that spends money ----------------------------------------------

async function measure(subject: StabilityCase, model: string, times: number): Promise<Run[]> {
  const runs: Run[] = [];
  // Sequentially, on purpose. Identical calls are the point, and two of them in
  // flight at once would be measuring the queue as well as the model.
  for (let i = 0; i < times; i += 1) {
    const outcome = await grade({
      // Fixed rather than per Course: this measures the Verdict's run-to-run
      // instability, and varying the Effort between runs would measure something
      // else. `low` is what every earlier measurement was taken at.
      effort: 'low',
      model, context: subject.context, submission: subject.submission,
      // The shipped guidance, so a stability measurement is comparable across installations and across time.
      guidance: SHIPPED_GUIDANCE,
    }).result;
    runs.push(outcome.ok
      ? {
          proposed: outcome.proposedVerdict,
          guarded: outcome.guarded.verdict,
          errors: errorSignature(outcome.response.errors),
          failure: null,
          wallMs: Math.round(outcome.wallMs),
          costUsd: outcome.usage.costUsd,
        }
      : {
          proposed: null, guarded: null, errors: null,
          failure: `${outcome.failure.kind}: ${outcome.failure.reason}`,
          wallMs: Math.round(outcome.wallMs),
          costUsd: outcome.usage.costUsd,
        });
    process.stdout.write('.');
  }
  return runs;
}

// CLI: node src/ops/verdict-stability.ts [--runs N]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--runs');
  const times = flag === -1 ? 5 : Number(process.argv[flag + 1]);
  if (!Number.isInteger(times) || times < 1) throw new Error('--runs must be a positive integer');

  console.log(`${CASES.length} cases × ${MODELS.length} models × ${times} runs`
    + ` = ${CASES.length * MODELS.length * times} real Grader calls\n`);

  const rows: string[] = [];
  const notes: string[] = [];
  let cost = 0;

  for (const subject of CASES) {
    for (const model of MODELS) {
      process.stdout.write(`${subject.id} / ${model} `);
      const runs = await measure(subject, model, times);
      const summary = summarise(runs);
      cost += runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);

      const wall = runs.map((run) => run.wallMs);
      console.log(` ${Math.min(...wall)}-${Math.max(...wall)}ms`);
      rows.push(row(subject.id, model, summary));
      if (summary.failures > 0) {
        notes.push(`${subject.id} / ${model}: ${summary.failures} of ${summary.runs} calls failed`
          + ` — ${runs.find((run) => run.failure)?.failure}`);
      }
      if (summary.labelMovedAlone) {
        notes.push(`${subject.id} / ${model}: the label moved while the error list stayed identical`);
      }
    }
  }

  console.log('\n| case | model | proposed | guarded | guard fired | error list |');
  console.log('|---|---|---|---|---|---|');
  for (const line of rows) console.log(line);

  console.log('\nNotes:');
  for (const note of notes) console.log(`- ${note}`);
  if (notes.length === 0) console.log('- nothing moved anywhere');
  console.log(`\nEstimated cost: $${cost.toFixed(4)}`);

  console.log('\nCases:');
  for (const subject of CASES) console.log(`- ${subject.id}: ${subject.why}`);
}
