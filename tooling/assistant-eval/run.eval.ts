/**
 * Runs the assistant test set through the real conversation loop (session.ts)
 * against the Messages API with the person's own-key path, then scores each
 * case with deterministic checks and a grader call. See docs/assistant-eval.md.
 *
 *   ANTHROPIC_API_KEY=… npm run eval:assistant
 *   EVAL_DRY=1 npx vitest run --config vitest.eval.config.ts   (no API calls)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get, type Writable } from 'svelte/store';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assistant, send, applyProposal, newConversation } from '$lib/assistant/session';
import { assistantApiKey } from '$lib/assistant/apiKey';
import { activeCheck, assistantTools } from '$lib/assistant/checks';
import { runPlanTool } from '$lib/assistant/planTools';
import { CASES, type EvalCase, type EvalContext } from './cases';
import { activeFloorOf, check, project, type CheckResult } from './helpers';
import { createRecorder, type CallRecord, type ToolCallRecord } from './recorder';
import { grade, type Grade } from './grader';
import { fakeMessagesApi } from './fake';
import { addUsage, emptyUsage, type Usage } from './pricing';
import { compareFiles } from './compare.mjs';

const env = process.env;
const DRY = env.EVAL_DRY === '1';
const KEY = DRY ? 'sk-ant-dry-run-0000000000000000000000' : env.ANTHROPIC_API_KEY ?? '';
const COMPARE = env.EVAL_COMPARE?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
const REPEATS = Math.max(1, Math.floor(Number(env.EVAL_REPEATS ?? 1)) || 1);
const MAX_USD = Number(env.EVAL_MAX_USD ?? 15) || 15;
const LABEL = (env.EVAL_LABEL ?? (DRY ? 'dry' : 'run')).replace(/[^\w.-]+/g, '-');
const REVIEW = env.EVAL_REVIEW === 'off' ? 'off' : 'on';
/** The dry run proves the harness on two cases unless EVAL_CASES names others. */
const DRY_CASES = ['q-living-area', 'furnish-bedroom'];
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));

function selectedCases(): EvalCase[] {
  const wanted = env.EVAL_CASES?.split(',').map(s => s.trim()).filter(Boolean) ?? (DRY ? DRY_CASES : []);
  if (!wanted.length) return CASES;
  const unknown = wanted.filter(id => !CASES.some(c => c.id === id));
  if (unknown.length) throw new Error(`Unknown EVAL_CASES: ${unknown.join(', ')}. Cases: ${CASES.map(c => c.id).join(', ')}`);
  return CASES.filter(c => wanted.includes(c.id));
}

/** The reviewer switch, if this checkout has the reviewer (import.meta.glob finds nothing otherwise). */
async function setReview(on: boolean): Promise<string> {
  try {
    const modules = import.meta.glob('../../src/lib/assistant/reviewer.ts');
    const load = Object.values(modules)[0];
    if (!load) return 'no reviewer in this checkout';
    const { reviewEnabled } = await load() as { reviewEnabled?: Writable<boolean> };
    if (!reviewEnabled) return 'reviewer has no reviewEnabled switch';
    reviewEnabled.set(on);
    return on ? 'on' : 'off';
  } catch (error) {
    return `reviewer switch unavailable (${(error as Error).message})`;
  }
}

/** localStorage for the session's saved chats and the key, in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => data.clear(),
  };
}

// ── Results ──────────────────────────────────────────────────────────

interface CaseResult {
  id: string;
  repeat: number;
  summary: string;
  prompt: string;
  status: 'done' | 'error' | 'skipped';
  skippedReason?: string;
  error?: string;
  /** From sending the message until the assistant finished, in seconds. */
  seconds: number;
  graderSeconds: number;
  reply: string;
  chatErrors: string[];
  applied: boolean;
  calls: { assistant: number; reviewer: number };
  models: string[];
  usage: Usage;
  costUsd: { assistant: number; reviewer: number; grader: number; total: number };
  unpricedModels: string[];
  toolCalls: ToolCallRecord[];
  checks: CheckResult[];
  checksPassed: number;
  checksTotal: number;
  grader: Grade | null;
  planBefore: string;
  planAfter: string;
  callLog: Omit<CallRecord, 'text'>[];
}

