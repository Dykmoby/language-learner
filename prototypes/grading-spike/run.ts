// PROTOTYPE — throwaway measurement harness. Not production code.
// Question: does the Agent SDK path (harness prompt stripped, tools off) beat the
// 16-19s claude -p baseline in design.md, and does the JSON contract hold?
// This is build-order step 1: the go/no-go.

import { writeFileSync, mkdirSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { CASES, type Case } from './cases.ts';
import {
  buildSystemPrompt, buildUserPrompt, buildStudentBlock,
  parseGraderOutput, validateErrorTypes, coherenceGuard,
} from './grader.ts';

const TIMEOUT_MS = 90_000; // design.md § Grading: 90s hard timeout

// Two arms, because design.md contradicts itself. § Grading says "thinking off";
// § Authoring says disabling thinking on Opus 5 causes tag leakage. Tag leakage
// corrupts a strict JSON contract, so this is measured, not assumed.
const ARMS = {
  'thinking-off': { thinking: { type: 'disabled' as const } },
  'adaptive-low': { thinking: { type: 'adaptive' as const }, effort: 'low' as const },
};
type ArmName = keyof typeof ARMS;

type Measurement = {
  caseId: string;
  arm: ArmName;
  model: string;
  ok: boolean;
  wallMs: number;
  sdkDurationMs: number | null;
  sdkApiMs: number | null;
  firstEventMs: number | null;
  firstTextMs: number | null;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  parseOk: boolean;
  wasFenced: boolean;
  fieldOrderOk: boolean;
  fieldOrder: string[];
  badEnumTypes: string[];
  rawVerdict: string | null;
  guardedVerdict: string | null;
  guardChanged: boolean;
  errorCount: number | null;
  modelsUsed: string[];
  failure: string | null;
};

// The partial-message shape is version-dependent; pull the raw event out of
// whichever wrapper this SDK build uses, and dump it once so we learn the truth.
let dumpedShape = false;
function rawEventOf(msg: any): any | null {
  if (msg?.type === 'stream_event') return msg.event ?? null;
  if (msg?.type === 'partial') return msg.raw_event ?? null;
  return null;
}

function textDeltaOf(raw: any): string | null {
  if (raw?.type === 'content_block_delta' && raw?.delta?.type === 'text_delta') {
    return typeof raw.delta.text === 'string' ? raw.delta.text : null;
  }
  return null;
}

async function runOne(c: Case, arm: ArmName): Promise<Measurement> {
  const m: Measurement = {
    caseId: c.id, arm, model: c.model, ok: false,
    wallMs: 0, sdkDurationMs: null, sdkApiMs: null,
    firstEventMs: null, firstTextMs: null,
    inputTokens: null, cacheReadTokens: null, outputTokens: null, costUsd: null,
    parseOk: false, wasFenced: false, fieldOrderOk: false, fieldOrder: [],
    badEnumTypes: [], rawVerdict: null, guardedVerdict: null, guardChanged: false,
    errorCount: null, modelsUsed: [], failure: null,
  };

  const prompt = [
    buildUserPrompt(c.ctx),
    '',
    buildStudentBlock(c.submission),
  ].join('\n');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  let text = '';
  const seenTypes = new Set<string>();

  try {
    for await (const msg of query({
      prompt,
      options: {
        model: c.model,
        systemPrompt: buildSystemPrompt(c.ctx.language), // string form REPLACES the harness prompt
        tools: [],                 // availability, not permissions — allowedTools would NOT do this
        skills: [],                // otherwise project+user skills load and re-inflate context
        settingSources: [],        // otherwise CLAUDE.md + ~/.claude + hooks load. Default is user+project+local.
        strictMcpConfig: true,     // claude.ai connectors load under subscription auth otherwise
        maxTurns: 1,               // grading is single-shot (ADR 0004)
        includePartialMessages: true,
        abortController: ac,
        cwd: import.meta.dirname,
        env: {
          ...process.env,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', // auto-memory ignores settingSources
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          API_TIMEOUT_MS: String(TIMEOUT_MS),
          CLAUDE_CODE_MAX_RETRIES: '1',
          DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1', // MEASURED: does NOT suppress the auxiliary Haiku call
        },
        ...ARMS[arm],
      },
    } as any)) {
      const anyMsg = msg as any;
      seenTypes.add(anyMsg.type);

      const raw = rawEventOf(anyMsg);
      if (raw) {
        if (m.firstEventMs === null) m.firstEventMs = performance.now() - t0;
        if (!dumpedShape) {
          dumpedShape = true;
          console.log(`  [shape] partial wrapper="${anyMsg.type}" raw.type="${raw.type}"`);
        }
        const delta = textDeltaOf(raw);
        if (delta && delta.length > 0 && m.firstTextMs === null) {
          m.firstTextMs = performance.now() - t0;
        }
      }

      if (anyMsg.type === 'assistant') {
        for (const block of anyMsg.message?.content ?? []) {
          if (block.type === 'text') text += block.text;
        }
      }

      if (anyMsg.type === 'result') {
        m.sdkDurationMs = anyMsg.duration_ms ?? null;
        m.sdkApiMs = anyMsg.duration_api_ms ?? null;
        // result.usage aggregates ACROSS models (the SDK makes an auxiliary Haiku
        // call), so it under-reports the grading model. modelUsage is per-model.
        const mu = anyMsg.modelUsage ?? {};
        m.modelsUsed = Object.keys(mu);
        const own = mu[c.model];
        m.inputTokens = own?.inputTokens ?? anyMsg.usage?.input_tokens ?? null;
        m.cacheReadTokens = own?.cacheReadInputTokens ?? null;
        m.outputTokens = own?.outputTokens ?? null;
        m.costUsd = anyMsg.total_cost_usd ?? null;
        if (anyMsg.is_error) m.failure = `result subtype=${anyMsg.subtype}`;
        if (!text && typeof anyMsg.result === 'string') text = anyMsg.result;
      }
    }
    m.ok = true;
  } catch (e) {
    m.failure = ac.signal.aborted ? `ABORTED after ${TIMEOUT_MS}ms` : (e as Error).message;
  } finally {
    clearTimeout(timer);
    m.wallMs = performance.now() - t0;
  }

  if (text) {
    const parsed = parseGraderOutput(text);
    if (parsed.ok) {
      m.parseOk = true;
      m.wasFenced = parsed.wasFenced;
      m.fieldOrder = parsed.fieldOrder;
      m.fieldOrderOk = parsed.fieldOrder[0] === 'feedback_ru'; // streaming UX depends on this
      m.badEnumTypes = validateErrorTypes(parsed.value.errors, c.ctx.language);
      m.errorCount = parsed.value.errors.length;
      m.rawVerdict = parsed.value.verdict;
      const guarded = coherenceGuard(parsed.value.verdict, parsed.value.errors);
      m.guardedVerdict = guarded.verdict;
      m.guardChanged = guarded.changed;

      console.log(`  feedback_ru : ${parsed.value.feedback_ru.slice(0, 160)}`);
      console.log(`  corrected   : ${parsed.value.corrected}`);
      for (const err of parsed.value.errors) {
        console.log(`  error       : ${err.type}  «${err.span}»  ${err.explanation_ru.slice(0, 90)}`);
      }
      console.log(`  verdict     : ${parsed.value.verdict}` +
        (guarded.changed ? `  →  GUARD: ${guarded.verdict}  (${guarded.rule})` : `  (guard no-op)`));
      console.log(`  expected    : ${c.expect.verdict}, ${c.expect.plantedErrors} planted [${c.expect.mustMentionTypes.join(', ')}]`);
    } else {
      m.failure ??= parsed.reason;
      // Parse failures are intermittent (~1 in 24 observed). Persist every one —
      // an uncaptured failure teaches nothing.
      mkdirSync('failures', { recursive: true });
      const f = `failures/${c.id}-${arm}-${Date.now()}.txt`;
      writeFileSync(f, `reason: ${parsed.reason}\n\n${parsed.raw}`);
      console.log(`  PARSE FAILED: ${parsed.reason}`);
      console.log(`  raw saved to ${f}`);
    }
  } else if (!m.failure) {
    m.failure = `no text produced (message types seen: ${[...seenTypes].join(', ')})`;
  }

  return m;
}

function fmt(n: number | null, suffix = ''): string {
  return n === null ? '—' : `${(n / 1000).toFixed(2)}${suffix}`;
}

const args = process.argv.slice(2);
const armFilter = args.find((a) => a.startsWith('--arm='))?.split('=')[1] as ArmName | undefined;
const caseFilter = args.find((a) => a.startsWith('--case='))?.split('=')[1];

const arms = (armFilter ? [armFilter] : Object.keys(ARMS)) as ArmName[];
const cases = caseFilter ? CASES.filter((c) => c.id === caseFilter) : CASES;

console.log(`\nGRADING SPIKE — ${cases.length} case(s) × ${arms.length} arm(s) = ${cases.length * arms.length} calls`);
console.log(`Baseline to beat (design.md, claude -p): 16-19s wall, ~1.3-1.5s to first stream token\n`);

const results: Measurement[] = [];
for (const arm of arms) {
  for (const c of cases) {
    console.log(`── ${c.id} [${arm}] ${c.model}`);
    const m = await runOne(c, arm);
    console.log(`  wall ${fmt(m.wallMs, 's')}  sdk ${fmt(m.sdkDurationMs, 's')}  api ${fmt(m.sdkApiMs, 's')}  ` +
      `1st-event ${fmt(m.firstEventMs, 's')}  1st-text ${fmt(m.firstTextMs, 's')}`);
    console.log(`  tokens in=${m.inputTokens ?? '—'} cache-read=${m.cacheReadTokens ?? '—'} out=${m.outputTokens ?? '—'}  cost=$${m.costUsd?.toFixed(4) ?? '—'}`);
    console.log(`  models invoked: ${m.modelsUsed.join(', ') || '—'}`);
    if (m.failure) console.log(`  FAILURE: ${m.failure}`);
    if (m.wasFenced) console.log(`  WARNING: output was markdown-fenced`);
    if (!m.fieldOrderOk && m.parseOk) console.log(`  WARNING: field order was [${m.fieldOrder.join(', ')}] — feedback_ru must come first`);
    if (m.badEnumTypes.length) console.log(`  WARNING: Error Types outside the enum: ${m.badEnumTypes.join(', ')}`);
    console.log('');
    results.push(m);
  }
}

console.log('\n══ SUMMARY ══\n');
const head = ['case', 'arm', 'wall', 'api', '1st-txt', 'ctx-tok', 'parse', 'order', 'enum', 'verdict'];
const rows = results.map((m) => [
  m.caseId, m.arm, fmt(m.wallMs, 's'), fmt(m.sdkApiMs, 's'), fmt(m.firstTextMs, 's'),
  m.inputTokens === null ? '—' : String(m.inputTokens + (m.cacheReadTokens ?? 0)),
  m.parseOk ? 'ok' : 'FAIL',
  m.parseOk ? (m.fieldOrderOk ? 'ok' : 'BAD') : '—',
  m.parseOk ? (m.badEnumTypes.length ? 'BAD' : 'ok') : '—',
  m.guardedVerdict ?? '—',
]);
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(head));
console.log(widths.map((w) => '─'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));

const failures = results.filter((m) => !m.parseOk || m.failure);
console.log(`\n${results.length - failures.length}/${results.length} calls produced a valid, enum-clean Verdict.`);
console.log('Go/no-go is a judgement call — read the numbers above against design.md § Measured baseline.\n');
