import type { Floor, FurnitureItem, PipeKind, PlanSection, Point, Project, Wall } from '$lib/models/types';
import { floorElevations } from './floors';
import { pathOpening, wallPathProfile, type WallOpening } from './wallProfiles';
import { resolveRoomGeometry } from './roomDetection';
import { createCeilingResolver, DEFAULT_SLAB_THICKNESS, effectiveRoomCeiling, storeyCeiling, type RoomOutline } from './ceilingHeights';
import { effectiveElevation, furnitureDrop, furnitureMount } from './mounting';
import { getCatalogItem, getFurnitureSize } from './furnitureCatalog';
import { pipeCentreHeight, pipeRadius } from './pipeModels3d';
import { PIPE_COLORS } from './pipes';

/**
 * Section cuts (spec §4.8, §5.4). Pure: pass the project and the section in.
 *
 * A section is a vertical cut along its line, seen in its viewing direction.
 * Everything here is in cm in "section coordinates":
 *  - u runs along the cut, 0 at the viewer's LEFT end, growing to the viewer's right;
 *  - d is the depth in front of the viewer (d > 0 is beyond the cut);
 *  - z is the absolute height (the storey's base elevation plus the height above its floor).
 *
 * The section looks along `look * leftNormal`, with dir = (end − start)/|end − start| and
 * leftNormal = (−dir.y, dir.x) in plan coordinates (y down). Looking along +leftNormal the
 * section's end is on the viewer's left; looking the other way its start is.
 */

/** How far beyond the cut things are drawn when no wall stops the view, cm. */
export const DEFAULT_CLIP_DEPTH = 2000;
/** Walls crossed at a shallower angle than this (|sin θ|) are skipped: the cut would run inside them. */
const MIN_CROSSING_SINE = 0.05;
/** Smallest height an item is drawn with (flat outlets and switches), cm. */
const MIN_ITEM_HEIGHT = 8;
/** Pieces narrower than this are dropped, cm. */
const EPS = 0.5;

/** Plan ↔ section coordinates for a section line. */
export interface SectionFrame {
  /** Plan point at u = 0, d = 0 (the viewer's left end of the line). */
  origin: Point;
  /** Unit plan vector along the cut toward the viewer's right (u grows). */
  dir: Point;
  /** Unit plan vector of the viewing direction (d grows). */
  view: Point;
  /** Length of the cut line, cm. */
  length: number;
  toCut(p: Point): { u: number; d: number };
  toPlan(u: number, d: number): Point;
}

type SectionLine = Pick<PlanSection, 'start' | 'end' | 'look'>;

export function sectionFrame(section: SectionLine): SectionFrame {
  const dx = section.end.x - section.start.x, dy = section.end.y - section.start.y;
  const length = Math.hypot(dx, dy);
  const along = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };
  const look = section.look === -1 ? -1 : 1;
  const view = { x: -along.y * look || 0, y: along.x * look || 0 };
  // Facing `view` in a y-down plan, the viewer's right is (−view.y, view.x): −along for look 1.
  const dir = look === 1 ? { x: -along.x || 0, y: -along.y || 0 } : along;
  const origin = look === 1 ? { ...section.end } : { ...section.start };
  return {
    origin, dir, view, length,
    toCut: p => {
      const rx = p.x - origin.x, ry = p.y - origin.y;
      return { u: rx * dir.x + ry * dir.y, d: rx * view.x + ry * view.y };
    },
    toPlan: (u, d) => ({ x: origin.x + dir.x * u + view.x * d, y: origin.y + dir.y * u + view.y * d }),
  };
}

// ── Model ─────────────────────────────────────────────────────────────

export interface SectionStorey {
  floorId: string;
  name: string;
  /** Elevation of the floor surface, cm. */
  base: number;
  /** Elevation of the next storey's floor, else the top of this storey's walls. */
  top: number;
  slabThickness: number;
}

/** An opening's outline in section coordinates. */
export interface SectionOpening { kind: 'door' | 'window'; id: string; u0: number; u1: number; z0: number; z1: number }

/** A wall crossed by the cut: filled pieces between z0 and z1 over [u0, u1]. */
export interface CutWall {
  floorId: string;
  wallId: string;
  u0: number;
  u1: number;
  /** Where the centre line crosses the cut. */
  u: number;
  base: number;
  /** Top of the wall at the cut (absolute). */
  top: number;
  pieces: { z0: number; z1: number }[];
  openings: SectionOpening[];
}

