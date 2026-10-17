/**
 * Constraint equations. Each row is residual(pos) = scale · (g(pos) − target), where g
 * measures the constrained quantity from corner positions. Lengths are in cm; angular
 * rows are radians × ANGLE_SCALE so both weigh alike in least squares.
 */
import type { Constraint, CornerRef, Point } from '$lib/models/types';
import { cornerNeighbours, endpointAt, endpointKey, keyEnd, keyWall, otherEnd, refKey, type EndpointKey, type Sketch } from './sketch';
import { faceSpan, type FaceNeighbour } from './faces';

export const ANGLE_SCALE = 100; // cm per radian
export const LENGTH_TOLERANCE = 0.05; // cm, conflict display tolerance
export const ANGLE_TOLERANCE = 0.01 * Math.PI / 180 * ANGLE_SCALE; // 0.01°

export interface Row {
  constraintId: string | null; // null: implicit (T-junction)
  /** Implied rows (e.g. lineDistance's parallelism) are dropped when already implied by others. */
  implied: boolean;
  /** Coordinate indices (corner * 2 + axis) the row depends on. */
  deps: number[];
  g: (pos: Float64Array) => number;
  target: number;
  scale: number;
  wrap: boolean;
  tol: number;
}

export function residual(row: Row, pos: Float64Array): number {
  let d = row.g(pos) - row.target;
  if (row.wrap) d = Math.atan2(Math.sin(d), Math.cos(d));
  return row.scale * d;
}

const deg = Math.PI / 180;

function depsOf(sketch: Sketch, keys: EndpointKey[]): number[] {
  const set = new Set<number>();
  for (const key of keys) { const c = sketch.cornerOf.get(key); if (c !== undefined) set.add(c * 2).add(c * 2 + 1); }
  return [...set];
}

const wallKeys = (wallId: string) => [endpointKey(wallId, 'start'), endpointKey(wallId, 'end')] as const;

function direction(sketch: Sketch, pos: Float64Array, wallId: string): Point {
  const [s, e] = wallKeys(wallId), a = endpointAt(sketch, pos, s), b = endpointAt(sketch, pos, e);
  return { x: b.x - a.x, y: b.y - a.y };
}

function unit(v: Point): Point { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; }

/** Signed distance of p from the wall's centreline, along its normal (-dy, dx). */
function signedDistance(sketch: Sketch, pos: Float64Array, wallId: string, p: Point): number {
  const a = endpointAt(sketch, pos, endpointKey(wallId, 'start')), d = unit(direction(sketch, pos, wallId));
  return (p.x - a.x) * -d.y + (p.y - a.y) * d.x;
}

/** Endpoint keys whose positions determine the wall's face clipping at each end. */
function faceNeighbourKeys(sketch: Sketch, wallId: string): { start: EndpointKey[]; end: EndpointKey[]; hosts: Record<'start' | 'end', string | undefined> } {
  const hostOf = (key: EndpointKey) => sketch.tJunctions.find(t => t.key === key)?.hostId;
  const [s, e] = wallKeys(wallId);
  return { start: cornerNeighbours(sketch, s), end: cornerNeighbours(sketch, e), hosts: { start: hostOf(s), end: hostOf(e) } };
}

function faceNeighbours(sketch: Sketch, pos: Float64Array, keys: EndpointKey[], hostId: string | undefined): FaceNeighbour[] {
  const result: FaceNeighbour[] = keys.map(key => {
    const wallId = keyWall(key), wall = sketch.wallById.get(wallId)!;
    return { start: endpointAt(sketch, pos, endpointKey(wallId, 'start')), end: endpointAt(sketch, pos, endpointKey(wallId, 'end')), thickness: wall.thickness, at: keyEnd(key) };
  });
  if (hostId) {
    const host = sketch.wallById.get(hostId)!;
    result.push({ start: endpointAt(sketch, pos, endpointKey(hostId, 'start')), end: endpointAt(sketch, pos, endpointKey(hostId, 'end')), thickness: host.thickness, at: 'host' });
  }
  return result;
}