const startedAt = new Date();
const results: CaseResult[] = [];
let spent = 0;
let budgetStopped = false;
let reviewState = REVIEW;
const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const base = `${RESULTS_DIR}${stamp}-${LABEL}`;

/** Progress lines straight to the terminal: vitest hides console output of passing tests. */
const say = (text: string) => { process.stderr.write(`${text}\n`); };

const r2 = (n: number) => Math.round(n * 100) / 100;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function totals() {
  const done = results.filter(r => r.status !== 'skipped');
  const graded = done.map(r => r.grader?.overall).filter((n): n is number => typeof n === 'number');
  const sum = (f: (r: CaseResult) => number) => done.reduce((s, r) => s + f(r), 0);
  return {
    cases: results.length,
    done: results.filter(r => r.status === 'done').length,
    errors: results.filter(r => r.status === 'error').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    checksPassed: sum(r => r.checksPassed),
    checksTotal: sum(r => r.checksTotal),
    graderMean: graded.length ? r2(graded.reduce((s, n) => s + n, 0) / graded.length) : null,
    calls: sum(r => r.calls.assistant + r.calls.reviewer),
    seconds: Math.round(sum(r => r.seconds + r.graderSeconds)),
    costUsd: sum(r => r.costUsd.total),
    assistantCostUsd: sum(r => r.costUsd.assistant),
    reviewerCostUsd: sum(r => r.costUsd.reviewer),
    graderCostUsd: sum(r => r.costUsd.grader),
    usage: done.reduce((u, r) => addUsage(u, r.usage), emptyUsage()),
  };
}

function writeResults() {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const t = totals();
  const run = {
    version: 1, label: LABEL, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    dry: DRY, review: reviewState, repeats: REPEATS, maxUsd: MAX_USD, budgetStopped, totals: t, cases: results,
  };
  writeFileSync(`${base}.json`, JSON.stringify(run, null, 2));
  const lines = [
    `# Assistant eval: ${LABEL}`,
    '',
    `${startedAt.toISOString()}${DRY ? ' (dry run, fake API)' : ''}. Review ${reviewState}. ${t.done} done, ${t.errors} errors, ${t.skipped} skipped${budgetStopped ? ` (budget of $${MAX_USD} reached)` : ''}.`,
    '',
    `Checks ${t.checksPassed}/${t.checksTotal}${t.checksTotal ? ` (${Math.round(t.checksPassed / t.checksTotal * 100)}%)` : ''}, mean grade ${t.graderMean ?? '–'}, ${t.calls} model calls, ${t.seconds} s. Cost ${usd(t.costUsd)}: assistant ${usd(t.assistantCostUsd)}, reviewer ${usd(t.reviewerCostUsd)}, grader ${usd(t.graderCostUsd)}.`,
    '',
    '| case | checks | grade | calls (assistant + reviewer) | cost | seconds | notes |',
    '|---|---|---|---|---|---|---|',
    ...results.map(r => {
      const failed = r.checks.filter(c => !c.pass).map(c => c.name);
      const notes = [r.status !== 'done' ? `${r.status}: ${r.error ?? r.skippedReason ?? ''}` : '', r.grader?.error ? `grader: ${r.grader.error}` : '', failed.length ? `failed: ${failed.join('; ')}` : '', ...r.chatErrors]
        .filter(Boolean).join(' · ').replace(/\|/g, '/');
      return `| ${r.id}${REPEATS > 1 ? ` #${r.repeat}` : ''} | ${r.checksPassed}/${r.checksTotal} | ${r.grader?.overall ?? '–'} | ${r.calls.assistant} + ${r.calls.reviewer} | ${usd(r.costUsd.total)} | ${Math.round(r.seconds + r.graderSeconds)} | ${notes} |`;
    }),
    '',
  ];
  writeFileSync(`${base}.md`, lines.join('\n'));
}

// ── One case ─────────────────────────────────────────────────────────