export interface CutSlab { floorId: string; u0: number; u1: number; z0: number; z1: number }

export interface CutRoom {
  floorId: string;
  roomId: string;
  name: string;
  /** Clear span between the faces of the walls cut on either side (or the outline where there are none). */
  u0: number;
  u1: number;
  base: number;
  /** Ceiling height above the floor, cm. */
  ceiling: number;
}

/** A wall seen beyond the cut: its visible face as a polygon, with the openings in that face. */
export interface BeyondWall {
  kind: 'wall';
  floorId: string;
  wallId: string;
  depth: number;
  u0: number;
  u1: number;
  /** Outline: along the floor left → right, then the top right → left. */
  points: { u: number; z: number }[];
  openings: SectionOpening[];
}

/** An item seen beyond the cut, as its bounding rectangle. */
export interface BeyondItem {
  kind: 'item';
  floorId: string;
  itemId: string;
  name: string;
  mount: 'floor' | 'wall' | 'ceiling';
  depth: number;
  u0: number;
  u1: number;
  z0: number;
  z1: number;
  /** Pendants: the drop line from the item's top up to the ceiling. */
  hang?: { u: number; z0: number; z1: number };
}

export type BeyondShape = BeyondWall | BeyondItem;

export interface CutPipe { floorId: string; pipeId: string; kind: PipeKind; color: string; u: number; z: number; r: number }

export interface SectionDimension {
  kind: 'storey' | 'ceiling' | 'width' | 'overall';
  axis: 'h' | 'v';
  /** Measured span along the axis (u for 'h', z for 'v'), cm. */
  from: number;
  to: number;
  /** Position across the axis in model cm (z for 'h', u for 'v')… */
  at: number;
  /** …moved by this many annotation units on the drawing (x right / y down). */
  offset: number;
}

export interface SectionModel {
  sectionId: string;
  code: string;
  length: number;
  storeys: SectionStorey[];
  walls: CutWall[];
  slabs: CutSlab[];
  rooms: CutRoom[];
  /** Far → near (painter's order). */
  beyond: BeyondShape[];
  pipes: CutPipe[];
  dimensions: SectionDimension[];
  bounds: { minU: number; maxU: number; minZ: number; maxZ: number };
}

export interface SectionOptions {
  /** Depth beyond the cut that is drawn when no wall stops the view, cm. */
  clipDepth?: number;
}

// ── Geometry helpers ─────────────────────────────────────────────────

interface Span { a: { u: number; d: number }; b: { u: number; d: number }; from: number; length: number }

function wallSpans(frame: SectionFrame, wall: Wall) {
  const path = wallPathProfile(wall);
  const spans: Span[] = path.spans.filter(span => span.length > 0)
    .map(span => ({ a: frame.toCut(span.start), b: frame.toCut(span.end), from: span.from, length: span.length }));
  return { path, spans };
}

function wallHoles(floor: Floor, wall: Wall, path: ReturnType<typeof wallPathProfile>) {
  const holes: (WallOpening & { kind: 'door' | 'window'; id: string })[] = [];
  for (const door of floor.doors) {
    if (door.wallId !== wall.id) continue;
    const hole = pathOpening(path, path.distanceAt(door.position), door.width, 0, door.height ?? 210);
    if (hole) holes.push({ ...hole, kind: 'door', id: door.id });
  }
  for (const win of floor.windows) {
    if (win.wallId !== wall.id) continue;
    const hole = pathOpening(path, path.distanceAt(win.position), win.width, win.sillHeight ?? 90, win.height);
    if (hole) holes.push({ ...hole, kind: 'window', id: win.id });
  }
  return holes;
}

/** [0, top] minus the holes, as filled pieces. */
function solidPieces(top: number, holes: { bottom: number; top: number }[]): { z0: number; z1: number }[] {
  const pieces: { z0: number; z1: number }[] = [];
  let z = 0;
  for (const hole of [...holes].sort((p, q) => p.bottom - q.bottom)) {
    if (hole.bottom > z + EPS) pieces.push({ z0: z, z1: Math.min(hole.bottom, top) });
    z = Math.max(z, hole.top);
  }
  if (top > z + EPS) pieces.push({ z0: z, z1: top });
  return pieces.filter(piece => piece.z1 - piece.z0 > EPS);
}