/** Everything a wall's face length depends on. */
function faceLengthKeys(sketch: Sketch, wallId: string): EndpointKey[] {
  const nb = faceNeighbourKeys(sketch, wallId);
  const keys: EndpointKey[] = [...wallKeys(wallId), ...nb.start.map(otherEnd), ...nb.end.map(otherEnd), ...nb.start, ...nb.end];
  for (const host of [nb.hosts.start, nb.hosts.end]) if (host) keys.push(...wallKeys(host));
  return keys;
}

/** The measured quantity: cm for distances, radians for angles. Signed per the Constraint docs. */
function measureFn(c: Constraint, sketch: Sketch): { g: (pos: Float64Array) => number; keys: EndpointKey[]; angular: boolean } | null {
  const has = (...walls: string[]) => walls.every(id => sketch.wallById.has(id));
  const hasRef = (ref: CornerRef) => sketch.cornerOf.has(refKey(ref));
  switch (c.kind) {
    case 'length': {
      if (!has(c.wallId)) return null;
      const [s, e] = wallKeys(c.wallId);
      if (c.side === 0) return { keys: [s, e], angular: false, g: pos => { const d = direction(sketch, pos, c.wallId); return Math.hypot(d.x, d.y); } };
      const wall = sketch.wallById.get(c.wallId)!, nb = faceNeighbourKeys(sketch, c.wallId);
      return {
        keys: faceLengthKeys(sketch, c.wallId), angular: false,
        g: pos => faceSpan({ start: endpointAt(sketch, pos, s), end: endpointAt(sketch, pos, e), thickness: wall.thickness }, c.side,
          faceNeighbours(sketch, pos, nb.start, nb.hosts.start), faceNeighbours(sketch, pos, nb.end, nb.hosts.end)),
      };
    }
    case 'pointDistance': {
      if (!hasRef(c.a) || !hasRef(c.b)) return null;
      const a = refKey(c.a), b = refKey(c.b);
      return {
        keys: [a, b], angular: false, g: pos => {
          const p = endpointAt(sketch, pos, a), q = endpointAt(sketch, pos, b);
          return c.axis === 'x' ? q.x - p.x : c.axis === 'y' ? q.y - p.y : Math.hypot(q.x - p.x, q.y - p.y);
        },
      };
    }
    case 'pointLine': {
      if (!hasRef(c.point) || !has(c.wallId)) return null;
      const key = refKey(c.point), half = sketch.wallById.get(c.wallId)!.thickness / 2;
      return { keys: [key, ...wallKeys(c.wallId)], angular: false, g: pos => signedDistance(sketch, pos, c.wallId, endpointAt(sketch, pos, key)) - c.side * half };
    }
    case 'lineDistance': {
      if (!has(c.wallA, c.wallB)) return null;
      const ha = sketch.wallById.get(c.wallA)!.thickness / 2, hb = sketch.wallById.get(c.wallB)!.thickness / 2;
      const [bs, be] = wallKeys(c.wallB);
      return {
        keys: [...wallKeys(c.wallA), bs, be], angular: false, g: pos => {
          const p = endpointAt(sketch, pos, bs), q = endpointAt(sketch, pos, be);
          const na = unit(direction(sketch, pos, c.wallA)), nb = unit(direction(sketch, pos, c.wallB));
          const facing = na.x * nb.x + na.y * nb.y; // normals relate as the directions do
          return signedDistance(sketch, pos, c.wallA, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }) + c.sideB * hb * facing - c.sideA * ha;
        },
      };
    }
    case 'angle': {
      if (!has(c.wallA, c.wallB)) return null;
      return {
        keys: [...wallKeys(c.wallA), ...wallKeys(c.wallB)], angular: true, g: pos => {
          const a = direction(sketch, pos, c.wallA), b0 = direction(sketch, pos, c.wallB), b = c.flipB ? { x: -b0.x, y: -b0.y } : b0;
          return -Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y); // counter-clockwise with Y up
        },
      };
    }
    default: return null;
  }
}

/** Current value of a dimension in its stored units (cm or degrees), or null if its walls are gone. */
export function measureConstraint(c: Constraint, sketch: Sketch, pos: Float64Array = sketch.pos): number | null {
  const m = measureFn(c, sketch);
  if (!m) return null;
  const value = m.g(pos);
  return m.angular ? value / deg : value;
}