function runChecks(c: EvalCase, ctx: EvalContext): CheckResult[] {
  return c.checks.flatMap((fn, i) => {
    try {
      const out = fn(ctx);
      return Array.isArray(out) ? out : [out];
    } catch (error) {
      return [check(`check ${i + 1} could not run`, false, (error as Error).message)];
    }
  });
}

const toolLine = (t: ToolCallRecord) => `${t.agent === 'reviewer' ? '[reviewer] ' : ''}${t.name} ${JSON.stringify(t.input).slice(0, 400)}${t.result !== undefined ? ` → ${t.isError ? 'ERROR ' : ''}${t.result.split('\n').slice(0, 6).join(' / ').slice(0, 400)}` : ''}`;

async function runCase(c: EvalCase, repeat: number): Promise<CaseResult> {
  const result: CaseResult = { ...emptyResult(c, repeat), status: 'done' };
  const realFetch = globalThis.fetch;
  const apiFetch = DRY ? fakeMessagesApi() : realFetch;
  const recorder = createRecorder(apiFetch);
  try {
    // A fresh plan and conversation, then the case's starting plan.
    newConversation();
    assistantTools.set([]);
    activeCheck.set(null);
    c.setup();
    newConversation();
    const before = structuredClone(project());
    result.planBefore = runPlanTool('get_plan', {}).text;

    assistantApiKey.set(KEY);
    vi.stubGlobal('fetch', recorder.fetch);
    const started = Date.now();
    await send(c.prompt);
    for (const followUp of c.followUps ?? []) {
      // The person applies what was proposed before writing again.
      if (get(assistant).items.some(item => item.kind === 'proposal' && item.status === 'pending')) { applyProposal(); result.applied = true; }
      await send(followUp);
    }
    await recorder.settle();
    result.seconds = Math.round((Date.now() - started) / 100) / 10;
    vi.stubGlobal('fetch', realFetch);
    assistantApiKey.set('');

    const items = get(assistant).items;
    result.reply = [...items].reverse().find(item => item.kind === 'assistant')?.text ?? '';
    result.chatErrors = items.filter(item => item.kind === 'error').map(item => `${item.error}${item.message ? `: ${item.message}` : ''}`);
    if (items.some(item => item.kind === 'proposal' && item.status === 'pending')) {
      applyProposal();
      result.applied = true;
    }
    const after = structuredClone(project());
    result.planAfter = runPlanTool('get_plan', {}).text;
    result.toolCalls = recorder.toolCalls;

    const ctx: EvalContext = {
      before, after, beforeFloor: activeFloorOf(before), floor: activeFloorOf(after), reply: result.reply,
      toolCalls: recorder.toolCalls, madeTools: get(assistantTools), applied: result.applied,
    };
    result.checks = runChecks(c, ctx);
    result.checksPassed = result.checks.filter(x => x.pass).length;
    result.checksTotal = result.checks.length;

    const notes = [...result.chatErrors.map(e => `The chat showed an error: ${e}`)];
    result.grader = await grade({
      prompt: c.followUps?.length ? [c.prompt, ...c.followUps].map((text, i) => `Message ${i + 1}: ${text}`).join('\n') : c.prompt, planBefore: result.planBefore, planAfter: result.planAfter, reply: result.reply, checks: result.checks,
      rubric: c.rubric, toolLog: recorder.toolCalls.map(toolLine).join('\n'), notes,
    }, KEY, apiFetch);
    result.graderSeconds = Math.round(result.grader.ms / 100) / 10;
  } catch (error) {
    result.status = 'error';
    result.error = (error as Error)?.stack?.split('\n').slice(0, 3).join(' ') ?? String(error);
    vi.stubGlobal('fetch', realFetch);
    assistantApiKey.set('');
  } finally {
    await recorder.settle().catch(() => {});
    for (const call of recorder.calls) {
      result.calls[call.agent]++;
      addUsage(result.usage, call.usage);
      result.costUsd[call.agent] += call.costUsd;
      if (!result.models.includes(call.model)) result.models.push(call.model);
      if (call.unpriced && !result.unpricedModels.includes(call.model)) result.unpricedModels.push(call.model);
    }
    result.callLog = recorder.calls.map(({ text: _text, ...rest }) => rest);
    if (result.grader) {
      addUsage(result.usage, result.grader.usage);
      result.costUsd.grader = result.grader.costUsd;
    }
    result.costUsd.total = result.costUsd.assistant + result.costUsd.reviewer + result.costUsd.grader;
  }
  return result;
}