/** u where the infinite cut line (d = 0) crosses a polygon's edges, sorted. */
function lineCrossings(frame: SectionFrame, polygon: Point[]): number[] {
  const us: number[] = [];
  const pts = polygon.map(frame.toCut);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if ((a.d > 0) === (b.d > 0)) continue;
    const t = a.d / (a.d - b.d);
    us.push(a.u + (b.u - a.u) * t);
  }
  return us.sort((p, q) => p - q);
}

/** The parts of the cut line inside a polygon, clipped to the line. */
function polygonIntervals(frame: SectionFrame, polygon: Point[]): [number, number][] {
  const us = lineCrossings(frame, polygon);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < us.length; i += 2) {
    const a = Math.max(0, us[i]), b = Math.min(frame.length, us[i + 1]);
    if (b - a > EPS) out.push([a, b]);
  }
  return out;
}

function subtractIntervals(from: [number, number][], cut: [number, number][]): [number, number][] {
  let pieces = from;
  for (const [c0, c1] of cut) {
    pieces = pieces.flatMap(([a, b]): [number, number][] => {
      if (c1 <= a || c0 >= b) return [[a, b]];
      const left: [number, number][] = c0 > a + EPS ? [[a, c0]] : [];
      const right: [number, number][] = c1 < b - EPS ? [[c1, b]] : [];
      return [...left, ...right];
    });
  }
  return pieces;
}

function unionIntervals(intervals: [number, number][], gap = 1): [number, number][] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const polygonArea = (poly: Point[]) => {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(sum / 2);
};

// ── Floors ───────────────────────────────────────────────────────────

function wallCrossesCut(frame: SectionFrame, wall: Wall): boolean {
  return wallSpans(frame, wall).spans.some(({ a, b }) => {
    if ((a.d > 0) === (b.d > 0)) return false;
    const u = a.u + (b.u - a.u) * (a.d / (a.d - b.d));
    return u >= 0 && u <= frame.length;
  });
}

/** Whether the line passes through the storey's walls or rooms. */
export function sectionCrossesFloor(frame: SectionFrame, floor: Floor, rooms: readonly RoomOutline[] = resolveRoomGeometry(floor)): boolean {
  if (frame.length <= 0) return false;
  return floor.walls.some(wall => wallCrossesCut(frame, wall))
    || rooms.some(({ polygon }) => polygon.length >= 3 && polygonIntervals(frame, polygon).length > 0);
}

/**
 * The storeys a section shows, lowest first, with their base elevation: those named by
 * `floorIds` (unknown ids ignored; none known = all), and of those only the ones whose
 * walls or rooms the line passes through.
 */
export function sectionFloors(project: Pick<Project, 'floors'>, section: Pick<PlanSection, 'start' | 'end' | 'look' | 'floorIds'>): { floor: Floor; base: number }[] {
  const frame = sectionFrame(section);
  const entries = floorElevations(project.floors);
  const named = section.floorIds?.length ? entries.filter(entry => section.floorIds!.includes(entry.floor.id)) : [];
  return (named.length ? named : entries)
    .filter(entry => sectionCrossesFloor(frame, entry.floor))
    .map(entry => ({ floor: entry.floor, base: entry.elevation }));
}

// ── Cut elements ─────────────────────────────────────────────────────

/**
 * Walls the cut passes through (curved walls facet by facet). Each crossing covers
 * u_hit ± (thickness / 2) / |sin θ| and is filled from the floor to the wall's height at
 * that point, minus any door or window there (filled below the sill and above the head).
 */
