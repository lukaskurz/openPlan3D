/**
 * Parametric wall constraints: planners in the style of wallEditing.ts, returning
 * Map<wallId, Partial<Wall>> for the store to apply in one undo step.
 *
 * Floors without active constraints are never touched: every planner returns an
 * empty map (or null) before building anything.
 */
import type { Constraint, Point, Wall } from '$lib/models/types';
import { planChecked } from '$lib/utils/wallEditing';
import { componentBasis, componentColumns, components, RowBasis } from './analysis';
import { constraintKeys, constraintRows, constraintWalls, measureConstraint, residual, tJunctionRows, LENGTH_TOLERANCE, type Row } from './rows';
import { jacobian, solveRows } from './solver';
import { buildSketch, cornerNeighbours, endpointAt, endpointKey, keyWall, otherEnd, refKey, refreshSketch, type EndpointKey, type Sketch } from './sketch';

export { buildSketch, endpointKey, refKey, type EndpointKey, type Sketch } from './sketch';
export { measureConstraint, constraintWalls } from './rows';

export class ConstraintError extends Error {}

/** Fix constraints always act; dimensions act unless driven (reference). */
export const isActiveConstraint = (c: Constraint) => c.kind === 'fix' || !c.driven;
export const isDimension = (c: Constraint): c is Extract<Constraint, { value: number }> => 'value' in c;

const UNSATISFIABLE = 'The constraints can’t all be satisfied. Change or remove one of them first.';

function activeRows(sketch: Sketch, constraints: Constraint[], released?: Set<EndpointKey>): Row[] {
  return [...constraints.filter(isActiveConstraint).flatMap(c => constraintRows(c, sketch)), ...tJunctionRows(sketch, released)];
}

const applyChanges = (walls: Wall[], changes: Map<string, Partial<Wall>>) => walls.map(w => changes.has(w.id) ? { ...w, ...changes.get(w.id) } : w);

/** Wall updates for solved corner positions; curved walls carry their control point along. */
function wallChanges(sketch: Sketch, pos: Float64Array): Map<string, Partial<Wall>> {
  const changes = new Map<string, Partial<Wall>>();
  for (const wall of sketch.walls) {
    const start = endpointAt(sketch, pos, endpointKey(wall.id, 'start')), end = endpointAt(sketch, pos, endpointKey(wall.id, 'end'));
    const movedStart = Math.hypot(start.x - wall.start.x, start.y - wall.start.y) > 1e-7;
    const movedEnd = Math.hypot(end.x - wall.end.x, end.y - wall.end.y) > 1e-7;
    if (!movedStart && !movedEnd) continue;
    const updates: Partial<Wall> = {};
    if (movedStart) updates.start = start;
    if (movedEnd) updates.end = end;
    if (wall.curvePoint) {
      // Similarity mapping the old chord onto the new one (complex ratio d1 / d0).
      const d0 = { x: wall.end.x - wall.start.x, y: wall.end.y - wall.start.y }, d1 = { x: end.x - start.x, y: end.y - start.y };
      const l0 = d0.x * d0.x + d0.y * d0.y;
      if (l0 > 1e-12) {
        const q = { x: (d1.x * d0.x + d1.y * d0.y) / l0, y: (d1.y * d0.x - d1.x * d0.y) / l0 };
        const c = { x: wall.curvePoint.x - wall.start.x, y: wall.curvePoint.y - wall.start.y };
        updates.curvePoint = { x: start.x + q.x * c.x - q.y * c.y, y: start.y + q.x * c.y + q.y * c.x };
      }
    }
    changes.set(wall.id, updates);
  }
  return planChecked(sketch.walls, changes, 'The constraints would collapse a wall. Change or remove a constraint first.');
}

interface FloorSolveOptions {
  /** Endpoints held exactly at these points. */
  pinned?: Map<EndpointKey, Point>;
  /** Endpoints pulled towards these points (weighted, not exact). */
  targets?: Map<EndpointKey, Point>;
  weights?: Map<EndpointKey, number>;
  defaultWeight?: number;
  /** T-junction endpoints allowed to leave their host. */
  released?: Set<EndpointKey>;
  /** Frozen topology from an earlier build (drags). */
  sketch?: Sketch;
  /** Solve only the components containing these endpoints. */
  only?: Set<EndpointKey>;
  maxIterations?: number;
}

