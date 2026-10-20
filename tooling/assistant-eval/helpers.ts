/**
 * Starting plans and plan checks for the assistant test set. Setups build the
 * plan with the same plan tools the assistant uses; checks read the final
 * project directly, so they keep working when the tools change.
 */
import { get } from 'svelte/store';
import type { Door, Floor, FurnitureItem, Point, Project, Wall, Window as Win } from '$lib/models/types';
import { createDefaultProject, currentProject, loadProject } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import { runCheck } from '$lib/assistant/checks';
import { catalogName, convexOverlap, furnitureFootprint, insidePolygon, isLayered, nearPolygon, polygonArea, polygonGap, segmentDistance, wallQuad } from '$lib/assistant/geometry';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';
import { interiorRoomArea } from '$lib/utils/interiorArea';
import { getCatalogItem, getFurnitureSize, furnitureTrade } from '$lib/utils/furnitureCatalog';
import { effectiveElevation, furnitureMount } from '$lib/utils/mounting';
import { createCeilingResolver } from '$lib/utils/ceilingHeights';
import { wallLength } from '$lib/utils/wallEditing';

export interface CheckResult { name: string; pass: boolean; detail: string }

export const check = (name: string, pass: boolean, detail = ''): CheckResult => ({ name, pass, detail });

const r0 = Math.round;
const fmt = (p: Point) => `(${r0(p.x)},${r0(p.y)})`;

// ── Building starting plans ──────────────────────────────────────────

export function fresh(name = 'Eval plan') {
  loadProject(createDefaultProject(name));
}

export function project(): Project {
  return get(currentProject) ?? (() => { throw new Error('No project is open.'); })();
}

export function activeFloorOf(p: Project): Floor {
  return p.floors.find(f => f.id === p.activeFloorId) ?? p.floors[0];
}

function tool(name: string, input: unknown) {
  const outcome = runPlanTool(name, input);
  if (outcome.isError || /\berror:/.test(outcome.text)) throw new Error(`setup ${name} failed: ${outcome.text}`);
  return outcome;
}

export function room(name: string, x: number, y: number, width: number, depth: number) {
  tool('add_room', { name, x, y, width, depth });
}

/** The straight wall running through p. */
export function wallAt(floor: Floor, p: Point): Wall {
  const wall = floor.walls.find(w => !w.curvePoint && segmentDistance(p, w.start, w.end) < 2);
  if (!wall) throw new Error(`No wall at ${fmt(p)}.`);
  return wall;
}

/** A door or window centred on the wall through p. */
export function opening(kind: 'door' | 'window', p: Point, width?: number, type?: string) {
  const wall = wallAt(activeFloorOf(project()), p);
  const offset = Math.hypot(p.x - wall.start.x, p.y - wall.start.y);
  tool('add_openings', { items: [{ kind, wallId: wall.id, offset, ...(width ? { width } : {}), ...(type ? { type } : {}) }] });
}

export type Placement = [catalogId: string, x: number, y: number, rotation?: number, size?: { width?: number; depth?: number }];

export function place(...items: Placement[]): string[] {
  const outcome = tool('place_furniture', { items: items.map(([catalogId, x, y, rotation = 0, size]) => ({ catalogId, x, y, rotation, ...size })) });
  return outcome.changed ?? [];
}

/** Living 5.0 × 4.0 m and bedroom 4.0 × 4.0 m side by side (wall centres), a door between them and one in from outside. */
export function twoRoomFlat() {
  fresh('Two-room flat');
  room('Living room', 0, 0, 500, 400);
  room('Bedroom', 500, 0, 400, 400);
  opening('door', { x: 500, y: 330 });
  opening('door', { x: 250, y: 400 });
  opening('window', { x: 250, y: 0 });
  opening('window', { x: 700, y: 0 });
  opening('window', { x: 900, y: 200 });
}

/**
 * About 75 m², 10.0 × 7.5 m to wall centres, walls 15 cm:
 * living room 5.5 × 4.5 top left, kitchen 4.5 × 3.0 top right, hall 2.0 × 4.5
 * in the middle with the entrance at the bottom, bathroom 2.5 × 2.5 and a
 * storage room 2.5 × 2.0 right of the hall, bedroom 5.5 × 3.0 bottom left.
 * Every room has a door from the hall.
 */
