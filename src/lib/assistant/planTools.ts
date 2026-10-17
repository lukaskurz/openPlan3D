/**
 * The Assistant's plan tools, run in the browser against the open project.
 * Each returns compact text for the model plus the ids it touched, so the
 * plan can outline them while the change is a proposal.
 */
import { get } from 'svelte/store';
import type { Door, Floor, FurnitureItem, Point, Room, Wall, Window as Win } from '$lib/models/types';
import {
  currentProject, activeFloor, addWall, addDoor, addWindow, addFurniture, updateFurniture, updateDoor, updateWindow,
  updateWall, updateStair, updateColumn, removeElement, editActiveFloor, selectedElementIds, selectedRoomId, detectedRoomsStore,
  setActiveFloor, addFloor,
} from '$lib/stores/project';
import { projectSettings } from '$lib/stores/settings';
import { furnitureCatalog, getCatalogItem, getFurnitureSize } from '$lib/utils/furnitureCatalog';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';
import { interiorRoomArea } from '$lib/utils/interiorArea';
import { wallLength } from '$lib/utils/wallEditing';
import { catalogName, convexOverlap, insidePolygon, isLayered, nearPolygon, polygonArea, rectCorners, segmentDistance, wallQuad } from './geometry';
import { assistantTools, clampMinimum, describeResult, makeTool, runCheck, showTool, type CheckKind } from './checks';

export interface ToolOutcome {
  text: string;
  isError?: boolean;
  /** Ids added or changed, for outlining the proposal on the plan. */
  changed?: string[];
  /** Ids removed. */
  removed?: string[];
  /** A tool the assistant just made, shown as a card under its reply. */
  madeTool?: string;
  /** A picture for the model to look at (drawing tools). */
  image?: { mediaType: 'image/jpeg'; data: string };
}

class ToolInputError extends Error {}
function fail(message: string): never { throw new ToolInputError(message); }

// ── Small geometry helpers ────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = Math.round;
const fmtPoint = (p: Point) => `(${r0(p.x)},${r0(p.y)})`;
/** Parts of a→b that no straight wall already covers, so shared walls aren't drawn twice. */
function uncoveredParts(a: Point, b: Point, walls: Wall[]): [Point, Point][] {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length < 1) return [];
  const ux = dx / length, uy = dy / length;
  const covered: [number, number][] = [];
  for (const wall of walls) {
    if (wall.curvePoint) continue;
    const off = (p: Point) => (p.x - a.x) * -uy + (p.y - a.y) * ux;
    if (Math.abs(off(wall.start)) > 1 || Math.abs(off(wall.end)) > 1) continue;
    const t1 = (wall.start.x - a.x) * ux + (wall.start.y - a.y) * uy;
    const t2 = (wall.end.x - a.x) * ux + (wall.end.y - a.y) * uy;
    covered.push([Math.min(t1, t2), Math.max(t1, t2)]);
  }
  covered.sort((p, q) => p[0] - q[0]);
  const parts: [Point, Point][] = [];
  let cursor = 0;
  // Ends of the requested run stay exact so consecutive runs share corners.
  const at = (t: number) => t <= 0 ? a : t >= length ? b : { x: r1(a.x + ux * t), y: r1(a.y + uy * t) };
  for (const [from, to] of covered) {
    if (from > cursor + 1) parts.push([at(cursor), at(Math.min(from, length))]);
    cursor = Math.max(cursor, to);
    if (cursor >= length) break;
  }
  if (cursor < length - 1) parts.push([at(cursor), at(length)]);
  return parts;
}

// ── Reading the plan ──────────────────────────────────────────────────

function floorOrFail(): Floor {
  return get(activeFloor) ?? fail('No plan is open.');
}