function solveFloor(walls: Wall[], constraints: Constraint[], options: FloorSolveOptions = {}) {
  const sketch = options.sketch ? refreshSketch(options.sketch, walls) : buildSketch(walls, constraints);
  const rows = activeRows(sketch, constraints, options.released);
  const cornerMap = <T>(map: Map<EndpointKey, T> | undefined, value: (key: EndpointKey, v: T) => T) => {
    const result = new Map<number, T>();
    for (const [key, v] of map ?? []) { const corner = sketch.cornerOf.get(key); if (corner !== undefined) result.set(corner, value(key, v)); }
    return result;
  };
  const toCorner = (key: EndpointKey, p: Point) => { const o = sketch.offset.get(key)!; return { x: p.x - o.x, y: p.y - o.y }; };
  const pinned = cornerMap(options.pinned, toCorner);
  const weights = cornerMap(options.weights, (_, w) => w);
  const x0 = new Float64Array(sketch.pos);
  for (const [corner, p] of cornerMap(options.targets, toCorner)) { x0[corner * 2] = p.x; x0[corner * 2 + 1] = p.y; }
  const only = options.only ? new Set([...options.only].map(k => sketch.cornerOf.get(k)).filter((c): c is number => c !== undefined)) : null;

  const pos = new Float64Array(sketch.pos), solved = new Set<number>();
  let ok = true;
  for (const component of components(sketch, rows)) {
    if (!component.constrained || (only && !component.corners.some(c => only.has(c)))) continue;
    for (const corner of component.corners) solved.add(corner);
    if (!ok) continue;
    const result = solveRows(sketch, component.rows, { pinned, weights, defaultWeight: options.defaultWeight, x0, maxIterations: options.maxIterations });
    if (!result.ok) { ok = false; continue; }
    for (const corner of component.corners) { pos[corner * 2] = result.pos[corner * 2]; pos[corner * 2 + 1] = result.pos[corner * 2 + 1]; }
  }
  return { sketch, pos, solved, ok };
}

/**
 * Re-solve the floor's constrained walls. `pinned` endpoints (typically the ones an edit
 * just placed) stay exactly where they are; everything else moves as little as possible.
 */
export function planConstraintSolve(walls: Wall[], constraints: Constraint[], options: FloorSolveOptions = {}): Map<string, Partial<Wall>> {
  if (!constraints.some(isActiveConstraint)) return new Map();
  const result = solveFloor(walls, constraints, options);
  if (!result.ok) throw new ConstraintError(UNSATISFIABLE);
  return wallChanges(result.sketch, result.pos);
}

/** True when some wall reversed direction, or a corner between two walls turned inside out. */
function flipped(before: Wall[], after: Wall[], skipWalls: Set<string>): boolean {
  const afterById = new Map(after.map(w => [w.id, w]));
  const dir = (w: Wall) => ({ x: w.end.x - w.start.x, y: w.end.y - w.start.y });
  for (const wall of before) {
    const next = afterById.get(wall.id);
    if (!next || next === wall) continue;
    const a = dir(wall), b = dir(next);
    if (a.x * b.x + a.y * b.y < 0) return true;
  }
  const sketch = buildSketch(before);
  const away = (walls: Map<string, Wall>, key: EndpointKey) => {
    const w = walls.get(keyWall(key))!, far = otherEnd(key).endsWith(':end') ? w.end : w.start, near = key.endsWith(':end') ? w.end : w.start;
    return { x: far.x - near.x, y: far.y - near.y };
  };
  const beforeById = new Map(before.map(w => [w.id, w]));
  for (const group of sketch.members) for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
    const a = group[i], b = group[j];
    if (keyWall(a) === keyWall(b) || (skipWalls.has(keyWall(a)) && skipWalls.has(keyWall(b)))) continue;
    if (beforeById.get(keyWall(a)) === afterById.get(keyWall(a)) && beforeById.get(keyWall(b)) === afterById.get(keyWall(b))) continue;
    const u0 = away(beforeById, a), v0 = away(beforeById, b), u1 = away(afterById, a), v1 = away(afterById, b);
    const c0 = u0.x * v0.y - u0.y * v0.x, c1 = u1.x * v1.y - u1.y * v1.x;
    if (Math.abs(c0) > Math.sin(3 * Math.PI / 180) * Math.hypot(u0.x, u0.y) * Math.hypot(v0.x, v0.y) && Math.sign(c0) !== Math.sign(c1)) return true;
  }
  return false;
}

