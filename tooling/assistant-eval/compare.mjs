#!/usr/bin/env node
/**
 * Side-by-side comparison of two assistant eval result files, per case
 * (repeats averaged) and in total.
 *
 *   node tooling/assistant-eval/compare.mjs results/a.json results/b.json
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const mean = list => list.length ? list.reduce((s, n) => s + n, 0) / list.length : null;

/** Per case id: averages over the repeats that ran. */
function summarise(run) {
  const byCase = new Map();
  for (const c of run.cases ?? []) {
    if (c.status === 'skipped') continue;
    const list = byCase.get(c.id) ?? [];
    list.push(c);
    byCase.set(c.id, list);
  }
  const rows = new Map();
  for (const [id, list] of byCase) {
    rows.set(id, {
      runs: list.length,
      errors: list.filter(c => c.status === 'error').length,
      checks: mean(list.map(c => c.checksTotal ? c.checksPassed / c.checksTotal : 0)),
      passed: mean(list.map(c => c.checksPassed)),
      total: mean(list.map(c => c.checksTotal)),
      grade: mean(list.map(c => c.grader?.overall).filter(n => typeof n === 'number')),
      calls: mean(list.map(c => (c.calls?.assistant ?? 0) + (c.calls?.reviewer ?? 0))),
      cost: mean(list.map(c => c.costUsd?.total ?? 0)),
      seconds: mean(list.map(c => c.seconds ?? 0)),
    });
  }
  return rows;
}

const f = (n, digits = 1) => n === null || n === undefined ? '–' : n.toFixed(digits);
const delta = (a, b, digits = 1) => a === null || b === null || a === undefined || b === undefined ? '' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(digits)}`;
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function compareResults(a, b, names = ['A', 'B']) {
  const ra = summarise(a), rb = summarise(b);
  const ids = [...new Set([...ra.keys(), ...rb.keys()])];
  const lines = [];
  lines.push(`A: ${names[0]} (${a.label ?? '?'}, review ${a.review ?? '?'}, ${a.startedAt ?? ''})`);
  lines.push(`B: ${names[1]} (${b.label ?? '?'}, review ${b.review ?? '?'}, ${b.startedAt ?? ''})`);
  lines.push('');
  const head = `${pad('case', 26)} ${lpad('checks A', 9)} ${lpad('B', 6)} ${lpad('grade A', 8)} ${lpad('B', 4)} ${lpad('Δ', 5)} ${lpad('calls A', 8)} ${lpad('B', 5)} ${lpad('$ A', 7)} ${lpad('$ B', 7)} ${lpad('s A', 6)} ${lpad('s B', 6)}`;
  lines.push(head, '-'.repeat(head.length));
  for (const id of ids) {
    const x = ra.get(id), y = rb.get(id);
    const checks = r => r ? `${f(r.passed, 1)}/${f(r.total, 0)}` : '–';
    lines.push(`${pad(id, 26)} ${lpad(checks(x), 9)} ${lpad(checks(y), 6)} ${lpad(f(x?.grade), 8)} ${lpad(f(y?.grade), 4)} ${lpad(delta(x?.grade, y?.grade), 5)} ${lpad(f(x?.calls), 8)} ${lpad(f(y?.calls), 5)} ${lpad(f(x?.cost, 3), 7)} ${lpad(f(y?.cost, 3), 7)} ${lpad(f(x?.seconds, 0), 6)} ${lpad(f(y?.seconds, 0), 6)}${(x?.errors || y?.errors) ? `  errors ${x?.errors ?? 0}/${y?.errors ?? 0}` : ''}`);
  }
  lines.push('-'.repeat(head.length));
  // Totals only over cases both runs have, so different case sets don't skew them.
  const shared = ids.filter(id => ra.has(id) && rb.has(id));
  const total = rows => {
    const list = shared.map(id => rows.get(id));
    return {
      checks: mean(list.map(r => r.checks)),
      grade: mean(list.map(r => r.grade).filter(n => n !== null)),
      calls: list.reduce((s, r) => s + r.calls, 0),
      cost: list.reduce((s, r) => s + r.cost, 0),
      seconds: list.reduce((s, r) => s + r.seconds, 0),
    };
  };
  const ta = total(ra), tb = total(rb);
  lines.push(`${pad(`total (${shared.length} shared)`, 26)} ${lpad(`${f((ta.checks ?? 0) * 100, 0)}%`, 9)} ${lpad(`${f((tb.checks ?? 0) * 100, 0)}%`, 6)} ${lpad(f(ta.grade, 2), 8)} ${lpad(f(tb.grade, 2), 4)} ${lpad(delta(ta.grade, tb.grade, 2), 5)} ${lpad(f(ta.calls, 0), 8)} ${lpad(f(tb.calls, 0), 5)} ${lpad(f(ta.cost, 2), 7)} ${lpad(f(tb.cost, 2), 7)} ${lpad(f(ta.seconds, 0), 6)} ${lpad(f(tb.seconds, 0), 6)}`);
  lines.push('');
  lines.push(`Whole runs: A $${f(a.totals?.costUsd, 2)} (${a.totals?.done ?? '?'} done), B $${f(b.totals?.costUsd, 2)} (${b.totals?.done ?? '?'} done). Costs include the grader.`);
  return lines.join('\n');
}

export function compareFiles(fileA, fileB) {
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  return compareResults(read(fileA), read(fileB), [basename(fileA), basename(fileB)]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [fileA, fileB] = process.argv.slice(2);
  if (!fileA || !fileB) {
    console.error('Usage: node tooling/assistant-eval/compare.mjs <a.json> <b.json>');
    process.exit(1);
  }
  console.log(compareFiles(fileA, fileB));
}
