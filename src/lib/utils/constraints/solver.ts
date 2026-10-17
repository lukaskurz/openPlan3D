/**
 * Minimal-movement constraint solving.
 *
 * Finds corner positions x satisfying every row while minimising Σ wᵢ(xᵢ − x0ᵢ)², with a
 * projected Gauss-Newton step from the start geometry x0:
 *   Δ = (x0 − xk) − W⁻¹Jᵀ (JW⁻¹Jᵀ + λD)⁻¹ (r + J(x0 − xk))
 * Referencing x0 on every iteration makes the result the nearest solution, independent
 * of how many (capped) steps it takes. D = diag(JW⁻¹Jᵀ) keeps λ scale-free, and λ > 0
 * lets dependent (redundant) rows through the Cholesky.
 */
import { residual, type Row } from './rows';
import type { Sketch } from './sketch';

export interface SolveOptions {
  /** Per-corner weight: heavier corners move less. */
  weights?: Map<number, number>;
  /** Weight of corners not in `weights`. Default 1. */
  defaultWeight?: number;
  /** Corners held at these positions for this solve. */
  pinned?: Map<number, { x: number; y: number }>;
  /** Start geometry to stay close to; defaults to the sketch positions (after pins). */
  x0?: Float64Array;
  tolerance?: number;
  maxIterations?: number;
}

export interface SolveResult { pos: Float64Array; ok: boolean; maxResidual: number; iterations: number }

const LAMBDA = 1e-10;
const MAX_TURN = 20 * Math.PI / 180; // per iteration, keeps short walls from flipping over

/** Coordinate indices free to move: dependencies of the rows, minus fixed and pinned corners. */
export function freeCoordinates(sketch: Sketch, rows: Row[], pinned?: Map<number, unknown>): number[] {
  const set = new Set<number>();
  for (const row of rows) for (const d of row.deps) {
    const corner = d >> 1;
    if (!sketch.fixed[corner] && !pinned?.has(corner)) set.add(d);
  }
  return [...set].sort((a, b) => a - b);
}

/** Row gradients over the free coordinates (central differences). */
export function jacobian(rows: Row[], pos: Float64Array, column: Map<number, number>, n: number): Float64Array[] {
  const h = 1e-4;
  return rows.map(row => {
    const grad = new Float64Array(n);
    for (const d of row.deps) {
      const col = column.get(d);
      if (col === undefined) continue;
      const saved = pos[d];
      pos[d] = saved + h; const plus = residual(row, pos);
      pos[d] = saved - h; const minus = residual(row, pos);
      pos[d] = saved;
      grad[col] = (plus - minus) / (2 * h);
    }
    return grad;
  });
}

/** Solve A z = b for symmetric positive (semi)definite A, with jitter. A is overwritten. */
function choleskySolve(A: Float64Array[], b: Float64Array): Float64Array {
  const m = b.length;
  for (let i = 0; i < m; i++) A[i][i] = A[i][i] * (1 + LAMBDA) + 1e-12;
  for (let j = 0; j < m; j++) {
    let s = A[j][j];
    for (let k = 0; k < j; k++) s -= A[j][k] * A[j][k];
    const diag = Math.sqrt(Math.max(s, 1e-18));
    A[j][j] = diag;
    for (let i = j + 1; i < m; i++) {
      let t = A[i][j];
      for (let k = 0; k < j; k++) t -= A[i][k] * A[j][k];
      A[i][j] = t / diag;
    }
  }
  const y = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= A[i][k] * y[k]; y[i] = s / A[i][i]; }
  for (let i = m - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < m; k++) s -= A[k][i] * y[k]; y[i] = s / A[i][i]; }
  return y;
}