export function apartment(doorWidths: Partial<Record<'entrance' | 'living' | 'kitchen' | 'bedroom' | 'bathroom' | 'storage', number>> = {}) {
  fresh('Apartment 75 m²');
  room('Living room', 0, 0, 550, 450);
  room('Kitchen', 550, 0, 450, 300);
  room('Hall', 550, 300, 200, 450);
  room('Bathroom', 750, 300, 250, 250);
  room('Bedroom', 0, 450, 550, 300);
  room('Storage', 750, 550, 250, 200);
  opening('door', { x: 650, y: 750 }, doorWidths.entrance);
  opening('door', { x: 550, y: 375 }, doorWidths.living);
  opening('door', { x: 650, y: 300 }, doorWidths.kitchen);
  opening('door', { x: 550, y: 600 }, doorWidths.bedroom);
  opening('door', { x: 750, y: 425 }, doorWidths.bathroom);
  opening('door', { x: 750, y: 650 }, doorWidths.storage);
  opening('window', { x: 275, y: 0 });
  opening('window', { x: 0, y: 225 });
  opening('window', { x: 775, y: 0 });
  opening('window', { x: 1000, y: 150 });
  opening('window', { x: 0, y: 600 });
  opening('window', { x: 1000, y: 425 }, 80);
}

/** Kitchen run along the top wall of the apartment's kitchen: fridge, counter, sink, stove, counter. */
export function kitchenRun() {
  place(
    ['fridge', 592.5, 42.5],
    ['counter', 687.5, 37.5],
    ['sink_k', 777.5, 37.5, 0, { depth: 60 }],
    ['stove', 837.5, 37.5],
    ['counter', 927.5, 37.5],
  );
}

/** A dining table for four in the apartment's living room, top right. */
export function diningSet() {
  place(
    ['dining_table', 400, 120],
    ['dining_chair', 370, 55], ['dining_chair', 430, 55],
    ['dining_chair', 370, 185, 180], ['dining_chair', 430, 185, 180],
  );
}

// ── Reading the final plan ───────────────────────────────────────────

export interface RoomShape { id: string; name: string; polygon: Point[]; walls: string[]; area: number; inside: number | null }

export function rooms(floor: Floor): RoomShape[] {
  return resolveRoomGeometry(floor).filter(g => g.polygon.length >= 3).map(({ room, polygon }) => ({
    id: room.id, name: room.name, polygon, walls: room.walls,
    area: polygonArea(polygon) / 10000, inside: interiorRoomArea(polygon, [], floor.walls),
  }));
}

export function roomNamed(floor: Floor, pattern: RegExp): RoomShape | undefined {
  return rooms(floor).find(r => pattern.test(r.name));
}

/** The room whose outline contains p (the smallest, if nested). */
export function roomAtPoint(floor: Floor, p: Point): RoomShape | undefined {
  return rooms(floor).filter(r => insidePolygon(p, r.polygon)).sort((a, b) => a.area - b.area)[0];
}

/** Catalog text for matching: id, name and category. */
export function catalogText(item: Pick<FurnitureItem, 'catalogId'>): string {
  const def = getCatalogItem(item.catalogId);
  return `${item.catalogId} ${def?.name ?? ''} ${def?.category ?? ''}`.toLowerCase();
}

/** Catalog id and name only (no category: "Bedroom" would match "bed"). */
const nameText = (item: Pick<FurnitureItem, 'catalogId'>) => `${item.catalogId} ${getCatalogItem(item.catalogId)?.name ?? ''}`.toLowerCase();