export function cutWalls(frame: SectionFrame, floor: Floor, base: number): CutWall[] {
  const out: CutWall[] = [];
  for (const wall of floor.walls) {
    const { path, spans } = wallSpans(frame, wall);
    let holes: ReturnType<typeof wallHoles> | null = null;
    for (const span of spans) {
      const { a, b } = span;
      if ((a.d > 0) === (b.d > 0)) continue;
      const t = a.d / (a.d - b.d);
      const u = a.u + (b.u - a.u) * t;
      if (u < 0 || u > frame.length) continue;
      const sine = Math.abs(b.d - a.d) / span.length;
      if (sine < MIN_CROSSING_SINE) continue;
      const half = wall.thickness / 2 / sine;
      const u0 = Math.max(0, u - half), u1 = Math.min(frame.length, u + half);
      if (u1 - u0 <= 0) continue;
      const s = span.from + t * span.length;
      const height = path.sample(s).height;
      holes ??= wallHoles(floor, wall, path);
      const here = holes.filter(hole => s >= hole.left && s <= hole.right);
      out.push({
        floorId: floor.id, wallId: wall.id, u0, u1, u, base, top: base + height,
        pieces: solidPieces(height, here).map(piece => ({ z0: base + piece.z0, z1: base + piece.z1 })),
        openings: here.map(hole => ({ kind: hole.kind, id: hole.id, u0, u1, z0: base + hole.bottom, z1: base + Math.min(hole.top, height) })),
      });
    }
  }
  return out.sort((p, q) => p.u0 - q.u0);
}

/** Rooms along the cut: their clear spans (smaller rooms win where outlines nest) with their ceilings. */
export function cutRooms(project: Pick<Project, 'floors'>, frame: SectionFrame, floor: Floor, base: number,
  walls: CutWall[] = cutWalls(frame, floor, base), outlines: readonly RoomOutline[] = resolveRoomGeometry(floor)): (CutRoom & { raw: [number, number][]; opening: boolean })[] {
  const covered: [number, number][] = [];
  const out: (CutRoom & { raw: [number, number][]; opening: boolean })[] = [];
  const sorted = outlines.filter(({ polygon }) => polygon.length >= 3)
    .map(outline => ({ ...outline, area: polygonArea(outline.polygon) }))
    .sort((p, q) => p.area - q.area);
  for (const { room, polygon } of sorted) {
    const raw = polygonIntervals(frame, polygon);
    const pieces = subtractIntervals(raw, covered);
    covered.push(...raw);
    if (!pieces.length) continue;
    const ceiling = effectiveRoomCeiling(project, floor, room);
    for (const [a, b] of pieces) {
      const left = walls.find(w => a >= w.u0 - EPS && a <= w.u1 + EPS);
      const right = walls.find(w => b >= w.u0 - EPS && b <= w.u1 + EPS);
      const u0 = left ? Math.max(a, left.u1) : a, u1 = right ? Math.min(b, right.u0) : b;
      if (u1 - u0 <= EPS) continue;
      out.push({ floorId: floor.id, roomId: room.id, name: room.name, u0, u1, base, ceiling, raw, opening: !!room.floorOpening });
    }
  }
  return out.sort((p, q) => p.u0 - q.u0);
}

/**
 * The slab under a storey: a band `slabThickness` deep below its floor, under its rooms
 * (not floor openings) and cut walls; without rooms, from the first cut wall to the last.
 */
export function cutSlabs(floor: Floor, base: number, walls: CutWall[], rooms: { raw: [number, number][]; opening: boolean }[]): CutSlab[] {
  const thickness = Number.isFinite(floor.slabThickness) && floor.slabThickness! > 0 ? floor.slabThickness! : DEFAULT_SLAB_THICKNESS;
  let spans: [number, number][] = [
    ...walls.map((w): [number, number] => [w.u0, w.u1]),
    ...rooms.filter(room => !room.opening).flatMap(room => room.raw),
  ];
  if (!rooms.length && walls.length >= 2) spans = [[walls[0].u0, Math.max(...walls.map(w => w.u1))]];
  return unionIntervals(spans).map(([u0, u1]) => ({ floorId: floor.id, u0, u1, z0: base - thickness, z1: base }));
}

// ── Beyond the cut ───────────────────────────────────────────────────

interface Hit { wall: Wall; depth: number; s: number; height: number }

/** The first wall face the view meets at u (looking from the cut), or null. */
function makeBlocker(frame: SectionFrame, floor: Floor) {
  const walls = floor.walls.map(wall => ({ wall, ...wallSpans(frame, wall) }));
  return (u: number): Hit | null => {
    let best: Hit | null = null;
    for (const { wall, path, spans } of walls) {
      for (const span of spans) {
        const { a, b } = span;
        const du = b.u - a.u;
        if (Math.abs(du) / span.length < MIN_CROSSING_SINE) continue;
        const t = (u - a.u) / du;
        if (t < 0 || t > 1) continue;
        const centre = a.d + (b.d - a.d) * t;
        if (centre <= 0) continue;
        const depth = Math.max(0, centre - wall.thickness / 2 / (Math.abs(du) / span.length));
        if (!best || depth < best.depth) {
          const s = span.from + t * span.length;
          best = { wall, depth, s, height: path.sample(s).height };
        }
      }
    }
    return best;
  };
}