function hashKey(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

interface PlanRoom { id: string; room: Room; polygon: Point[]; saved: boolean }

/**
 * Rooms are detected from walls. Saved rooms keep their id; detected-only rooms
 * get an id from their walls, so it stays the same between tool calls.
 */
function planRooms(floor: Floor): PlanRoom[] {
  const savedIds = new Set(floor.rooms.map(room => room.id));
  return resolveRoomGeometry(floor, get(detectedRoomsStore)).map(({ room, polygon }) => {
    const saved = savedIds.has(room.id);
    return { id: saved ? room.id : `room-${hashKey([...room.walls].sort().join(','))}`, room, polygon, saved };
  });
}

function findRoom(floor: Floor, id: string): PlanRoom | undefined {
  return planRooms(floor).find(room => room.id === id || room.room.id === id);
}

const roomAt = (rooms: PlanRoom[], p: Point) => rooms.find(room => insidePolygon(p, room.polygon));


function getPlan(): ToolOutcome {
  const project = get(currentProject) ?? fail('No plan is open.');
  const floor = floorOrFail();
  const units = get(projectSettings).units;
  const rooms = planRooms(floor);
  const selected = [...get(selectedElementIds)];
  const selectedRoom = get(selectedRoomId);
  if (selectedRoom) {
    const room = rooms.find(room => room.room.id === selectedRoom || room.id === selectedRoom);
    if (room) selected.push(room.id);
  }
  const lines: string[] = [];
  const floorIndex = project.floors.findIndex(f => f.id === floor.id);
  lines.push(`Project "${project.name}", floor "${floor.name}" (${floorIndex + 1} of ${project.floors.length}). Units the person uses: ${units}. Coordinates in cm, x right, y down.`);
  if (project.floors.length > 1) {
    lines.push('Floors:', ...project.floors.map(f => `- ${f.id} "${f.name}" level ${f.level}${f.id === floor.id ? ' (shown)' : `, ${f.walls.length} walls, ${f.furniture.length} items`}`));
  }
  lines.push(selected.length ? `Selected: ${selected.join(', ')}` : 'Nothing selected.');
  lines.push(`Rooms (${rooms.length}):`);
  for (const room of rooms) {
    const inside = interiorRoomArea(room.polygon, [], floor.walls);
    lines.push(`- ${room.id} "${room.room.name}" ${(polygonArea(room.polygon) / 10000).toFixed(1)} m² to wall centres${inside === null ? '' : `, ${inside.toFixed(2)} m² inside the walls`}, corners ${room.polygon.map(fmtPoint).join(' ')}`);
  }
  const sealed = rooms.filter(room => !floor.doors.some(door => room.room.walls.includes(door.wallId)));
  if (sealed.length && rooms.length > 1) lines.push(`No door or opening into: ${sealed.map(room => `"${room.room.name}"`).join(', ')}.`);
  lines.push(`Walls (${floor.walls.length}):`);
  for (const wall of floor.walls) {
    lines.push(`- ${wall.id} ${fmtPoint(wall.start)}→${fmtPoint(wall.end)} ${r0(wallLength(wall))} cm, ${r0(wall.thickness)} cm thick${wall.curvePoint ? `, curved, control ${fmtPoint(wall.curvePoint)}` : ''}`);
  }
  const opening = (o: Door | Win, kind: string) => {
    const wall = floor.walls.find(w => w.id === o.wallId);
    const offset = wall ? r0(o.position * wallLength(wall)) : '?';
    return `- ${o.id} ${o.type} ${kind} ${r0(o.width)} cm on ${o.wallId} at ${offset} cm from its start`;
  };
  lines.push(`Doors (${floor.doors.length}):`, ...floor.doors.map(d => opening(d, 'door')));
  lines.push(`Windows (${floor.windows.length}):`, ...floor.windows.map(w => opening(w, 'window')));
  lines.push(`Furniture (${floor.furniture.length}):`);
  for (const item of floor.furniture.slice(0, 400)) {
    const size = getFurnitureSize(item);
    const room = roomAt(rooms, item.position);
    lines.push(`- ${item.id} ${item.catalogId} "${catalogName(item)}" centre ${fmtPoint(item.position)} rot ${r0(item.rotation || 0)}° ${r0(size.width)}×${r0(size.depth)} cm${room ? ` in ${room.room.name}` : ''}`);
  }
  if (floor.furniture.length > 400) lines.push(`… and ${floor.furniture.length - 400} more items.`);
  if (floor.stairs?.length) lines.push('Stairs:', ...floor.stairs.map(s => `- ${s.id} centre ${fmtPoint(s.position)} rot ${r0(s.rotation)}° ${r0(s.width)}×${r0(s.depth)} cm`));
  if (floor.columns?.length) lines.push('Columns:', ...floor.columns.map(c => `- ${c.id} ${c.shape} ${r0(c.diameter)} cm at ${fmtPoint(c.position)}`));
  const tools = get(assistantTools);
  if (tools.length) lines.push('Tools you made earlier:', ...tools.map(t => `- ${t.id} "${t.name}" ${t.kind}, minimum ${t.minimum}`));
  return { text: lines.join('\n') };
}

/** How a catalog item is fixed, for search results: ceiling and wall mounts, or a raised floor item. */
function mountHint(item: (typeof furnitureCatalog)[number]): string {
  if (item.mount === 'ceiling') return item.defaultDrop ? `, hangs from the ceiling ${item.defaultDrop} cm down` : ', mounted on the ceiling';
  if (item.mount === 'wall') return `, wall-mounted ${item.elevation ?? 0} cm up`;
  return item.elevation ? `, hangs ${item.elevation} cm up` : '';
}

function searchCatalog(input: { query?: string; category?: string }): ToolOutcome {
  const words = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const category = input.category ? String(input.category).toLowerCase() : null;
  const hits = furnitureCatalog.filter(item => !item.symbol || words.length)
    .filter(item => !category || item.category.toLowerCase() === category)
    .filter(item => !words.length || words.some(word => `${item.id} ${item.name} ${item.category}`.toLowerCase().includes(word)));
  if (!hits.length) return { text: 'No matches. Try a broader word or a category.' };
  return { text: hits.slice(0, 40).map(item => `${item.id}: ${item.name} (${item.category}) ${item.width}×${item.depth}×${item.height}${mountHint(item)}`).join('\n') + (hits.length > 40 ? `\n… ${hits.length - 40} more, narrow the search.` : '') };
}

// ── Validation for placed items ───────────────────────────────────────

function furnitureWarnings(floor: Floor, item: FurnitureItem, rooms: PlanRoom[]): string[] {
  const warnings: string[] = [];
  const size = getFurnitureSize(item);
  const corners = rectCorners(item.position, size.width, size.depth, item.rotation || 0);
  const name = `${item.id} (${catalogName(item)})`;
  const room = roomAt(rooms, item.position);
  if (!room) warnings.push(`${name}: its centre is outside every room`);
  else if (!corners.every(c => nearPolygon(c, room.polygon, 1))) warnings.push(`${name}: sticks out of ${room.room.name}`);
  for (const wall of floor.walls) {
    if (wall.curvePoint) continue;
    if (convexOverlap(corners, wallQuad(wall, 1), 1)) { warnings.push(`${name}: overlaps wall ${wall.id}`); break; }
  }
  if (isLayered(item)) return warnings;
  for (const other of floor.furniture) {
    if (other.id === item.id || isLayered(other)) continue;
    const otherSize = getFurnitureSize(other);
    if (convexOverlap(corners, rectCorners(other.position, otherSize.width, otherSize.depth, other.rotation || 0), 3)) {
      warnings.push(`${name}: overlaps ${other.id} (${catalogName(other)})`);
    }
  }
  for (const door of floor.doors) {
    const wall = floor.walls.find(w => w.id === door.wallId);
    if (!wall || wall.curvePoint) continue;
    const len = wallLength(wall) || 1, ux = (wall.end.x - wall.start.x) / len, uy = (wall.end.y - wall.start.y) / len;
    const center = { x: wall.start.x + ux * door.position * len, y: wall.start.y + uy * door.position * len };
    const reach = Math.min(door.width, 90) + wall.thickness / 2;
    const zone = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, n]) => ({
      x: center.x + ux * s * door.width / 2 - uy * n * reach,
      y: center.y + uy * s * door.width / 2 + ux * n * reach,
    }));
    if (convexOverlap(corners, zone, 2)) warnings.push(`${name}: blocks door ${door.id}`);
  }
  return warnings;
}

