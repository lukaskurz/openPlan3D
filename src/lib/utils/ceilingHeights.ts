import type { Floor, Point, Project, Room } from '$lib/models/types';
import { getWallEndHeight, getWallStartHeight } from '$lib/models/types';
import { DEFAULT_FLOOR_SPACING, floorElevations } from './floors';
import { roomCeilingHeight } from './wallProfiles';
import { resolveRoomGeometry } from './roomDetection';
import { furnitureMount } from './mounting';
import { furnitureTrade } from './furnitureCatalog';

/**
 * Ceiling heights (spec §4.4). Pure: pass the project and floor in.
 *
 * A room's ceiling, in order of precedence:
 *  1. the override in `floor.roomCeilingHeights[room.id]` (set with setRoomCeilingHeight; a dropped ceiling),
 *  2. the legacy room metadata `room.details.ceilingHeight` (native package, older files),
 *  3. the height of its boundary walls when they are all the same,
 *  4. the tallest boundary wall (sloped or mixed walls),
 *  5. the storey: the spacing to the floor above minus that floor's slab.
 * Points outside every room use the floor default (`floorDefaultCeiling`).
 */

/** Slab depth assumed when a floor names none, in cm (matches Floor.slabThickness). */
export const DEFAULT_SLAB_THICKNESS = 5;
/** Highest ceiling height accepted anywhere, in cm. */
export const MAX_CEILING_HEIGHT = 100_000;

/** A finite height in (0, MAX_CEILING_HEIGHT]. */
export function validCeilingHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_CEILING_HEIGHT;
}

/** A room and its outline, as resolveRoomGeometry returns them. */
export interface RoomOutline { room: Room; polygon: Point[] }

/** Ceiling of the storey: the floor above's surface minus its slab, else the default spacing minus a 5 cm slab. */
export function storeyCeiling(project: Pick<Project, 'floors'>, floor: Floor): number {
  const fallback = DEFAULT_FLOOR_SPACING - DEFAULT_SLAB_THICKNESS;
  const entries = floorElevations(project.floors);
  const index = entries.findIndex(entry => entry.floor.id === floor.id);
  if (index < 0) return fallback;
  const here = entries[index].elevation;
  const above = entries.slice(index + 1).find(entry => entry.elevation > here);
  if (!above) return fallback;
  const height = above.elevation - here - (above.floor.slabThickness ?? DEFAULT_SLAB_THICKNESS);
  return validCeilingHeight(height) ? height : fallback;
}

const wallTop = (wall: Floor['walls'][number]) => Math.max(getWallStartHeight(wall), getWallEndHeight(wall));

/**
 * Ceiling for points outside every room: the most common wall height on the floor
 * (ties keep the first wall), so a light hangs at the top of the walls drawn around
 * it; with no walls, the storey ceiling.
 */
export function floorDefaultCeiling(project: Pick<Project, 'floors'>, floor: Floor): number {
  const counts = new Map<number, number>();
  let common: number | undefined, best = 0;
  for (const wall of floor.walls) {
    const height = wallTop(wall);
    if (!validCeilingHeight(height)) continue;
    const count = (counts.get(height) ?? 0) + 1;
    counts.set(height, count);
    if (count > best) { best = count; common = height; }
  }
  return common ?? storeyCeiling(project, floor);
}

/** The override stored for this room id, if any. */
export function roomCeilingOverride(floor: Pick<Floor, 'roomCeilingHeights'>, roomId: string): number | undefined {
  const value = floor.roomCeilingHeights?.[roomId];
  return validCeilingHeight(value) ? value : undefined;
}

/** The room's effective ceiling height in cm (see the precedence above). */
export function effectiveRoomCeiling(project: Pick<Project, 'floors'>, floor: Floor, room: Pick<Room, 'id' | 'walls' | 'details'>): number {
  const override = roomCeilingOverride(floor, room.id);
  if (override !== undefined) return override;
  const legacy = room.details?.ceilingHeight;
  if (validCeilingHeight(legacy)) return legacy;
  const uniform = roomCeilingHeight(room.walls, floor.walls);
  if (uniform !== undefined && validCeilingHeight(uniform)) return uniform;
  const ids = new Set(room.walls);
  const tallest = Math.max(0, ...floor.walls.filter(wall => ids.has(wall.id)).map(wallTop));
  if (validCeilingHeight(tallest)) return tallest;
  return storeyCeiling(project, floor);
}

function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > p.y) !== (poly[j].y > p.y) &&
        p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
  }
  return inside;
}

function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) sum += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(sum / 2);
}

/**
 * A function giving the ceiling height (cm) above any plan point of this floor:
 * the smallest room whose outline contains the point (so a closet inside a hall
 * wins), else the floor default. Pass `rooms` when they are already resolved
 * (e.g. the 3D build's resolveRoomGeometry result) to skip room detection.
 * The resolver is a snapshot: build a new one after the floor changes.
 */
export function createCeilingResolver(project: Pick<Project, 'floors'>, floor: Floor, rooms?: readonly RoomOutline[]): (p: Point) => number {
  const outlines = (rooms ?? resolveRoomGeometry(floor))
    .filter(({ polygon }) => polygon.length >= 3)
    .map(({ room, polygon }) => ({ polygon, area: polygonArea(polygon), ceiling: effectiveRoomCeiling(project, floor, room) }))
    .sort((a, b) => a.area - b.area);
  const fallback = floorDefaultCeiling(project, floor);
  return (p: Point) => outlines.find(outline => pointInPolygon(p, outline.polygon))?.ceiling ?? fallback;
}

/** Status line for the ceiling surface: ceiling-mounted electrical items, and the lowest and highest room ceiling (cm). */
export interface CeilingSummary { lights: number; min: number; max: number }

/**
 * Summary of a floor's ceiling: `lights` counts ceiling-mounted electrical items
 * (lights, fans, smoke detectors…); `min`/`max` span the rooms' effective ceilings,
 * or both are the floor default when there are no rooms.
 */
export function ceilingSummary(project: Pick<Project, 'floors'>, floor: Floor, rooms?: readonly RoomOutline[]): CeilingSummary {
  const lights = floor.furniture.filter(item => furnitureMount(item) === 'ceiling' && furnitureTrade(item) === 'electrical').length;
  const heights = (rooms ?? resolveRoomGeometry(floor))
    .filter(({ polygon }) => polygon.length >= 3)
    .map(({ room }) => effectiveRoomCeiling(project, floor, room));
  if (!heights.length) {
    const fallback = floorDefaultCeiling(project, floor);
    return { lights, min: fallback, max: fallback };
  }
  return { lights, min: Math.min(...heights), max: Math.max(...heights) };
}