/**
 * What is seen beyond the cut, up to the first wall in the viewing direction (or
 * `clipDepth`): the faces of those walls with their openings, and the items standing in
 * front of them at their real heights (pendants with a drop line to the ceiling; wall
 * items at their mounting height). Sorted far → near for painting.
 */
export function beyondItems(project: Pick<Project, 'floors'>, frame: SectionFrame, floor: Floor, base: number,
  options: SectionOptions & { rooms?: readonly RoomOutline[] } = {}): BeyondShape[] {
  const clip = options.clipDepth ?? DEFAULT_CLIP_DEPTH;
  if (frame.length <= 0) return [];
  const blocker = makeBlocker(frame, floor);
  const blockDepth = (u: number) => Math.min(clip, blocker(u)?.depth ?? Infinity);
  const shapes: BeyondShape[] = [];

  // Wall faces: sample the line, then bisect where the first wall changes.
  const step = Math.max(5, Math.min(10, frame.length / 400));
  const count = Math.max(2, Math.ceil(frame.length / step) + 1);
  const samples = Array.from({ length: count }, (_, i) => {
    const u = Math.min(frame.length, (i * frame.length) / (count - 1));
    const hit = blocker(u);
    return { u, hit: hit && hit.depth <= clip ? hit : null };
  });
  const sameWall = (p: Hit | null, q: Hit | null) => (p?.wall.id ?? null) === (q?.wall.id ?? null);
  const edge = (lo: number, hi: number, loHit: Hit | null) => {
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2, h = blocker(mid);
      const hit = h && h.depth <= clip ? h : null;
      if (sameWall(hit, loHit)) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let runStart = 0;
  const runs: { from: number; to: number; samples: typeof samples }[] = [];
  for (let i = 1; i <= samples.length; i++) {
    if (i < samples.length && sameWall(samples[i].hit, samples[i - 1].hit)) continue;
    const first = samples[runStart], last = samples[i - 1];
    const from = runStart === 0 ? 0 : edge(samples[runStart - 1].u, first.u, samples[runStart - 1].hit);
    const to = i === samples.length ? frame.length : edge(last.u, samples[i].u, last.hit);
    if (last.hit) runs.push({ from, to, samples: samples.slice(runStart, i) });
    runStart = i;
  }
  for (const run of runs) {
    if (run.to - run.from <= EPS) continue;
    const wall = run.samples[0].hit!.wall;
    const endHit = (u: number) => blocker(u) ?? run.samples[0].hit!;
    const tops = [
      { u: run.from, z: base + endHit(Math.min(run.to, run.from + 0.01)).height },
      ...run.samples.filter(s => s.u > run.from && s.u < run.to).map(s => ({ u: s.u, z: base + s.hit!.height })),
      { u: run.to, z: base + endHit(Math.max(run.from, run.to - 0.01)).height },
    ].filter((p, i, all) => i === 0 || i === all.length - 1 || Math.abs(p.z - all[i - 1].z) > 0.01 || Math.abs(p.z - all[i + 1].z) > 0.01);
    const path = wallPathProfile(wall);
    const openings: SectionOpening[] = wallHoles(floor, wall, path).flatMap(hole => {
      const ua = frame.toCut(path.sample(hole.left).point).u, ub = frame.toCut(path.sample(hole.right).point).u;
      const u0 = Math.max(run.from, Math.min(ua, ub)), u1 = Math.min(run.to, Math.max(ua, ub));
      return u1 - u0 > EPS ? [{ kind: hole.kind, id: hole.id, u0, u1, z0: base + hole.bottom, z1: base + hole.top }] : [];
    });
    const depth = run.samples.reduce((sum, s) => sum + s.hit!.depth, 0) / run.samples.length;
    shapes.push({
      kind: 'wall', floorId: floor.id, wallId: wall.id, depth, u0: run.from, u1: run.to,
      points: [{ u: run.from, z: base }, { u: run.to, z: base }, ...tops.reverse()],
      openings,
    });
  }

  // Items in front of those walls.
  const ceilingAt = createCeilingResolver(project, floor, options.rooms);
  for (const item of floor.furniture) {
    const box = itemBox(frame, item);
    if (box.u1 < 0 || box.u0 > frame.length || box.d1 <= 0 || box.d0 > clip) continue;
    const u0 = Math.max(0, box.u0), u1 = Math.min(frame.length, box.u1);
    const visible = [0, 0.25, 0.5, 0.75, 1].some(f => box.d0 < blockDepth(u0 + (u1 - u0) * f) + 1);
    if (!visible) continue;
    const size = getFurnitureSize(item);
    const z0 = base + effectiveElevation(item, ceilingAt);
    const z1 = z0 + Math.max(size.height, MIN_ITEM_HEIGHT);
    const mount = furnitureMount(item);
    const shape: BeyondItem = {
      kind: 'item', floorId: floor.id, itemId: item.id, name: getCatalogItem(item.catalogId)?.name ?? item.catalogId,
      mount, depth: (box.d0 + box.d1) / 2, u0, u1, z0, z1,
    };
    if (mount === 'ceiling' && furnitureDrop(item) > 0) {
      const ceiling = base + ceilingAt(item.position);
      if (ceiling > z1) shape.hang = { u: Math.max(u0, Math.min(u1, frame.toCut(item.position).u)), z0: z1, z1: ceiling };
    }
    shapes.push(shape);
  }
  return shapes.sort((p, q) => q.depth - p.depth);
}

function itemBox(frame: SectionFrame, item: FurnitureItem) {
  const { width, depth } = getFurnitureSize(item);
  const angle = (item.rotation || 0) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  let u0 = Infinity, u1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const [lx, ly] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = lx * width / 2, y = ly * depth / 2;
    const p = frame.toCut({ x: item.position.x + x * c - y * s, y: item.position.y + x * s + y * c });
    u0 = Math.min(u0, p.u); u1 = Math.max(u1, p.u); d0 = Math.min(d0, p.d); d1 = Math.max(d1, p.d);
  }
  return { u0, u1, d0, d1 };
}