/** Which endpoints stay put and which give way when a dimension's value changes. */
function editAnchors(c: Constraint, fixedEnd: 'start' | 'end' = 'start'): { anchor: EndpointKey[]; moving: EndpointKey[] } {
  const both = (id: string) => [endpointKey(id, 'start'), endpointKey(id, 'end')];
  switch (c.kind) {
    case 'length': return { anchor: [endpointKey(c.wallId, fixedEnd)], moving: [endpointKey(c.wallId, fixedEnd === 'start' ? 'end' : 'start')] };
    case 'pointDistance': return { anchor: [refKey(c.a)], moving: [refKey(c.b)] };
    case 'pointLine': return { anchor: both(c.wallId), moving: [refKey(c.point)] };
    case 'lineDistance': case 'angle': case 'parallel': case 'perpendicular': return { anchor: both(c.wallA), moving: both(c.wallB) };
    default: return { anchor: [], moving: [] };
  }
}

/**
 * Change a dimension's value and move the plan to match: the dimension's anchor side
 * stays put (the fixed endpoint for a wall length), its other side gives way first, and
 * the rest of the plan moves as little as possible. Large changes are approached in
 * stages so walls don't flip over.
 */
export function planConstraintValue(walls: Wall[], constraints: Constraint[], id: string, value: number, fixedEnd: 'start' | 'end' = 'start'): Map<string, Partial<Wall>> {
  const c = constraints.find(x => x.id === id);
  if (!c || !isDimension(c)) throw new ConstraintError('Select a dimension to change.');
  if (!Number.isFinite(value)) throw new ConstraintError('Enter a number.');
  if (c.driven) throw new ConstraintError('This is a driven (reference) dimension. Make it driving to change the plan with it.');
  const { anchor, moving } = editAnchors(c, fixedEnd);
  const current = new Map(walls.map(w => [w.id, w]));
  const pinned = new Map(anchor.map(key => [key, key.endsWith(':end') ? current.get(keyWall(key))!.end : current.get(keyWall(key))!.start] as const).filter(([key]) => current.has(keyWall(key))));
  const skip = new Set(constraintWalls(c));
  const withValue = (v: number) => constraints.map(x => x.id === id ? { ...x, value: v } as Constraint : x);
  const movingWeights = new Map(moving.map(k => [k, 1]));
  const strategies: FloorSolveOptions[] = [
    { pinned, weights: movingWeights, defaultWeight: 10 },
    { weights: new Map([...anchor.map(k => [k, 1000] as const), ...movingWeights]), defaultWeight: 10 },
  ];
  for (const stages of [1, 8]) for (const strategy of strategies) {
    let state = walls, failed = false;
    for (let i = 1; i <= stages && !failed; i++) {
      const stageValue = c.value + (value - c.value) * i / stages;
      const result = solveFloor(state, withValue(stageValue), strategy);
      if (!result.ok) { failed = true; break; }
      let next: Wall[];
      try { next = applyChanges(state, wallChanges(result.sketch, result.pos)); } catch { failed = true; break; }
      if (flipped(state, next, skip)) { failed = true; break; }
      state = next;
    }
    if (!failed) {
      const changes = new Map<string, Partial<Wall>>();
      state.forEach((w, i) => { if (w !== walls[i]) changes.set(w.id, { start: w.start, end: w.end, ...(w.curvePoint ? { curvePoint: w.curvePoint } : {}) }); });
      return changes;
    }
  }
  throw new ConstraintError('The plan can’t take this value with its other constraints. Try another value or remove a constraint.');
}