/** Kinds of items, by catalog id, name and category rather than fixed ids. */
export const KIND = {
  bed: (i: FurnitureItem) => getCatalogItem(i.catalogId)?.category === 'Bedroom' && /\bbed(\b|_)/.test(nameText(i)),
  nightstand: (i: FurnitureItem) => /nightstand|bedside/.test(catalogText(i)),
  wardrobe: (i: FurnitureItem) => /wardrobe|closet|dresser/.test(catalogText(i)),
  sofa: (i: FurnitureItem) => /sofa|couch|loveseat/.test(catalogText(i)),
  coffeeTable: (i: FurnitureItem) => /coffee_table|coffee table/.test(catalogText(i)),
  tv: (i: FurnitureItem) => /television|tv_stand|tv_lowboard|\btv\b/.test(catalogText(i)),
  diningTable: (i: FurnitureItem) => /dining_table|dining table/.test(catalogText(i)),
  diningChair: (i: FurnitureItem) => /dining_chair|dining chair/.test(catalogText(i)),
  counter: (i: FurnitureItem) => /counter|stove|sink_k|oven|dishwasher/.test(catalogText(i)),
  fridge: (i: FurnitureItem) => /fridge/.test(catalogText(i)) && !/wine/.test(catalogText(i)),
  kitchenSink: (i: FurnitureItem) => i.catalogId === 'sink_k' || (/sink/.test(catalogText(i)) && /kitchen/.test(catalogText(i))),
  cooker: (i: FurnitureItem) => /stove|oven|cooktop|hob/.test(catalogText(i)),
  toilet: (i: FurnitureItem) => /toilet|\bwc\b/.test(catalogText(i)),
  basin: (i: FurnitureItem) => /sink|basin/.test(catalogText(i)) && /bathroom/.test(catalogText(i)),
  showerOrTub: (i: FurnitureItem) => /shower|bathtub|bath tub/.test(catalogText(i)),
  washer: (i: FurnitureItem) => /washer|washing/.test(nameText(i)) && !/hookup|dish/.test(nameText(i)),
  outlet: (i: FurnitureItem) => /outlet|socket/.test(catalogText(i)),
  switch: (i: FurnitureItem) => /switch/.test(catalogText(i)),
  light: (i: FurnitureItem) => furnitureTrade(i) === 'electrical' && /light|lamp|pendant|chandelier|sconce|spot/.test(nameText(i)) && !/switch/.test(nameText(i)),
  pendant: (i: FurnitureItem) => /pendant|chandelier/.test(catalogText(i)),
  spot: (i: FurnitureItem) => /recessed|spot|downlight/.test(catalogText(i)) && !/outdoor/.test(catalogText(i)),
};

export const itemsOf = (floor: Floor, kind: (i: FurnitureItem) => boolean) => floor.furniture.filter(kind);

const label = (item: FurnitureItem) => `${catalogName(item)} ${fmt(item.position)}`;

/** Centre inside the room and every corner within tol cm of it (room outlines are wall centre lines). */
export function inRoom(item: FurnitureItem, room: RoomShape, tol = 1): boolean {
  if (!insidePolygon(item.position, room.polygon)) return false;
  return furnitureFootprint(item).every(c => nearPolygon(c, room.polygon, tol));
}

export const itemsIn = (floor: Floor, room: RoomShape | undefined, kind: (i: FurnitureItem) => boolean = () => true) =>
  room ? floor.furniture.filter(i => kind(i) && insidePolygon(i.position, room.polygon)) : [];

/** Pairs of floor-standing items that overlap, as the placement tools judge it (3 cm margin). */
export function overlaps(floor: Floor, items = floor.furniture): string[] {
  const solid = items.filter(i => !isLayered(i));
  const all = floor.furniture.filter(i => !isLayered(i));
  const found: string[] = [], seen = new Set<string>();
  for (const a of solid) for (const b of all) {
    const key = [a.id, b.id].sort().join('|');
    if (a.id === b.id || seen.has(key)) continue;
    seen.add(key);
    if (convexOverlap(furnitureFootprint(a), furnitureFootprint(b), 3)) found.push(`${label(a)} overlaps ${label(b)}`);
  }
  return found;
}

export function throughWalls(floor: Floor, items = floor.furniture): string[] {
  const found: string[] = [];
  for (const item of items) {
    if (furnitureMount(item) !== 'floor') continue;
    const wall = floor.walls.find(w => !w.curvePoint && convexOverlap(furnitureFootprint(item), wallQuad(w, 1), 1));
    if (wall) found.push(`${label(item)} goes through wall ${wall.id}`);
  }
  return found;
}