/** Pipe runs crossing the cut, as circles at their height. Risers are left out. */
export function cutPipes(project: Pick<Project, 'floors'>, frame: SectionFrame, floor: Floor, base: number, rooms?: readonly RoomOutline[]): CutPipe[] {
  if (!floor.pipes?.length) return [];
  const ceilingAt = createCeilingResolver(project, floor, rooms);
  const out: CutPipe[] = [];
  for (const pipe of floor.pipes) {
    if (pipe.riser || pipe.points.length < 2) continue;
    const z = base + pipeCentreHeight(pipe, ceilingAt), r = pipeRadius(pipe);
    for (let i = 1; i < pipe.points.length; i++) {
      const a = frame.toCut(pipe.points[i - 1]), b = frame.toCut(pipe.points[i]);
      if ((a.d > 0) === (b.d > 0)) continue;
      const u = a.u + (b.u - a.u) * (a.d / (a.d - b.d));
      if (u >= 0 && u <= frame.length) out.push({ floorId: floor.id, pipeId: pipe.id, kind: pipe.kind, color: PIPE_COLORS[pipe.kind], u, z, r });
    }
  }
  return out;
}

// ── Dimensions ───────────────────────────────────────────────────────

/**
 * Dimension lines: storey heights chained at the left, each room's ceiling height inside
 * it, room widths along the cut just above each floor, and the overall length below
 * (the extent of the cut walls and slabs, or the whole line when nothing solid is cut).
 * Offsets are in annotation units (see SectionDimension).
 */