/** Equations a driving constraint imposes. Fix constraints act through Sketch.fixed instead. */
export function constraintRows(c: Constraint, sketch: Sketch): Row[] {
  const base = { constraintId: c.id, implied: false, wrap: false };
  const lengthRow = { ...base, scale: 1, tol: LENGTH_TOLERANCE };
  const angleRow = { ...base, scale: ANGLE_SCALE, tol: ANGLE_TOLERANCE };
  switch (c.kind) {
    case 'fix': return [];
    case 'horizontal': case 'vertical': {
      if (!sketch.wallById.has(c.wallId)) return [];
      const axis = c.kind === 'horizontal' ? 'y' : 'x';
      return [{ ...lengthRow, deps: depsOf(sketch, [...wallKeys(c.wallId)]), target: 0, g: pos => direction(sketch, pos, c.wallId)[axis] }];
    }
    case 'parallel': case 'perpendicular': {
      if (!sketch.wallById.has(c.wallA) || !sketch.wallById.has(c.wallB)) return [];
      return [relationRow(sketch, c.wallA, c.wallB, c.kind, c.id, false)];
    }
    default: {
      const m = measureFn(c, sketch);
      if (!m) return [];
      const row: Row = m.angular
        ? { ...angleRow, wrap: true, deps: depsOf(sketch, m.keys), g: m.g, target: c.value * deg }
        : { ...lengthRow, deps: depsOf(sketch, m.keys), g: m.g, target: c.value };
      if (c.kind === 'lineDistance') return [row, relationRow(sketch, c.wallA, c.wallB, 'parallel', c.id, true)];
      return [row];
    }
  }
}

function relationRow(sketch: Sketch, wallA: string, wallB: string, kind: 'parallel' | 'perpendicular', id: string, implied: boolean): Row {
  return {
    constraintId: id, implied, wrap: false, scale: ANGLE_SCALE, tol: ANGLE_TOLERANCE, target: 0,
    deps: depsOf(sketch, [...wallKeys(wallA), ...wallKeys(wallB)]),
    g: pos => {
      const a = unit(direction(sketch, pos, wallA)), b = unit(direction(sketch, pos, wallB));
      return kind === 'parallel' ? a.x * b.y - a.y * b.x : a.x * b.x + a.y * b.y;
    },
  };
}

/** Keep T-junction endpoints on their host walls' centrelines. */
export function tJunctionRows(sketch: Sketch, released: Set<EndpointKey> = new Set()): Row[] {
  return sketch.tJunctions.filter(t => !released.has(t.key)).map(t => ({
    constraintId: null, implied: false, wrap: false, scale: 1, tol: LENGTH_TOLERANCE, target: 0,
    deps: depsOf(sketch, [t.key, ...wallKeys(t.hostId)]),
    g: (pos: Float64Array) => signedDistance(sketch, pos, t.hostId, endpointAt(sketch, pos, t.key)),
  }));
}

/** Wall ids a constraint refers to. */
export function constraintWalls(c: Constraint): string[] {
  switch (c.kind) {
    case 'length': case 'horizontal': case 'vertical': return [c.wallId];
    case 'pointDistance': return [c.a.wallId, c.b.wallId];
    case 'pointLine': return [c.point.wallId, c.wallId];
    case 'lineDistance': case 'angle': case 'parallel': case 'perpendicular': return [c.wallA, c.wallB];
    case 'fix': return [c.target.wallId];
  }
}

/** Endpoint keys whose corners a constraint touches (for component grouping and weights). */
export function constraintKeys(c: Constraint, sketch: Sketch): EndpointKey[] {
  if (c.kind === 'fix') return 'end' in c.target ? [refKey(c.target)] : [...wallKeys(c.target.wallId)];
  if (c.kind === 'pointDistance') return [refKey(c.a), refKey(c.b)];
  if (c.kind === 'pointLine') return [refKey(c.point), ...wallKeys(c.wallId)];
  const keys = constraintWalls(c).flatMap(id => [...wallKeys(id)]);
  if (c.kind === 'length' && c.side !== 0 && sketch.wallById.has(c.wallId)) keys.push(...faceLengthKeys(sketch, c.wallId));
  return keys.filter(k => sketch.cornerOf.has(k));
}