// ── Editing tools ─────────────────────────────────────────────────────

function finite(value: unknown, label: string, min = -100000, max = 100000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} must be a number between ${min} and ${max}.`);
  return n;
}

function toPoint(value: unknown, label: string): Point {
  if (!Array.isArray(value) || value.length !== 2) fail(`${label} must be [x, y].`);
  const [x, y] = value as unknown[];
  return { x: finite(x, `${label} x`), y: finite(y, `${label} y`) };
}

function addWallRun(points: Point[], closed: boolean, thickness?: number, curves: Map<number, Point> = new Map()): string[] {
  const created: string[] = [];
  const edges = points.map((p, i) => [p, points[i + 1]] as const).slice(0, -1);
  if (closed && points.length > 2) edges.push([points[points.length - 1], points[0]]);
  edges.forEach(([a, b], index) => {
    const control = curves.get(index);
    if (control) {
      const id = addWall(a, b);
      editActiveFloor(floor => { const wall = floor.walls.find(w => w.id === id); if (wall) wall.curvePoint = control; });
      created.push(id);
      return;
    }
    for (const [start, end] of uncoveredParts(a, b, floorOrFail().walls)) created.push(addWall(start, end));
  });
  if (thickness !== undefined && created.length) {
    editActiveFloor(floor => { for (const wall of floor.walls) if (created.includes(wall.id)) wall.thickness = thickness; });
  }
  return created;
}

function nameRoom(room: PlanRoom, name: string) {
  editActiveFloor(floor => {
    const saved = floor.rooms.find(r => r.id === room.room.id);
    if (saved) saved.name = name;
    else floor.rooms.push({ ...room.room, id: room.id, name });
  }, 'Renamed room');
}

function addRoom(input: Record<string, unknown>): ToolOutcome {
  const name = String(input.name ?? '').trim().slice(0, 60) || fail('The room needs a name.');
  let polygon: Point[];
  if (Array.isArray(input.polygon)) polygon = input.polygon.map((p, i) => toPoint(p, `corner ${i + 1}`));
  else {
    const x = finite(input.x, 'x'), y = finite(input.y, 'y');
    const width = finite(input.width, 'width', 50, 10000), depth = finite(input.depth, 'depth', 50, 10000);
    polygon = [{ x, y }, { x: x + width, y }, { x: x + width, y: y + depth }, { x, y: y + depth }];
  }
  if (polygon.length < 3) fail('A room needs at least 3 corners.');
  const area = polygonArea(polygon);
  if (area < 5000 || area > 20_000_000) fail('A room must be between 0.5 m² and 2000 m².');
  const walls = addWallRun(polygon, true);
  const floor = floorOrFail();
  const centre = { x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length, y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length };
  const room = planRooms(floor).find(room => insidePolygon(centre, room.polygon) && Math.abs(polygonArea(room.polygon) - area) < area * 0.05);
  if (!room) return { text: `Added ${walls.length} walls, but they don't enclose a separate room (existing walls cross it). Check with get_plan.`, changed: walls };
  nameRoom(room, name);
  return { text: `Added room ${room.id} "${name}" ${(area / 10000).toFixed(1)} m²${walls.length ? ` with ${walls.length} new walls (${walls.join(', ')})` : ' using existing walls'}.`, changed: [...walls, room.id] };
}