export function sectionDimensions(model: Pick<SectionModel, 'length' | 'storeys' | 'rooms' | 'bounds'> & Partial<Pick<SectionModel, 'walls' | 'slabs'>>): SectionDimension[] {
  const dims: SectionDimension[] = [];
  for (const storey of model.storeys) {
    if (storey.top - storey.base > EPS) dims.push({ kind: 'storey', axis: 'v', from: storey.base, to: storey.top, at: 0, offset: -36 });
  }
  for (const room of model.rooms) {
    if (room.u1 - room.u0 < 20) continue;
    dims.push({ kind: 'ceiling', axis: 'v', from: room.base, to: room.base + room.ceiling, at: room.u0, offset: 16 });
    dims.push({ kind: 'width', axis: 'h', from: room.u0, to: room.u1, at: room.base, offset: -18 });
  }
  // Overall: the building's extent along the cut (outer faces of the cut walls and slabs), else the line.
  const solid = [...(model.walls ?? []), ...(model.slabs ?? [])];
  const from = solid.length ? Math.min(...solid.map(s => s.u0)) : 0;
  const to = solid.length ? Math.max(...solid.map(s => s.u1)) : model.length;
  if (to - from > EPS) dims.push({ kind: 'overall', axis: 'h', from, to, at: model.bounds.minZ, offset: 36 });
  return dims;
}

// ── Whole section ────────────────────────────────────────────────────

/** Everything the section viewer and the exports draw, in cm (u along the cut, z up). */
export function computeSection(project: Pick<Project, 'floors'>, section: PlanSection, options: SectionOptions = {}): SectionModel {
  const frame = sectionFrame(section);
  const storeys: SectionStorey[] = [];
  const walls: CutWall[] = [], slabs: CutSlab[] = [], rooms: CutRoom[] = [], beyond: BeyondShape[] = [], pipes: CutPipe[] = [];
  const all = floorElevations(project.floors);
  for (const { floor, base } of sectionFloors(project, section)) {
    const outlines = resolveRoomGeometry(floor);
    const floorWalls = cutWalls(frame, floor, base);
    const floorRooms = cutRooms(project, frame, floor, base, floorWalls, outlines);
    const thickness = Number.isFinite(floor.slabThickness) && floor.slabThickness! > 0 ? floor.slabThickness! : DEFAULT_SLAB_THICKNESS;
    const above = all.find(entry => entry.elevation > base + EPS);
    const wallTop = Math.max(0, ...floorWalls.map(w => w.top - base), ...floorRooms.map(r => r.ceiling));
    const top = above ? above.elevation : base + (wallTop > 0 ? wallTop : storeyCeiling(project, floor));
    storeys.push({ floorId: floor.id, name: floor.name, base, top, slabThickness: thickness });
    walls.push(...floorWalls);
    rooms.push(...floorRooms.map(({ raw: _raw, opening: _opening, ...room }) => room));
    slabs.push(...cutSlabs(floor, base, floorWalls, floorRooms));
    beyond.push(...beyondItems(project, frame, floor, base, { ...options, rooms: outlines }));
    pipes.push(...cutPipes(project, frame, floor, base, outlines));
  }
  beyond.sort((p, q) => q.depth - p.depth);
  const zs = [
    ...storeys.flatMap(s => [s.base - s.slabThickness, s.top]),
    ...walls.map(w => w.top), ...slabs.map(s => s.z0),
    ...beyond.flatMap(b => b.kind === 'wall' ? b.points.map(p => p.z) : [b.z0, b.z1]),
  ].filter(Number.isFinite);
  const bounds = { minU: 0, maxU: frame.length, minZ: zs.length ? Math.min(...zs) : 0, maxZ: zs.length ? Math.max(...zs) : 0 };
  const model: SectionModel = { sectionId: section.id, code: section.code, length: frame.length, storeys, walls, slabs, rooms, beyond, pipes, dimensions: [], bounds };
  model.dimensions = sectionDimensions(model);
  return model;
}

/**
 * Wall elevation as a section (spec §5.4): a line parallel to the wall, `offset` cm in
 * front of its face on `side` (1 = the wall's left normal), looking back at it. Curved
 * walls use their chord. The result is not stored; its id is `elevation:<wall id>`.
 */
export function wallElevationSection(wall: Pick<Wall, 'id' | 'start' | 'end' | 'thickness'>, side: 1 | -1 = 1, offset = 60): PlanSection {
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const left = { x: -dy / length, y: dx / length };
  const shift = side * (wall.thickness / 2 + offset);
  return {
    id: `elevation:${wall.id}`, code: '',
    start: { x: wall.start.x + left.x * shift, y: wall.start.y + left.y * shift },
    end: { x: wall.end.x + left.x * shift, y: wall.end.y + left.y * shift },
    look: side === 1 ? -1 : 1,
  };
}
