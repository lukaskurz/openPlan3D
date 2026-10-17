import { getWallEndHeight, getWallStartHeight, type Floor, type Point } from '$lib/models/types';
import { pathOpening, wallPathProfile } from './wallProfiles';

/** A solid stretch of wall in plan coordinates; `reach` is half its thickness. */
export interface WalkBarrier { a: Point; b: Point; reach: number }

export interface WalkPosition { x: number; z: number }

/** Half the walker's width, so shoulders stop before the wall face. */
export const WALKER_RADIUS = 20;

/** Wall pieces a walker cannot pass, with gaps where doors are. */
export function walkBarriers(floor: Floor, minThickness = 15): WalkBarrier[] {
  const barriers: WalkBarrier[] = [];
  for (const wall of floor.walls) {
    if (Math.max(getWallStartHeight(wall), getWallEndHeight(wall)) <= 0) continue;
    const path = wallPathProfile(wall);
    if (!(path.length > 0)) continue;
    const reach = Math.max(wall.thickness, minThickness) / 2;
    const gaps = floor.doors.filter(door => door.wallId === wall.id)
      .map(door => pathOpening(path, path.distanceAt(door.position), door.width, 0, door.height ?? 210))
      .filter(opening => opening !== null)
      .sort((p, q) => p.left - q.left);
    for (const span of path.spans) {
      if (!(span.length > 0)) continue;
      const at = (distance: number): Point => {
        const t = (distance - span.from) / span.length;
        return { x: span.start.x + (span.end.x - span.start.x) * t, y: span.start.y + (span.end.y - span.start.y) * t };
      };
      let cursor = span.from;
      for (const gap of gaps) {
        if (gap.right <= cursor || gap.left >= span.to) continue;
        if (gap.left > cursor) barriers.push({ a: at(cursor), b: at(gap.left), reach });
        cursor = Math.max(cursor, gap.right);
      }
      if (cursor < span.to) barriers.push({ a: at(cursor), b: at(span.to), reach });
    }
  }
  return barriers;
}

/** Where a step from `from` to `to` ends when walls push the walker back out,
 * letting it slide along them. Steps must be shorter than wall reach + radius. */
export function resolveWalk(from: WalkPosition, to: WalkPosition, barriers: WalkBarrier[], radius = WALKER_RADIUS): WalkPosition {
  let x = to.x, z = to.z;
  // A few passes settle corners where two walls push against each other.
  for (let pass = 0; pass < 4; pass++) {
    let pushed = false;
    for (const { a, b, reach } of barriers) {
      const ex = b.x - a.x, ez = b.y - a.y;
      const lengthSq = ex * ex + ez * ez;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.y) * ez) / lengthSq)) : 0;
      const cx = a.x + ex * t, cz = a.y + ez * t;
      const min = reach + radius;
      let dx = x - cx, dz = z - cz;
      const distance = Math.hypot(dx, dz);
      if (distance >= min) continue;
      if (distance > 1e-6) {
        dx /= distance; dz /= distance;
      } else {
        // Exactly on the centre line: back out on the side the step came from.
        const length = Math.sqrt(lengthSq) || 1;
        dx = -ez / length; dz = ex / length;
        if ((from.x - cx) * dx + (from.z - cz) * dz < 0) { dx = -dx; dz = -dz; }
      }
      x = cx + dx * min;
      z = cz + dz * min;
      pushed = true;
    }
    if (!pushed) break;
  }
  return { x, z };
}