function addWalls(input: Record<string, unknown>): ToolOutcome {
  if (!Array.isArray(input.points) || input.points.length < 2) fail('points needs at least two [x, y] points.');
  const points = (input.points as unknown[]).map((p, i) => toPoint(p, `point ${i + 1}`));
  const thickness = input.thickness === undefined ? undefined : finite(input.thickness, 'thickness', 5, 100);
  const curves = new Map<number, Point>();
  if (Array.isArray(input.curves)) for (const curve of input.curves as Record<string, unknown>[]) {
    const segment = Number(curve?.segment);
    const segments = points.length - 1 + (input.closed && points.length > 2 ? 1 : 0);
    if (!Number.isInteger(segment) || segment < 0 || segment >= segments) fail(`curves: segment must be 0 to ${segments - 1}.`);
    curves.set(segment, toPoint(curve.control, 'curve control'));
  }
  const created = addWallRun(points, !!input.closed, thickness, curves);
  return { text: created.length ? `Added walls ${created.join(', ')}.` : 'Every part of that run already has a wall.', changed: created };
}

const DOOR_TYPES: Door['type'][] = ['single', 'double', 'sliding', 'french', 'balcony', 'pocket', 'bifold', 'opening', 'garage'];
const WINDOW_TYPES: Win['type'][] = ['standard', 'fixed', 'casement', 'sliding', 'bay'];

