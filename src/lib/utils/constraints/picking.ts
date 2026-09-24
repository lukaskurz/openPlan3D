/**
 * Dimension tool picking: what's under the pointer (a corner or a straight wall), and the
 * dimension that a set of picks plus a placement point describes, Fusion-style.
 */
import type { Constraint, CornerRef, FaceSide, NewConstraint, Point, Wall } from '$lib/models/types';
import { buildSketch, endpointKey, keyWall, type Sketch } from './sketch';
import { measureConstraint } from './rows';
import { faceInset, wallNormal, type FaceNeighbour } from './faces';

export type DimensionPick = { kind: 'corner'; ref: CornerRef; point: Point } | { kind: 'wall'; wallId: string };

const CORNER_PICK = 12; // screen px
const WALL_PICK = 8; // screen px beyond the wall's face
const PARALLEL = Math.sin(2 * Math.PI / 180);

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** A corner beats a wall; curved walls can't be dimensioned. */
export function pickAt(walls: Wall[], p: Point, zoom: number, { corners = true } = {}): DimensionPick | null {
  let corner: DimensionPick | null = null, best = CORNER_PICK / zoom;
  for (const wall of walls) {
    if (wall.curvePoint || !corners) continue;
    for (const end of ['start', 'end'] as const) {
      const d = Math.hypot(wall[end].x - p.x, wall[end].y - p.y);
      if (d < best) { best = d; corner = { kind: 'corner', ref: { wallId: wall.id, end }, point: { ...wall[end] } }; }
    }
  }
  if (corner) return corner;
  let wallPick: DimensionPick | null = null, bestWall = Infinity;
  for (const wall of walls) {
    if (wall.curvePoint) continue;
    const d = distanceToSegment(p, wall.start, wall.end);
    if (d < wall.thickness / 2 + WALL_PICK / zoom && d < bestWall) { bestWall = d; wallPick = { kind: 'wall', wallId: wall.id }; }
  }
  return wallPick;
}

export const samePick = (a: DimensionPick | null, b: DimensionPick | null) =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'wall' ? a.wallId === (b as { wallId: string }).wallId
    : endpointKey(a.ref.wallId, a.ref.end) === endpointKey((b as { ref: CornerRef }).ref.wallId, (b as { ref: CornerRef }).ref.end));

function unit(w: Wall): Point {
  const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}
function signedDistance(w: Wall, p: Point): number {
  const n = wallNormal(w);
  return (p.x - w.start.x) * n.x + (p.y - w.start.y) * n.y;
}
const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
const mid = (w: Wall): Point => ({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 });

/** Two straight walls within 2° of parallel get a distance; otherwise an angle. */
export function wallsParallel(a: Wall, b: Wall): boolean {
  const u = unit(a), v = unit(b);
  return Math.abs(u.x * v.y - u.y * v.x) < PARALLEL;
}

/** Does this pick sequence need a second pick before placing? */
export function needsSecondPick(first: DimensionPick): boolean {
  return first.kind === 'corner';
}

/**
 * The dimension described by the picks and where the user places its label, measured
 * from the current geometry (so creating it never moves anything). `surface` measures
 * wall faces rather than centrelines: the face on the label's side for a wall length,
 * the facing faces between two walls.
 */
export function dimensionFromPicks(walls: Wall[], picks: DimensionPick[], place: Point, surface: boolean): NewConstraint | null {
  const byId = new Map(walls.map(w => [w.id, w]));
  const sketch = buildSketch(walls);
  const measured = (c: NewConstraint): NewConstraint | null => {
    const value = measureConstraint({ ...c, id: '' } as never, sketch);
    return value === null ? null : { ...c, value } as NewConstraint;
  };
  const [first, second] = picks;
  if (!first) return null;
  if (first.kind === 'wall' && !second) {
    const wall = byId.get(first.wallId);
    if (!wall) return null;
    const offset = signedDistance(wall, place), side: FaceSide = surface ? sign(offset) : 0;
    return measured({ kind: 'length', wallId: wall.id, side, value: 0, offset });
  }
  if (!second) return null;
  if (first.kind === 'corner' && second.kind === 'corner') {
    const p = first.point, q = second.point;
    const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x), minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
    const beyondX = place.x < minX || place.x > maxX, beyondY = place.y < minY || place.y > maxY;
    const axis = beyondX && !beyondY ? 'y' : beyondY && !beyondX ? 'x' : 'aligned';
    const u = axis === 'x' ? { x: 1, y: 0 } : axis === 'y' ? { x: 0, y: 1 } : (() => { const l = Math.hypot(q.x - p.x, q.y - p.y) || 1; return { x: (q.x - p.x) / l, y: (q.y - p.y) / l }; })();
    const center = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const offset = (place.x - center.x) * -u.y + (place.y - center.y) * u.x;
    return measured({ kind: 'pointDistance', a: first.ref, b: second.ref, axis, value: 0, offset });
  }
  if (first.kind !== second.kind) {
    const corner = (first.kind === 'corner' ? first : second) as Extract<DimensionPick, { kind: 'corner' }>;
    const wall = byId.get((first.kind === 'wall' ? first : second as Extract<DimensionPick, { kind: 'wall' }>).wallId);
    if (!wall || corner.ref.wallId === wall.id) return null;
    const side: FaceSide = surface ? sign(signedDistance(wall, corner.point)) : 0;
    const along = unit(wall), offset = (place.x - corner.point.x) * along.x + (place.y - corner.point.y) * along.y;
    return measured({ kind: 'pointLine', point: corner.ref, wallId: wall.id, side, value: 0, offset });
  }
  const a = byId.get((first as { wallId: string }).wallId), b = byId.get((second as { wallId: string }).wallId);
  if (!a || !b || a.id === b.id) return null;
  if (wallsParallel(a, b)) {
    const sideA: FaceSide = surface ? sign(signedDistance(a, mid(b))) : 0;
    const sideB: FaceSide = surface ? sign(signedDistance(b, mid(a))) : 0;
    const u = unit(a), offset = (place.x - mid(a).x) * u.x + (place.y - mid(a).y) * u.y;
    return measured({ kind: 'lineDistance', wallA: a.id, sideA, wallB: b.id, sideB, value: 0, offset });
  }
  // Angle: the rays of A and B on the placement's side of their intersection bound the measured sector.
  const center = lineIntersection(a, b);
  if (!center) return null;
  const d = { x: place.x - center.x, y: place.y - center.y }, ua = unit(a), ub = unit(b);
  const sa = sign(d.x * ua.x + d.y * ua.y), sb = sign(d.x * ub.x + d.y * ub.y);
  return measured({ kind: 'angle', wallA: a.id, wallB: b.id, flipB: sa * sb < 0, value: 0, offset: Math.max(30, Math.hypot(d.x, d.y)) });
}

