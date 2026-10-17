import type { FurnitureItem, Point, Wall } from '$lib/models/types';
import { getFurnitureSize } from './furnitureCatalog';
import { openingDropTarget } from './openingDrop';

/**
 * Wall-mounted items (outlets, switches, sconces; spec §4.2) are hosted like doors and
 * windows: a wall, a position along it (0..1) and the side their face points to. Their
 * plan `position` and `rotation` are derived from that host so hit tests, bounds and
 * exports, which read the stored pose, keep working. Pure helpers.
 */

/** Where a wall item hangs: its wall, the position along it and the side it faces (1 = the wall's left normal). */
export interface WallHost { wallId: string; wallPosition: number; wallSide: 1 | -1 }

function pointAt(wall: Wall, t: number): Point {
  const c = wall.curvePoint;
  if (c) {
    const mt = 1 - t;
    return {
      x: mt * mt * wall.start.x + 2 * mt * t * c.x + t * t * wall.end.x,
      y: mt * mt * wall.start.y + 2 * mt * t * c.y + t * t * wall.end.y,
    };
  }
  return { x: wall.start.x + (wall.end.x - wall.start.x) * t, y: wall.start.y + (wall.end.y - wall.start.y) * t };
}

function tangentAt(wall: Wall, t: number): Point {
  const c = wall.curvePoint;
  const dx = c ? 2 * (1 - t) * (c.x - wall.start.x) + 2 * t * (wall.end.x - c.x) : wall.end.x - wall.start.x;
  const dy = c ? 2 * (1 - t) * (c.y - wall.start.y) + 2 * t * (wall.end.y - c.y) : wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** The side of the wall a point is on at parameter t: 1 on the left normal (−ty, tx), −1 on the other side. */
export function wallSideAt(wall: Wall, t: number, point: Point): 1 | -1 {
  const p = pointAt(wall, t), tan = tangentAt(wall, t);
  return (point.x - p.x) * -tan.y + (point.y - p.y) * tan.x >= 0 ? 1 : -1;
}

/**
 * The wall host for a point: the nearest wall within `radius` cm (the opening drop rule,
 * which keeps clear of the last 5 % at each end), and the side the point is on.
 */
export function wallHostAt(point: Point, walls: Wall[], radius = 100): WallHost | null {
  const target = openingDropTarget(point, walls, radius);
  const wall = target && walls.find(w => w.id === target.wallId);
  if (!target || !wall) return null;
  return { wallId: wall.id, wallPosition: target.position, wallSide: wallSideAt(wall, target.position, point) };
}

type Sized = Pick<FurnitureItem, 'catalogId' | 'scale'> & Partial<Pick<FurnitureItem, 'width' | 'depth' | 'height'>>;

/**
 * Plan pose of an item hosted on a wall: centred at the host position, its back against
 * the wall face on its side (offset by half the wall's thickness plus half its depth),
 * and turned to face away from the wall (the wall's angle, plus 180° on side −1), the
 * same convention as snapping furniture to walls.
 */
export function hostedPose(wall: Wall, item: Sized, host: Pick<WallHost, 'wallPosition' | 'wallSide'>): { position: Point; rotation: number } {
  const t = Math.max(0, Math.min(1, host.wallPosition));
  const side = host.wallSide === -1 ? -1 : 1;
  const p = pointAt(wall, t), tan = tangentAt(wall, t);
  const depth = getFurnitureSize({ id: '', position: p, rotation: 0, ...item } as FurnitureItem).depth;
  const offset = side * (wall.thickness / 2 + depth / 2);
  const angle = Math.atan2(tan.y, tan.x) * 180 / Math.PI + (side === -1 ? 180 : 0);
  return {
    position: { x: p.x - tan.y * offset, y: p.y + tan.x * offset },
    rotation: ((angle % 360) + 360) % 360,
  };
}
