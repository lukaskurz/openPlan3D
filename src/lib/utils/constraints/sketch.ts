/**
 * The solver's view of a floor: wall endpoints clustered into corners.
 *
 * Walls store free endpoints; a corner is every endpoint within CORNER_TOLERANCE of
 * another (transitively), matching room detection so solving never tears a room.
 * Each endpoint keeps its constant offset from its corner, so near-miss joins are
 * carried along rather than welded. Corner positions (2 numbers each, in `pos`) are
 * the solver's unknowns; corners pinned by a fix constraint are constants.
 */
import type { Constraint, CornerRef, Point, Wall } from '$lib/models/types';

export const CORNER_TOLERANCE = 5; // cm, as roomDetection's EPSILON
export const T_JUNCTION_TOLERANCE = 2; // cm, as WALL_JOIN_TOLERANCE

export type EndpointKey = string; // `${wallId}:start|end`
export const endpointKey = (wallId: string, end: 'start' | 'end'): EndpointKey => `${wallId}:${end}`;
export const refKey = (ref: CornerRef): EndpointKey => endpointKey(ref.wallId, ref.end);

export interface Sketch {
  walls: Wall[];
  wallById: Map<string, Wall>;
  cornerCount: number;
  cornerOf: Map<EndpointKey, number>;
  offset: Map<EndpointKey, Point>;
  members: EndpointKey[][];
  /** Corner positions, x and y per corner; fixed corners sit at their fix. */
  pos: Float64Array;
  /** Corner positions as drawn, before fixes are applied. */
  actual: Float64Array;
  /** Corners held by a fix constraint. */
  fixed: Uint8Array;
  /** Endpoints resting on another wall's interior (host must stay under them). */
  tJunctions: { key: EndpointKey; hostId: string }[];
}

export function buildSketch(walls: Wall[], constraints: Constraint[] = []): Sketch {
  const keys: EndpointKey[] = [], points: Point[] = [];
  for (const wall of walls) for (const end of ['start', 'end'] as const) {
    keys.push(endpointKey(wall.id, end)); points.push(wall[end]);
  }
  const parent = keys.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (Math.abs(points[i].x - points[j].x) < CORNER_TOLERANCE && Math.abs(points[i].y - points[j].y) < CORNER_TOLERANCE
      && Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < CORNER_TOLERANCE) parent[find(i)] = find(j);
  }
  const cornerIndex = new Map<number, number>(), members: EndpointKey[][] = [], cornerOf = new Map<EndpointKey, number>();
  keys.forEach((key, i) => {
    const root = find(i);
    let corner = cornerIndex.get(root);
    if (corner === undefined) { corner = members.length; cornerIndex.set(root, corner); members.push([]); }
    members[corner].push(key); cornerOf.set(key, corner);
  });
  const pointOf = new Map(keys.map((key, i) => [key, points[i]]));
  const pos = new Float64Array(members.length * 2), offset = new Map<EndpointKey, Point>();
  members.forEach((group, corner) => {
    let x = 0, y = 0;
    for (const key of group) { x += pointOf.get(key)!.x; y += pointOf.get(key)!.y; }
    x /= group.length; y /= group.length;
    pos[corner * 2] = x; pos[corner * 2 + 1] = y;
    for (const key of group) offset.set(key, { x: pointOf.get(key)!.x - x, y: pointOf.get(key)!.y - y });
  });

  const actual = new Float64Array(pos);
  const fixed = new Uint8Array(members.length);
  for (const c of constraints) {
    if (c.kind !== 'fix') continue;
    const refs: CornerRef[] = 'end' in c.target ? [c.target] : [{ wallId: c.target.wallId, end: 'start' }, { wallId: c.target.wallId, end: 'end' }];
    refs.forEach((ref, i) => {
      const key = refKey(ref), corner = cornerOf.get(key), at = c.at[i];
      if (corner === undefined || !at || fixed[corner]) return;
      const o = offset.get(key)!;
      fixed[corner] = 1; pos[corner * 2] = at.x - o.x; pos[corner * 2 + 1] = at.y - o.y;
    });
  }

  const tJunctions: Sketch['tJunctions'] = [];
  for (const [i, key] of keys.entries()) {
    const corner = cornerOf.get(key)!, p = points[i];
    for (const host of walls) {
      if (host.curvePoint || cornerOf.get(endpointKey(host.id, 'start')) === corner || cornerOf.get(endpointKey(host.id, 'end')) === corner) continue;
      const dx = host.end.x - host.start.x, dy = host.end.y - host.start.y, length = Math.hypot(dx, dy);
      if (length < 1) continue;
      const t = ((p.x - host.start.x) * dx + (p.y - host.start.y) * dy) / (length * length);
      const distance = Math.abs((p.x - host.start.x) * dy - (p.y - host.start.y) * dx) / length;
      if (t * length > CORNER_TOLERANCE && (1 - t) * length > CORNER_TOLERANCE && distance < T_JUNCTION_TOLERANCE) {
        tJunctions.push({ key, hostId: host.id });
        break;
      }
    }
  }
  return { walls, wallById: new Map(walls.map(w => [w.id, w])), cornerCount: members.length, cornerOf, offset, members, pos, actual, fixed, tJunctions };
}

export function endpointAt(sketch: Sketch, pos: Float64Array, key: EndpointKey): Point {
  const corner = sketch.cornerOf.get(key)!, o = sketch.offset.get(key)!;
  return { x: pos[corner * 2] + o.x, y: pos[corner * 2 + 1] + o.y };
}

/** Corner position that puts `key` at `point`. */
export function cornerPositionFor(sketch: Sketch, key: EndpointKey, point: Point): Point {
  const o = sketch.offset.get(key)!;
  return { x: point.x - o.x, y: point.y - o.y };
}

/** The same topology with corner positions read from edited walls (for frozen-sketch drags). */
export function refreshSketch(sketch: Sketch, walls: Wall[]): Sketch {
  const wallById = new Map(walls.map(w => [w.id, w]));
  const pos = new Float64Array(sketch.pos);
  sketch.members.forEach((group, corner) => {
    if (sketch.fixed[corner]) return;
    const key = group.find(k => wallById.has(keyWall(k)));
    if (!key) return;
    const wallId = keyWall(key), end = keyEnd(key);
    const p = wallById.get(wallId)![end], o = sketch.offset.get(key)!;
    pos[corner * 2] = p.x - o.x; pos[corner * 2 + 1] = p.y - o.y;
  });
  return { ...sketch, walls, wallById, pos, actual: new Float64Array(pos) };
}

/** Walls whose endpoints (other than `key`'s own wall) meet at `key`'s corner. */
export function cornerNeighbours(sketch: Sketch, key: EndpointKey): EndpointKey[] {
  const corner = sketch.cornerOf.get(key)!, wallId = keyWall(key);
  return sketch.members[corner].filter(k => keyWall(k) !== wallId);
}

export const keyWall = (key: EndpointKey) => key.slice(0, key.lastIndexOf(':'));
export const keyEnd = (key: EndpointKey) => key.slice(key.lastIndexOf(':') + 1) as 'start' | 'end';
export const otherEnd = (key: EndpointKey) => endpointKey(keyWall(key), keyEnd(key) === 'start' ? 'end' : 'start');