export type ConstraintCheck =
  | { status: 'ok'; changes: Map<string, Partial<Wall>> }
  | { status: 'overConstrained' }
  | { status: 'unsatisfiable'; message: string };

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Would adding `c` over-constrain the plan? A row is redundant when it depends on the
 * existing rows — tested at the current geometry and at two nearby configurations that
 * satisfy the existing constraints, so accidental alignments don't count. Implied rows
 * (lineDistance's parallelism) are fine when redundant but already satisfied.
 */
export function checkNewConstraint(walls: Wall[], constraints: Constraint[], c: Constraint): ConstraintCheck {
  const next = [...constraints, c];
  const trial = (): ConstraintCheck => {
    try { return { status: 'ok', changes: planConstraintSolve(walls, next) }; }
    catch (e) { return { status: 'unsatisfiable', message: e instanceof Error ? e.message : UNSATISFIABLE }; }
  };
  if (c.kind === 'fix') {
    const sketch = buildSketch(walls, next);
    const constant = activeRows(sketch, constraints).filter(row => row.deps.every(d => sketch.fixed[d >> 1]));
    return constant.some(row => Math.abs(residual(row, sketch.pos)) > row.tol) ? { status: 'overConstrained' } : trial();
  }
  if (c.driven) return trial();
  const sketch = buildSketch(walls, constraints);
  const base = activeRows(sketch, constraints), added = constraintRows(c, sketch);
  if (!added.length) return { status: 'unsatisfiable', message: 'Pick walls or corners that still exist.' };
  const touched = new Set(added.flatMap(row => row.deps.map(d => d >> 1)));
  const component = components(sketch, [...base, ...added]).find(g => g.corners.some(corner => touched.has(corner)))!;
  const baseRows = component.rows.filter(row => !added.includes(row));

  const configs: Float64Array[] = [sketch.pos];
  const random = mulberry32(0x5eed);
  const { coords } = componentColumns(sketch, component);
  // Perturb by ~10% of the walls' size so the witnesses sit well away from special angles.
  const inComponent = new Set(component.corners);
  const lengths = walls.filter(w => inComponent.has(sketch.cornerOf.get(endpointKey(w.id, 'start'))!))
    .map(w => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)).sort((a, b) => a - b);
  const scale = Math.max(10, 0.1 * (lengths[lengths.length >> 1] ?? 100));
  // Over-constraint is structural, not about particular numbers: a rectangle's width equals its
  // top wall's length, which pins it at a singular right angle. Witnesses therefore also nudge
  // the existing dimensions' values a few percent (zero targets like parallel/H/V stay exact).
  const nudged = (rows: Row[]) => rows.map(row => row.target === 0 || row.implied || row.constraintId === null ? row
    : { ...row, target: row.target + (random() - 0.5) * 2 * (row.wrap ? 0.03 : Math.max(1, Math.abs(row.target) * 0.03)) });
  for (let i = 0; i < 3; i++) {
    const x0 = new Float64Array(sketch.pos);
    for (const d of coords) x0[d] += (random() - 0.5) * 2 * scale;
    const projected = solveRows(sketch, nudged(baseRows), { x0, maxIterations: 80 });
    if (projected.ok) configs.push(projected.pos);
  }
  const primary = added.filter(row => !row.implied), implied = added.filter(row => row.implied);
  let primaryIndependent = false;
  const impliedDependentEverywhere = implied.map(() => true);
  // A configuration where the existing rows lose rank (a right angle can make a width and a
  // length momentarily equivalent) says nothing about the new row: only trust full-rank ones.
  const bases = configs.map(pos => ({ pos, ...componentBasis(sketch, component, baseRows, pos) }));
  const fullRank = Math.max(...bases.map(b => b.basis.vectors.length));
  for (const { pos, basis, column, coords: cols } of bases) {
    if (basis.vectors.length < fullRank) continue;
    const grads = jacobian(added, new Float64Array(pos), column, cols.length);
    const allPrimary = primary.every(row => basis.add(grads[added.indexOf(row)]));
    if (allPrimary) primaryIndependent = true;
    implied.forEach((row, i) => { if (basis.independent(grads[added.indexOf(row)])) impliedDependentEverywhere[i] = false; });
  }
  if (primary.length && !primaryIndependent) return { status: 'overConstrained' };
  if (implied.some((row, i) => impliedDependentEverywhere[i] && Math.abs(residual(row, sketch.pos)) > row.tol)) return { status: 'overConstrained' };
  return trial();
}