/** The swing zone of a door on both sides of its wall, as the placement tools draw it. */
export function doorZone(floor: Floor, door: Door): Point[] | null {
  const wall = floor.walls.find(w => w.id === door.wallId);
  if (!wall || wall.curvePoint) return null;
  const len = wallLength(wall) || 1, ux = (wall.end.x - wall.start.x) / len, uy = (wall.end.y - wall.start.y) / len;
  const center = { x: wall.start.x + ux * door.position * len, y: wall.start.y + uy * door.position * len };
  const reach = Math.min(door.width, 90) + wall.thickness / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, n]) => ({
    x: center.x + ux * s * door.width / 2 - uy * n * reach,
    y: center.y + uy * s * door.width / 2 + ux * n * reach,
  }));
}

export function blockedDoors(floor: Floor, items = floor.furniture): string[] {
  const found: string[] = [];
  for (const door of floor.doors) {
    const zone = doorZone(floor, door);
    if (!zone) continue;
    for (const item of items) {
      if (isLayered(item)) continue;
      if (convexOverlap(furnitureFootprint(item), zone, 2)) found.push(`${label(item)} blocks door ${door.id}`);
    }
  }
  return found;
}

export function openingCentre(floor: Floor, o: Door | Win): Point | null {
  const wall = floor.walls.find(w => w.id === o.wallId);
  if (!wall) return null;
  return { x: wall.start.x + (wall.end.x - wall.start.x) * o.position, y: wall.start.y + (wall.end.y - wall.start.y) * o.position };
}

/** Tall items (120 cm and up) standing within 40 cm of a window. */
export function tallInFrontOfWindows(floor: Floor, items = floor.furniture): string[] {
  const found: string[] = [];
  for (const win of floor.windows) {
    const wall = floor.walls.find(w => w.id === win.wallId);
    if (!wall) continue;
    const len = wallLength(wall) || 1, t = win.width / 2 / len;
    const a = { x: wall.start.x + (wall.end.x - wall.start.x) * (win.position - t), y: wall.start.y + (wall.end.y - wall.start.y) * (win.position - t) };
    const b = { x: wall.start.x + (wall.end.x - wall.start.x) * (win.position + t), y: wall.start.y + (wall.end.y - wall.start.y) * (win.position + t) };
    for (const item of items) {
      if (isLayered(item) || getFurnitureSize(item).height < 120) continue;
      if (polygonGap(furnitureFootprint(item), [a, b]).distance < 40 + wall.thickness / 2) found.push(`${label(item)} stands in front of window ${win.id}`);
    }
  }
  return found;
}

/** Gaps can be tight on purpose here: chairs tuck under tables, coffee tables sit close to sofas. */
const TUCKED = /dining chair|office chair|coffee table|side table|nightstand/i;

/** check_plan's walkway check, limited to a room and without the deliberate close pairs above. */
export function narrowWalkways(floor: Floor, minimum: number, room?: RoomShape): string[] {
  const result = runCheck(floor, 'walkway', minimum);
  if (result.kind !== 'walkway') return [];
  const quads = floor.walls.filter(w => !w.curvePoint).map(w => wallQuad(w));
  const mid = (g: { from: Point; to: Point }) => ({ x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 });
  return result.gaps
    .filter(g => !TUCKED.test(g.between[0]) && !TUCKED.test(g.between[1]))
    // A gap measured through a wall (a bed and a sofa back to back across it) is no walkway.
    .filter(g => !quads.some(q => insidePolygon(mid(g), q)))
    .filter(g => !room || insidePolygon({ x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 }, room.polygon))
    .map(g => `${g.distance} cm between ${g.between[0]} and ${g.between[1]} at ${fmt({ x: (g.from.x + g.to.x) / 2, y: (g.from.y + g.to.y) / 2 })}`);
}