export function lineIntersection(a: Wall, b: Wall): Point | null {
  const u = unit(a), v = unit(b), cross = u.x * v.y - u.y * v.x;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((b.start.x - a.start.x) * v.y - (b.start.y - a.start.y) * v.x) / cross;
  return { x: a.start.x + u.x * t, y: a.start.y + u.y * t };
}

/** Face endpoints of a wall (clipped by the walls meeting it), for drawing surface dimensions. */
export function faceEndpoints(wall: Wall, side: FaceSide, sketch: Sketch): [Point, Point] {
  const n = wallNormal(wall), u = unit(wall), o = side * wall.thickness / 2;
  if (side === 0) return [{ ...wall.start }, { ...wall.end }];
  const neighbours = (end: 'start' | 'end'): FaceNeighbour[] => {
    const key = endpointKey(wall.id, end), corner = sketch.cornerOf.get(key)!;
    const result: FaceNeighbour[] = sketch.members[corner].filter(k => keyWall(k) !== wall.id)
      .map(k => { const w = sketch.wallById.get(keyWall(k))!; return { start: w.start, end: w.end, thickness: w.thickness, at: k.endsWith(':end') ? 'end' : 'start' }; });
    const host = sketch.tJunctions.find(t => t.key === key)?.hostId;
    if (host) { const h = sketch.wallById.get(host)!; result.push({ start: h.start, end: h.end, thickness: h.thickness, at: 'host' }); }
    return result;
  };
  const s = faceInset(wall, side, 'start', neighbours('start')), e = faceInset(wall, side, 'end', neighbours('end'));
  return [
    { x: wall.start.x + n.x * o + u.x * s, y: wall.start.y + n.y * o + u.y * s },
    { x: wall.end.x + n.x * o - u.x * e, y: wall.end.y + n.y * o - u.y * e },
  ];
}

/** The offset that moves a dimension's line (or angle arc) through `p`, as constraintShapes reads it. */
export function dimensionOffset(c: Constraint, walls: Wall[], p: Point): number | undefined {
  const byId = new Map(walls.map(w => [w.id, w]));
  const corner = (ref: CornerRef) => byId.get(ref.wallId)?.[ref.end];
  switch (c.kind) {
    case 'length': { const w = byId.get(c.wallId); return w ? signedDistance(w, p) : undefined; }
    case 'pointDistance': {
      const a = corner(c.a), b = corner(c.b);
      if (!a || !b) return undefined;
      const u = c.axis === 'x' ? { x: 1, y: 0 } : c.axis === 'y' ? { x: 0, y: 1 } : (() => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; })();
      return (p.x - (a.x + b.x) / 2) * -u.y + (p.y - (a.y + b.y) / 2) * u.x;
    }
    case 'pointLine': {
      const q = corner(c.point), w = byId.get(c.wallId);
      if (!q || !w) return undefined;
      const u = unit(w);
      return (p.x - q.x) * u.x + (p.y - q.y) * u.y;
    }
    case 'lineDistance': {
      const a = byId.get(c.wallA);
      if (!a) return undefined;
      const u = unit(a), m = mid(a);
      return (p.x - m.x) * u.x + (p.y - m.y) * u.y;
    }
    case 'angle': {
      const a = byId.get(c.wallA), b = byId.get(c.wallB), center = a && b ? lineIntersection(a, b) : null;
      return center ? Math.max(20, Math.hypot(p.x - center.x, p.y - center.y)) : undefined;
    }
    default: return undefined;
  }
}
