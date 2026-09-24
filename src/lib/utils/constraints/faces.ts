/**
 * Wall faces: the two surfaces at ±thickness/2 from the centreline.
 * Side +1 is the face on the side of the normal (-dy, dx) of start→end.
 */
import type { FaceSide, Point, Room, Wall } from '$lib/models/types';
import { getRoomPolygon } from '$lib/utils/roomDetection';

export interface FaceWall { start: Point; end: Point; thickness: number }
/** A wall meeting the measured wall's end: at its own start/end, or `host` for a T-junction onto its interior. */
export interface FaceNeighbour extends FaceWall { at: 'start' | 'end' | 'host' }

const COLLINEAR = 0.1; // |sin| below which a neighbour continues the wall rather than crossing it

export function wallNormal(w: FaceWall): Point {
  const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/**
 * How far the face at `side` starts inside (positive) or beyond (negative) the wall's
 * `end`, measured along the wall. A neighbour on the face's side clips it (inside corner);
 * otherwise the neighbour's far face extends it (outside corner). T-hosts clip both faces.
 */
export function faceInset(w: FaceWall, side: 1 | -1, end: 'start' | 'end', neighbours: FaceNeighbour[]): number {
  const p = w[end], q = end === 'start' ? w.end : w.start;
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  if (length < 1e-9) return 0;
  const u = { x: (q.x - p.x) / length, y: (q.y - p.y) / length }, n = wallNormal(w), hw = w.thickness / 2;
  let clip = -Infinity, extend = Infinity;
  for (const nb of neighbours) {
    const a = nb.at === 'end' ? nb.end : nb.start, b = nb.at === 'end' ? nb.start : nb.end;
    const vl = Math.hypot(b.x - a.x, b.y - a.y);
    if (vl < 1e-9) continue;
    const v = { x: (b.x - a.x) / vl, y: (b.y - a.y) / vl };
    const cross = u.x * v.y - u.y * v.x;
    if (Math.abs(cross) < COLLINEAR) continue;
    const onSide = nb.at === 'host' || side * (n.x * v.x + n.y * v.y) > 0;
    const m = wallNormal(nb), mu = m.x * u.x + m.y * u.y;
    // The neighbour face towards the wall's body for an inside corner, away from it for an outside one.
    const sigma = (onSide ? 1 : -1) * Math.sign(mu), hn = nb.thickness / 2;
    const w0 = { x: sigma * hn * m.x - side * hw * n.x, y: sigma * hn * m.y - side * hw * n.y };
    const t = (w0.x * v.y - w0.y * v.x) / cross;
    if (onSide) clip = Math.max(clip, t); else extend = Math.min(extend, t);
  }
  return clip > -Infinity ? clip : extend < Infinity ? extend : 0;
}

/** Length of one face (or the centreline for side 0), clipped at both ends by the walls meeting it. */
export function faceSpan(w: FaceWall, side: FaceSide, startNeighbours: FaceNeighbour[], endNeighbours: FaceNeighbour[]): number {
  const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  if (side === 0) return length;
  return length - faceInset(w, side, 'start', startNeighbours) - faceInset(w, side, 'end', endNeighbours);
}

/** Signed offset of a face from the centreline, along the wall normal. */
export const faceOffset = (w: Pick<Wall, 'thickness'>, side: FaceSide) => side * w.thickness / 2;

/** Face line endpoints (unclipped), for drawing extension lines. */
export function faceLine(w: FaceWall, side: FaceSide): [Point, Point] {
  const n = wallNormal(w), o = side * w.thickness / 2;
  return [{ x: w.start.x + n.x * o, y: w.start.y + n.y * o }, { x: w.end.x + n.x * o, y: w.end.y + n.y * o }];
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export type FaceLabel = { kind: 'room'; name: string } | { kind: 'outside' } | { kind: 'unknown' };

/**
 * What each face of a wall looks onto, probing just beside the centreline at its middle
 * (room polygons run along centrelines, as in outerWalls).
 */
export function wallFaceLabels(wall: Wall, walls: Wall[], rooms: Room[]): Record<1 | -1, FaceLabel> {
  const polygons = rooms.filter(r => !r.floorOpening).map(room => ({ room, poly: getRoomPolygon(room, walls) })).filter(r => r.poly.length >= 3);
  const n = wallNormal(wall), mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  const probe = (side: 1 | -1) => polygons.find(r => pointInPolygon({ x: mid.x + n.x * 6 * side, y: mid.y + n.y * 6 * side }, r.poly))?.room;
  const plus = probe(1), minus = probe(-1);
  const label = (room: Room | undefined, other: Room | undefined): FaceLabel =>
    room ? { kind: 'room', name: room.name } : other ? { kind: 'outside' } : { kind: 'unknown' };
  return { 1: label(plus, minus), [-1]: label(minus, plus) } as Record<1 | -1, FaceLabel>;
}