/** Largest direction change (radians) the step would give any wall with a moving corner. */
function maxTurn(sketch: Sketch, pos: Float64Array, next: Float64Array, moving: Set<number>): number {
  let worst = 0;
  for (const wall of sketch.walls) {
    const a = sketch.cornerOf.get(`${wall.id}:start`)!, b = sketch.cornerOf.get(`${wall.id}:end`)!;
    if (!moving.has(a) && !moving.has(b)) continue;
    const oa = sketch.offset.get(`${wall.id}:start`)!, ob = sketch.offset.get(`${wall.id}:end`)!;
    const d0x = pos[b * 2] + ob.x - pos[a * 2] - oa.x, d0y = pos[b * 2 + 1] + ob.y - pos[a * 2 + 1] - oa.y;
    const d1x = next[b * 2] + ob.x - next[a * 2] - oa.x, d1y = next[b * 2 + 1] + ob.y - next[a * 2 + 1] - oa.y;
    if (Math.hypot(d0x, d0y) < 1e-6 || Math.hypot(d1x, d1y) < 1e-6) continue;
    worst = Math.max(worst, Math.abs(Math.atan2(d0x * d1y - d0y * d1x, d0x * d1x + d0y * d1y)));
  }
  return worst;
}

export function solveRows(sketch: Sketch, rows: Row[], options: SolveOptions = {}): SolveResult {
  const tolerance = options.tolerance ?? 1e-5, maxIterations = options.maxIterations ?? 100;
  const x = new Float64Array(sketch.pos);
  for (const [corner, p] of options.pinned ?? []) { x[corner * 2] = p.x; x[corner * 2 + 1] = p.y; }
  const x0 = options.x0 ? new Float64Array(options.x0) : new Float64Array(x);
  for (const [corner, p] of options.pinned ?? []) { x0[corner * 2] = p.x; x0[corner * 2 + 1] = p.y; }

  const free = freeCoordinates(sketch, rows, options.pinned);
  const column = new Map(free.map((d, i) => [d, i]));
  const active = rows.filter(row => row.deps.some(d => column.has(d)));
  const constant = rows.filter(row => !row.deps.some(d => column.has(d)));
  const constantResidual = constant.reduce((worst, row) => Math.max(worst, Math.abs(residual(row, x))), 0);
  const constantOk = constant.every(row => Math.abs(residual(row, x)) <= row.tol);
  const inverseWeight = free.map(d => 1 / (options.weights?.get(d >> 1) ?? options.defaultWeight ?? 1));
  const moving = new Set(free.map(d => d >> 1));
  // Start from x0 for free coordinates: a drag target seeds the dragged corner.
  for (const d of free) x[d] = x0[d];

  let maxResidual = Infinity, iterations = 0;
  for (; iterations <= maxIterations; iterations++) {
    const r = active.map(row => residual(row, x));
    maxResidual = r.reduce((worst, v) => Math.max(worst, Math.abs(v)), 0);
    if (!Number.isFinite(maxResidual)) break;
    if (maxResidual < tolerance || iterations === maxIterations) break;
    const n = free.length, m = active.length;
    const J = jacobian(active, x, column, n);
    const delta0 = free.map(d => x0[d] - x[d]);
    const y = new Float64Array(m);
    for (let i = 0; i < m; i++) { let s = r[i]; for (let k = 0; k < n; k++) s += J[i][k] * delta0[k]; y[i] = s; }
    const A = Array.from({ length: m }, () => new Float64Array(m));
    for (let i = 0; i < m; i++) for (let j = 0; j <= i; j++) {
      let s = 0;
      const Ji = J[i], Jj = J[j];
      for (let k = 0; k < n; k++) if (Ji[k] !== 0 && Jj[k] !== 0) s += Ji[k] * inverseWeight[k] * Jj[k];
      A[i][j] = A[j][i] = s;
    }
    const z = choleskySolve(A, y);
    const next = new Float64Array(x);
    const step = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (let i = 0; i < m; i++) if (J[i][k] !== 0) s += J[i][k] * z[i];
      step[k] = delta0[k] - inverseWeight[k] * s;
      next[free[k]] = x[free[k]] + step[k];
    }
    const turn = maxTurn(sketch, x, next, moving);
    const alpha = turn > MAX_TURN ? MAX_TURN / turn : 1;
    for (let k = 0; k < n; k++) x[free[k]] += alpha * step[k];
  }
  const ok = Number.isFinite(maxResidual) && maxResidual < tolerance * 10 && constantOk;
  return { pos: x, ok, maxResidual: Math.max(maxResidual, constantResidual), iterations };
}