/** Direction an item faces: rotation 0 faces down (+y), 90 left, 180 up, 270 right. */
export function facingVector(item: FurnitureItem): Point {
  const a = (item.rotation || 0) * Math.PI / 180;
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/** Whether a faces b within maxAngle degrees. */
export function faces(a: FurnitureItem, b: FurnitureItem, maxAngle = 35): boolean {
  const f = facingVector(a), dx = b.position.x - a.position.x, dy = b.position.y - a.position.y, d = Math.hypot(dx, dy) || 1;
  return (f.x * dx + f.y * dy) / d >= Math.cos(maxAngle * Math.PI / 180);
}

/** Distance from p to the nearest wall face. */
export function wallFaceDistance(floor: Floor, p: Point): number {
  let best = Infinity;
  for (const wall of floor.walls) best = Math.min(best, segmentDistance(p, wall.start, wall.end) - wall.thickness / 2);
  return best;
}

/** The middle of the item's back edge is within tol cm of a wall face. */
export function backAgainstWall(floor: Floor, item: FurnitureItem, tol = 15): boolean {
  const f = facingVector(item), depth = getFurnitureSize(item).depth;
  const back = { x: item.position.x - f.x * depth / 2, y: item.position.y - f.y * depth / 2 };
  return wallFaceDistance(floor, back) <= tol;
}

export function gapBetween(a: FurnitureItem, b: FurnitureItem): number {
  return polygonGap(furnitureFootprint(a), furnitureFootprint(b)).distance;
}

/** Height of the item's bottom above the floor, ceiling items included. */
export function bottomOf(p: Project, floor: Floor, item: FurnitureItem): number {
  return effectiveElevation(item, createCeilingResolver(p, floor));
}

export function topOf(p: Project, floor: Floor, item: FurnitureItem): number {
  return bottomOf(p, floor, item) + getFurnitureSize(item).height;
}

const boundaryDistance = (p: Point, poly: Point[]) => Math.min(...poly.map((a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length])));

/**
 * Rooms connected through doors and openings, starting from the rooms with a
 * door to the outside. A door joins the rooms whose outline runs through its
 * centre (a long wall can border several rooms, so its wall id isn't enough).
 */
export function reachability(floor: Floor): { unreachable: string[]; exterior: number } {
  const shapes = rooms(floor);
  const links = new Map<RoomShape, Set<RoomShape>>(shapes.map(r => [r, new Set()]));
  const start = new Set<RoomShape>();
  let exterior = 0;
  for (const door of floor.doors) {
    const centre = openingCentre(floor, door);
    if (!centre) continue;
    const sides = shapes.filter(r => boundaryDistance(centre, r.polygon) < 2);
    if (sides.length === 1) { start.add(sides[0]); exterior++; }
    for (const a of sides) for (const b of sides) if (a !== b) links.get(a)!.add(b);
  }
  const seen = new Set(start), queue = [...start];
  while (queue.length) for (const next of links.get(queue.shift()!)!) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return { unreachable: shapes.filter(r => !seen.has(r)).map(r => r.name), exterior };
}

/** Everything on the floors except view state, for "nothing changed" checks. */
export function planSignature(p: Project): string {
  return JSON.stringify(p.floors.map(f => ({ walls: f.walls, rooms: f.rooms, doors: f.doors, windows: f.windows, furniture: f.furniture, stairs: f.stairs, columns: f.columns, ceilings: f.roomCeilingHeights ?? null })));
}

export function structureSignature(p: Project): string {
  return JSON.stringify(p.floors.map(f => ({ walls: f.walls, doors: f.doors, windows: f.windows })));
}

/** Numbers in a reply followed by a unit, in the unit's own scale (decimal commas allowed). */
export function numbersWithUnit(text: string, unit: RegExp): number[] {
  const out: number[] = [];
  const pattern = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:${unit.source})`, 'gi');
  for (const match of text.matchAll(pattern)) out.push(Number(match[1].replace(',', '.')));
  return out;
}

export const fmtList = (list: string[], max = 4) => list.length ? `${list.slice(0, max).join('; ')}${list.length > max ? `; … ${list.length - max} more` : ''}` : 'none';