export interface ConstraintAnalysis {
  /** Current value of every dimension (driving or driven), cm or degrees. */
  measures: Map<string, number>;
  /** Active constraints the geometry doesn't satisfy (e.g. after an external edit). */
  conflicts: Set<string>;
  /** Remaining degrees of freedom across constrained components. */
  dof: number;
  /** Walls in a component with at least one constraint. */
  constrainedWalls: Set<string>;
  /** Walls whose corners the constraints fully determine. */
  fullyConstrainedWalls: Set<string>;
}

export function analyzeConstraints(walls: Wall[], constraints: Constraint[]): ConstraintAnalysis {
  const analysis: ConstraintAnalysis = { measures: new Map(), conflicts: new Set(), dof: 0, constrainedWalls: new Set(), fullyConstrainedWalls: new Set() };
  if (!constraints.length) return analysis;
  const sketch = buildSketch(walls, constraints);
  for (const c of constraints) {
    if (!isDimension(c)) continue;
    const value = measureConstraint(c, sketch, sketch.actual);
    if (value !== null) analysis.measures.set(c.id, value);
  }
  const rows = activeRows(sketch, constraints);
  for (const row of rows) if (row.constraintId && Math.abs(residual(row, sketch.actual)) > row.tol) analysis.conflicts.add(row.constraintId);
  for (const c of constraints) {
    if (c.kind !== 'fix') continue;
    const keys = constraintKeys(c, sketch);
    keys.forEach((key, i) => {
      const at = c.at[i], p = endpointAt(sketch, sketch.actual, key);
      if (at && Math.hypot(at.x - p.x, at.y - p.y) > LENGTH_TOLERANCE) analysis.conflicts.add(c.id);
    });
  }
  const fullCorners = new Set<number>();
  for (const component of components(sketch, rows)) {
    if (!component.constrained) continue;
    const { basis, column, coords } = componentBasis(sketch, component, component.rows, sketch.pos);
    analysis.dof += coords.length - basis.vectors.length;
    for (const corner of component.corners) {
      const cx = column.get(corner * 2), cy = column.get(corner * 2 + 1);
      if (sketch.fixed[corner] || (cx !== undefined && cy !== undefined && basis.freedom(cx) < 1e-6 && basis.freedom(cy) < 1e-6)) fullCorners.add(corner);
    }
    const inComponent = new Set(component.corners);
    for (const wall of walls) {
      const a = sketch.cornerOf.get(endpointKey(wall.id, 'start'))!, b = sketch.cornerOf.get(endpointKey(wall.id, 'end'))!;
      if (!inComponent.has(a)) continue;
      analysis.constrainedWalls.add(wall.id);
      if (fullCorners.has(a) && fullCorners.has(b)) analysis.fullyConstrainedWalls.add(wall.id);
    }
  }
  return analysis;
}

export interface DragPlan { changes: Map<string, Partial<Wall>>; handled: Set<EndpointKey> }

/**
 * Drag endpoints towards targets through the constraints. Tries to put the dragged corners
 * exactly on their targets; if the constraints forbid that, pulls them as close as they allow
 * (a fixed-length wall pivots). Returns null when no constrained geometry is involved, so the
 * caller keeps its ordinary drag. `handled` lists endpoints the caller must not move itself.
 */
export function planConstrainedDrag(walls: Wall[], constraints: Constraint[], targets: Map<EndpointKey, Point>, sketch?: Sketch): DragPlan | null {
  if (!constraints.some(isActiveConstraint)) return null;
  const keys = new Set(targets.keys());
  const common = { sketch, released: keys, only: keys, maxIterations: 40 };
  let result = solveFloor(walls, constraints, { ...common, pinned: targets });
  if (!result.solved.size) return null;
  if (!result.ok) result = solveFloor(walls, constraints, { ...common, targets, weights: new Map([...keys].map(k => [k, 1000])) });
  const handled = new Set<EndpointKey>();
  for (const [key, corner] of result.sketch.cornerOf) if (result.solved.has(corner)) handled.add(key);
  if (!result.ok) return { changes: new Map(), handled };
  try { return { changes: wallChanges(result.sketch, result.pos), handled }; }
  catch { return { changes: new Map(), handled }; }
}

/** Corner keys meeting at `key`, including itself: the endpoints that move together. */
export function jointEndpoints(sketch: Sketch, key: EndpointKey): EndpointKey[] {
  return [key, ...cornerNeighbours(sketch, key)];
}

export { RowBasis };