function openingFits(floor: Floor, wall: Wall, offset: number, width: number, ignoreId?: string) {
  const length = wallLength(wall);
  if (offset - width / 2 < 5 || offset + width / 2 > length - 5) fail(`An opening ${r0(width)} cm wide at ${r0(offset)} cm doesn't fit on ${wall.id} (${r0(length)} cm long).`);
  for (const other of [...floor.doors, ...floor.windows]) {
    if (other.wallId !== wall.id || other.id === ignoreId) continue;
    if (Math.abs(other.position * length - offset) < (other.width + width) / 2) fail(`It would overlap ${other.id} on ${wall.id}.`);
  }
}

function addOpenings(input: Record<string, unknown>): ToolOutcome {
  if (!Array.isArray(input.items) || !input.items.length) fail('items needs at least one opening.');
  const lines: string[] = [], changed: string[] = [];
  for (const raw of input.items as Record<string, unknown>[]) {
    try {
      const floor = floorOrFail();
      const kind = raw.kind === 'window' ? 'window' : raw.kind === 'door' ? 'door' : fail('kind must be door or window.');
      const wall = floor.walls.find(w => w.id === raw.wallId) ?? fail(`There is no wall ${String(raw.wallId)}.`);
      const length = wallLength(wall);
      const type = (raw.type ?? (kind === 'door' ? 'single' : 'standard')) as string;
      if (kind === 'door' ? !DOOR_TYPES.includes(type as Door['type']) : !WINDOW_TYPES.includes(type as Win['type'])) fail(`Unknown ${kind} type ${type}.`);
      const width = raw.width === undefined ? undefined : finite(raw.width, 'width', 30, 600);
      const offset = raw.offset === undefined ? length / 2 : finite(raw.offset, 'offset', 0, length);
      openingFits(floor, wall, offset, width ?? (kind === 'door' ? 90 : 120));
      const id = kind === 'door' ? addDoor(wall.id, offset / length, type as Door['type']) : addWindow(wall.id, offset / length, type as Win['type']);
      if (width !== undefined) (kind === 'door' ? updateDoor : updateWindow)(id, { width });
      lines.push(`${id} ${type} ${kind} ok`);
      changed.push(id);
    } catch (error) {
      lines.push(`error: ${(error as Error).message}`);
    }
  }
  return { text: lines.join('\n'), changed, isError: !changed.length };
}

