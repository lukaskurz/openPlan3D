/** Rank and freedom analysis of constraint rows, and grouping into independent components. */
import { jacobian } from './solver';
import type { Row } from './rows';
import { endpointKey, type Sketch } from './sketch';

const INDEPENDENCE = 1e-6;

/** Orthonormal basis of row gradients, grown one row at a time (Gram–Schmidt, twice). */
export class RowBasis {
  readonly vectors: Float64Array[] = [];
  constructor(readonly n: number) {}

  private remainder(v: Float64Array): Float64Array | null {
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm < 1e-12) return null;
    const w = v.map(x => x / norm);
    for (let pass = 0; pass < 2; pass++) for (const q of this.vectors) {
      let dot = 0;
      for (let i = 0; i < w.length; i++) dot += w[i] * q[i];
      if (dot !== 0) for (let i = 0; i < w.length; i++) w[i] -= dot * q[i];
    }
    return w;
  }

  independent(v: Float64Array): boolean {
    const w = this.remainder(v);
    if (!w) return false;
    let r = 0;
    for (const x of w) r += x * x;
    return Math.sqrt(r) > INDEPENDENCE;
  }

  /** Adds the row if it is independent of the basis; returns whether it was. */
  add(v: Float64Array): boolean {
    const w = this.remainder(v);
    if (!w) return false;
    let r = 0;
    for (const x of w) r += x * x;
    r = Math.sqrt(r);
    if (r <= INDEPENDENCE) return false;
    this.vectors.push(w.map(x => x / r));
    return true;
  }

  /** How free a coordinate still is: 0 when the rows pin it, 1 when untouched. */
  freedom(column: number): number {
    let s = 0;
    for (const q of this.vectors) s += q[column] * q[column];
    return Math.max(0, 1 - s);
  }
}

export interface Component { corners: number[]; rows: Row[]; constrained: boolean }

/** Corners linked by walls or rows solve together; only components with a constraint or fix are solved. */
export function components(sketch: Sketch, rows: Row[]): Component[] {
  const parent = Array.from({ length: sketch.cornerCount }, (_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const wall of sketch.walls) union(sketch.cornerOf.get(endpointKey(wall.id, 'start'))!, sketch.cornerOf.get(endpointKey(wall.id, 'end'))!);
  for (const row of rows) for (let i = 1; i < row.deps.length; i++) union(row.deps[0] >> 1, row.deps[i] >> 1);
  const groups = new Map<number, Component>();
  for (let corner = 0; corner < sketch.cornerCount; corner++) {
    const root = find(corner);
    if (!groups.has(root)) groups.set(root, { corners: [], rows: [], constrained: false });
    const group = groups.get(root)!;
    group.corners.push(corner);
    if (sketch.fixed[corner]) group.constrained = true;
  }
  for (const row of rows) {
    if (!row.deps.length) continue;
    const group = groups.get(find(row.deps[0] >> 1))!;
    group.rows.push(row);
    if (row.constraintId !== null) group.constrained = true;
  }
  return [...groups.values()];
}

/** Free coordinates of a component's movable corners, with a column index for each. */
export function componentColumns(sketch: Sketch, component: Component, pinned?: Set<number>) {
  const coords: number[] = [];
  for (const corner of component.corners) if (!sketch.fixed[corner] && !pinned?.has(corner)) coords.push(corner * 2, corner * 2 + 1);
  return { coords, column: new Map(coords.map((d, i) => [d, i])) };
}

/** Row basis of a component's rows at the given positions. */
export function componentBasis(sketch: Sketch, component: Component, rows: Row[], pos: Float64Array): { basis: RowBasis; column: Map<number, number>; coords: number[] } {
  const { coords, column } = componentColumns(sketch, component);
  const basis = new RowBasis(coords.length);
  for (const grad of jacobian(rows, new Float64Array(pos), column, coords.length)) basis.add(grad);
  return { basis, column, coords };
}