// ── The suite ────────────────────────────────────────────────────────

const enabled = !COMPARE.length && (DRY || !!KEY);

if (COMPARE.length) {
  describe('assistant eval: compare', () => {
    it('prints a comparison of two result files', () => {
      if (COMPARE.length !== 2) throw new Error('EVAL_COMPARE takes two result files: a.json,b.json');
      say(`\n${compareFiles(COMPARE[0], COMPARE[1])}\n`);
    });
  });
} else if (!enabled) {
  say('\n[assistant eval] ANTHROPIC_API_KEY is not set: skipping every case. Set it to run against the API, or EVAL_DRY=1 for the scripted dry run.\n');
}

describe.skipIf(!enabled)('assistant eval', () => {
  const cases = enabled ? selectedCases() : CASES;
  const runs = Array.from({ length: REPEATS }, (_, r) => cases.map(c => ({ c, repeat: r + 1 }))).flat();

  beforeEach(async () => {
    vi.stubGlobal('localStorage', memoryStorage());
    reviewState = REVIEW === 'off' ? await setReview(false) : await setReview(true);
  });

  for (const { c, repeat } of runs) {
    it(`${c.id}${REPEATS > 1 ? ` #${repeat}` : ''}`, async ctx => {
      if (spent >= MAX_USD) {
        if (!budgetStopped) say(`\n[assistant eval] Spent ${usd(spent)}, past EVAL_MAX_USD=${MAX_USD}: not starting more cases.\n`);
        budgetStopped = true;
        results.push({ ...emptyResult(c, repeat), status: 'skipped', skippedReason: `budget of $${MAX_USD} reached` });
        writeResults();
        ctx.skip();
        return;
      }
      const result = await runCase(c, repeat);
      results.push(result);
      spent += result.costUsd.total;
      writeResults();
      const failed = result.checks.filter(x => !x.pass);
      say(`[assistant eval] ${c.id}${REPEATS > 1 ? ` #${repeat}` : ''}: ${result.status}, checks ${result.checksPassed}/${result.checksTotal}, grade ${result.grader?.overall ?? '–'}${result.grader?.error ? ` (grader: ${result.grader.error})` : ''}, ${result.calls.assistant}+${result.calls.reviewer} calls, ${usd(result.costUsd.total)}, ${result.seconds}s${failed.length ? `\n  failed: ${failed.map(x => `${x.name}${x.detail ? ` (${x.detail})` : ''}`).join('\n          ')}` : ''}${result.error ? `\n  error: ${result.error}` : ''}`);
      if (DRY) {
        // The dry run checks the harness itself, not the assistant.
        expect(result.status, result.error).toBe('done');
        expect(result.calls.assistant).toBe(3);
        expect(result.toolCalls.map(t => t.name)).toEqual(['get_plan', 'place_furniture']);
        expect(result.toolCalls.every(t => t.result !== undefined)).toBe(true);
        expect(result.applied).toBe(true);
        expect(result.reply).toMatch(/Dry run/);
        expect(result.checksTotal).toBeGreaterThan(0);
        expect(result.grader?.overall).toBe(3);
        expect(result.costUsd.assistant).toBeGreaterThan(0);
        expect(result.costUsd.grader).toBeGreaterThan(0);
      }
    });
  }
});

function emptyResult(c: EvalCase, repeat: number): CaseResult {
  return {
    id: c.id, repeat, summary: c.summary, prompt: c.prompt, status: 'skipped', seconds: 0, graderSeconds: 0, reply: '', chatErrors: [], applied: false,
    calls: { assistant: 0, reviewer: 0 }, models: [], usage: emptyUsage(), costUsd: { assistant: 0, reviewer: 0, grader: 0, total: 0 },
    unpricedModels: [], toolCalls: [], checks: [], checksPassed: 0, checksTotal: 0, grader: null, planBefore: '', planAfter: '', callLog: [],
  };
}