function placeFurniture(input: Record<string, unknown>): ToolOutcome {
  if (!Array.isArray(input.items) || !input.items.length) fail('items needs at least one item.');
  if (input.items.length > 60) fail('Place at most 60 items per call.');
  const lines: string[] = [], changed: string[] = [];
  for (const raw of input.items as Record<string, unknown>[]) {
    try {
      const catalogId = String(raw.catalogId ?? '');
      if (!getCatalogItem(catalogId)) fail(`Unknown catalogId ${catalogId}. Use search_catalog.`);
      const position = { x: finite(raw.x, 'x'), y: finite(raw.y, 'y') };
      const rotation = raw.rotation === undefined ? 0 : ((finite(raw.rotation, 'rotation', -3600, 3600) % 360) + 360) % 360;
      const updates: Partial<FurnitureItem> = { rotation };
      if (raw.width !== undefined) updates.width = finite(raw.width, 'width', 5, 2000);
      if (raw.depth !== undefined) updates.depth = finite(raw.depth, 'depth', 5, 2000);
      const id = addFurniture(catalogId, position);
      updateFurniture(id, updates);
      lines.push(`${id} ${catalogId} ok`);
      changed.push(id);
    } catch (error) {
      lines.push(`error: ${(error as Error).message}`);
    }
  }
  const floor = floorOrFail(), rooms = planRooms(floor);
  for (const id of changed) {
    const item = floor.furniture.find(item => item.id === id);
    if (item) lines.push(...furnitureWarnings(floor, item, rooms).map(w => `warning: ${w}`));
  }
  return { text: lines.join('\n'), changed, isError: !changed.length };
}

/** Shift a wall; walls that end on it follow, so corners stay closed. */
function shiftWall(wallId: string, dx: number, dy: number) {
  editActiveFloor(floor => {
    const wall = floor.walls.find(w => w.id === wallId);
    if (!wall) return;
    const { start, end } = wall;
    for (const other of floor.walls) {
      if (other.id === wallId) continue;
      for (const key of ['start', 'end'] as const) {
        if (segmentDistance(other[key], start, end) < 1) other[key] = { x: other[key].x + dx, y: other[key].y + dy };
      }
    }
    wall.start = { x: start.x + dx, y: start.y + dy };
    wall.end = { x: end.x + dx, y: end.y + dy };
    if (wall.curvePoint) wall.curvePoint = { x: wall.curvePoint.x + dx, y: wall.curvePoint.y + dy };
  }, 'Moved wall');
}

function updateElements(input: Record<string, unknown>): ToolOutcome {
  if (!Array.isArray(input.updates) || !input.updates.length) fail('updates needs at least one change.');
  const lines: string[] = [], changed: string[] = [], movedFurniture: string[] = [];
  for (const raw of input.updates as Record<string, unknown>[]) {
    try {
      const floor = floorOrFail();
      const id = String(raw.id ?? '');
      const furniture = floor.furniture.find(item => item.id === id);
      const stair = floor.stairs?.find(item => item.id === id);
      const column = floor.columns?.find(item => item.id === id);
      const door = floor.doors.find(item => item.id === id);
      const window = floor.windows.find(item => item.id === id);
      const wall = floor.walls.find(item => item.id === id);
      const position = (current: Point) => ({ x: raw.x === undefined ? current.x : finite(raw.x, 'x'), y: raw.y === undefined ? current.y : finite(raw.y, 'y') });
      const rotation = (current: number) => raw.rotation === undefined ? current : ((finite(raw.rotation, 'rotation', -3600, 3600) % 360) + 360) % 360;
      if (furniture) {
        const updates: Partial<FurnitureItem> = { position: position(furniture.position), rotation: rotation(furniture.rotation || 0) };
        if (raw.width !== undefined) updates.width = finite(raw.width, 'width', 5, 2000) / Math.abs(furniture.scale?.x ?? 1);
        if (raw.depth !== undefined) updates.depth = finite(raw.depth, 'depth', 5, 2000) / Math.abs(furniture.scale?.y ?? 1);
        updateFurniture(id, updates);
        movedFurniture.push(id);
      } else if (stair) {
        updateStair(id, { position: position(stair.position), rotation: rotation(stair.rotation),
          ...(raw.width !== undefined ? { width: finite(raw.width, 'width', 40, 1000) } : {}),
          ...(raw.depth !== undefined ? { depth: finite(raw.depth, 'depth', 40, 2000) } : {}) });
      } else if (column) {
        updateColumn(id, { position: position(column.position), rotation: rotation(column.rotation) });
      } else if (door || window) {
        const opening = (door ?? window)!;
        const host = floor.walls.find(w => w.id === opening.wallId) ?? fail(`${id} has no wall.`);
        const length = wallLength(host);
        const width = raw.width === undefined ? opening.width : finite(raw.width, 'width', 30, 600);
        const offset = raw.offset === undefined ? opening.position * length : finite(raw.offset, 'offset', 0, length);
        openingFits(floor, host, offset, width, id);
        const updates: Partial<Door & Win> = { width, position: offset / length };
        if (raw.type !== undefined) {
          const type = String(raw.type);
          if (door ? !DOOR_TYPES.includes(type as Door['type']) : !WINDOW_TYPES.includes(type as Win['type'])) fail(`Unknown type ${type}.`);
          updates.type = type as never;
        }
        if (door) updateDoor(id, updates as Partial<Door>); else updateWindow(id, updates as Partial<Win>);
      } else if (wall) {
        const dx = raw.dx === undefined ? 0 : finite(raw.dx, 'dx', -5000, 5000), dy = raw.dy === undefined ? 0 : finite(raw.dy, 'dy', -5000, 5000);
        if (dx || dy) shiftWall(id, dx, dy);
        if (raw.thickness !== undefined) updateWall(id, { thickness: finite(raw.thickness, 'thickness', 5, 100) });
        if (raw.straighten === true) updateWall(id, { curvePoint: undefined });
        else if (raw.curve !== undefined) updateWall(id, { curvePoint: toPoint(raw.curve, 'curve') });
      } else {
        const room = findRoom(floor, id) ?? fail(`There is no element ${id}.`);
        const name = String(raw.name ?? '').trim().slice(0, 60) || fail('Rooms can only be renamed; give a name.');
        nameRoom(room, name);
      }
      lines.push(`${id} ok`);
      changed.push(id);
    } catch (error) {
      lines.push(`error: ${(error as Error).message}`);
    }
  }
  const floor = floorOrFail(), rooms = planRooms(floor);
  for (const id of movedFurniture) {
    const item = floor.furniture.find(item => item.id === id);
    if (item) lines.push(...furnitureWarnings(floor, item, rooms).map(w => `warning: ${w}`));
  }
  return { text: lines.join('\n'), changed, isError: !changed.length };
}

function deleteElements(input: Record<string, unknown>): ToolOutcome {
  if (!Array.isArray(input.ids) || !input.ids.length) fail('ids needs at least one id.');
  const lines: string[] = [], removed: string[] = [];
  for (const raw of input.ids as unknown[]) {
    const id = String(raw);
    const floor = floorOrFail();
    const known = [floor.walls, floor.doors, floor.windows, floor.furniture, floor.stairs ?? [], floor.columns ?? []].some(list => list.some(item => item.id === id));
    if (known) { removeElement(id); removed.push(id); lines.push(`${id} deleted`); continue; }
    const rooms = planRooms(floor);
    const room = rooms.find(room => room.id === id || room.room.id === id);
    if (!room) { lines.push(`error: there is no element ${id}`); continue; }
    const shared = new Set(rooms.filter(other => other !== room).flatMap(other => other.room.walls));
    for (const wallId of room.room.walls) if (!shared.has(wallId)) { removeElement(wallId); removed.push(wallId); }
    editActiveFloor(f => { f.rooms = f.rooms.filter(r => r.id !== room.room.id); }, 'Deleted room');
    removed.push(id);
    lines.push(`${id} deleted with its own walls`);
  }
  return { text: lines.join('\n'), removed, isError: !removed.length };
}

// ── Floors and checks ─────────────────────────────────────────────────

function switchFloor(input: Record<string, unknown>): ToolOutcome {
  const project = get(currentProject) ?? fail('No plan is open.');
  const wanted = String(input.floor ?? '').trim().toLowerCase();
  const floor = project.floors.find(f => f.id.toLowerCase() === wanted) ?? project.floors.find(f => f.name.toLowerCase() === wanted)
    ?? fail(`There is no floor ${String(input.floor)}. Floors: ${project.floors.map(f => `"${f.name}"`).join(', ')}.`);
  setActiveFloor(floor.id);
  return { text: `Now showing "${floor.name}".\n${getPlan().text}` };
}

function addFloorTool(input: Record<string, unknown>): ToolOutcome {
  const start = input.start === 'empty' || input.start === 'copy' ? input.start : 'outer';
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 40) : undefined;
  addFloor(name, start);
  const floor = floorOrFail();
  return { text: `Added and switched to floor ${floor.id} "${floor.name}" with ${floor.walls.length} walls.`, changed: floor.walls.map(w => w.id) };
}

const checkKind = (value: unknown): CheckKind => value === 'walkway' || value === 'room_size' ? value : fail('kind must be walkway or room_size.');

function checkPlan(input: Record<string, unknown>): ToolOutcome {
  const kind = checkKind(input.kind);
  const minimum = clampMinimum(kind, input.minimum);
  return { text: describeResult(runCheck(floorOrFail(), kind, minimum), minimum) };
}

function makeToolTool(input: Record<string, unknown>): ToolOutcome {
  const kind = checkKind(input.kind);
  const tool = makeTool(kind, String(input.name ?? ''), String(input.description ?? ''), input.minimum === undefined ? undefined : Number(input.minimum));
  const result = describeResult(runCheck(floorOrFail(), kind, tool.minimum), tool.minimum);
  return { text: `Made tool ${tool.id} "${tool.name}" (${kind}, minimum ${tool.minimum}). The person sees a card to try it. On this floor now: ${result}`, madeTool: tool.id };
}

function showToolTool(input: Record<string, unknown>): ToolOutcome {
  const tool = get(assistantTools).find(t => t.id === input.id || t.name.toLowerCase() === String(input.id ?? '').toLowerCase())
    ?? fail(`There is no tool ${String(input.id)}.`);
  showTool(tool, input.minimum === undefined ? undefined : Number(input.minimum));
  return { text: `"${tool.name}" is on. ${describeResult(runCheck(floorOrFail(), tool.kind, clampMinimum(tool.kind, input.minimum ?? tool.minimum)), clampMinimum(tool.kind, input.minimum ?? tool.minimum))}` };
}

const HANDLERS: Record<string, (input: Record<string, unknown>) => ToolOutcome> = {
  switch_floor: switchFloor,
  add_floor: addFloorTool,
  check_plan: checkPlan,
  make_tool: makeToolTool,
  show_tool: showToolTool,
  get_plan: getPlan,
  search_catalog: searchCatalog,
  add_room: addRoom,
  add_walls: addWalls,
  add_openings: addOpenings,
  place_furniture: placeFurniture,
  update_elements: updateElements,
  delete_elements: deleteElements,
};

export function runPlanTool(name: string, input: unknown): ToolOutcome {
  const handler = HANDLERS[name];
  if (!handler) return { text: `Unknown tool ${name}.`, isError: true };
  try {
    return handler(input && typeof input === 'object' ? input as Record<string, unknown> : {});
  } catch (error) {
    if (error instanceof ToolInputError) return { text: `error: ${error.message}`, isError: true };
    console.error('assistant tool failed', name, error);
    return { text: `error: the tool failed (${(error as Error)?.message ?? 'unknown'}).`, isError: true };
  }
}
