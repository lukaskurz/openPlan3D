import type { Point, Wall } from '$lib/models/types';

export type WallEndpoint = 'start' | 'end';
export const WALL_JOIN_TOLERANCE = 2; // cm; same joined-corner rule as pointer dragging
export const MIN_WALL_LENGTH = 1; // cm

export function wallLength(wall: Wall): number {
  if (!wall.curvePoint) return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  let length = 0, previous = wall.start;
  for (let i = 1; i <= 20; i++) {
    const t = i / 20, u = 1 - t;
    const point = { x: u * u * wall.start.x + 2 * u * t * wall.curvePoint.x + t * t * wall.end.x,
      y: u * u * wall.start.y + 2 * u * t * wall.curvePoint.y + t * t * wall.end.y };
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

export function connectedWallEndpoints(walls: Wall[], point: Point, excludeWallId: string): { wallId: string; endpoint: WallEndpoint }[] {
  const results: { wallId: string; endpoint: WallEndpoint }[] = [];
  for (const wall of walls) {
    if (wall.id === excludeWallId) continue;
    for (const endpoint of ['start', 'end'] as const) {
      if (Math.hypot(wall[endpoint].x - point.x, wall[endpoint].y - point.y) < WALL_JOIN_TOLERANCE) {
        results.push({ wallId: wall.id, endpoint });
      }
    }
  }
  return results;
}

export function finitePoint(point: unknown): point is Point {
  return !!point && typeof point === 'object' && 'x' in point && 'y' in point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Plan all corner updates first, so a rejected resize cannot partly modify the floor. */
export function planWallResize(walls: Wall[], id: string, length: number, fixed: WallEndpoint = 'start'): Map<string, Partial<Wall>> {
  if (!Number.isFinite(length) || length < MIN_WALL_LENGTH) throw new Error('Wall length must be at least 1 cm.');
  if (fixed !== 'start' && fixed !== 'end') throw new Error('Choose a fixed wall endpoint.');
  const wall = walls.find(w => w.id === id);
  if (!wall) throw new Error('Select a wall to resize.');
  const currentLength = wallLength(wall);
  if (!Number.isFinite(currentLength) || currentLength < MIN_WALL_LENGTH) throw new Error('This wall is too short to resize. Move its endpoint first.');
  const changes = new Map<string, Partial<Wall>>();
  if (Math.abs(length - currentLength) < 1e-6) return changes;
  const moving: WallEndpoint = fixed === 'start' ? 'end' : 'start';
  const origin = wall[fixed], scale = length / currentLength;
  const transform = (p: Point): Point => ({ x: origin.x + (p.x - origin.x) * scale, y: origin.y + (p.y - origin.y) * scale });
  const target = transform(wall[moving]);
  changes.set(id, { [moving]: target, ...(wall.curvePoint ? { curvePoint: transform(wall.curvePoint) } : {}) });
  for (const connection of connectedWallEndpoints(walls, wall[moving], id)) {
    changes.set(connection.wallId, { ...changes.get(connection.wallId), [connection.endpoint]: { ...target } });
  }
  for (const [wallId, updates] of changes) {
    const changed = { ...walls.find(w => w.id === wallId)!, ...updates };
    if (!finitePoint(changed.start) || !finitePoint(changed.end) || (changed.curvePoint && !finitePoint(changed.curvePoint)) || !Number.isFinite(wallLength(changed))) {
      throw new Error('This length would create invalid wall coordinates.');
    }
    if (Math.hypot(changed.end.x - changed.start.x, changed.end.y - changed.start.y) < MIN_WALL_LENGTH) {
      throw new Error('This length would collapse a joined wall. Choose another length or fixed endpoint.');
    }
  }
  return changes;
}

/** Line angle in degrees, counter-clockwise from the +X axis with plan Y pointing up, in [0, 180). */
export function wallAngle(wall: Wall): number {
  const degrees = -Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x) * 180 / Math.PI;
  const normalized = ((degrees % 180) + 180) % 180;
  return normalized >= 180 - 1e-9 ? 0 : normalized;
}

/** Degrees between a wall and the nearest horizontal/vertical axis. */
export function wallSkew(wall: Wall): number {
  const angle = wallAngle(wall) % 90;
  return Math.min(angle, 90 - angle);
}

export function planChecked(walls: Wall[], changes: Map<string, Partial<Wall>>, message: string) {
  for (const [wallId, updates] of changes) {
    const original = walls.find(w => w.id === wallId)!;
    const changed = { ...original, ...updates };
    if (!finitePoint(changed.start) || !finitePoint(changed.end) || (changed.curvePoint && !finitePoint(changed.curvePoint)) || !Number.isFinite(wallLength(changed))) {
      throw new Error('This change would create invalid wall coordinates.');
    }
    const before = Math.hypot(original.end.x - original.start.x, original.end.y - original.start.y);
    if (before >= MIN_WALL_LENGTH && Math.hypot(changed.end.x - changed.start.x, changed.end.y - changed.start.y) < MIN_WALL_LENGTH) {
      throw new Error(message);
    }
  }
  return changes;
}

/**
 * Rotate a wall about its fixed endpoint to a line angle (see wallAngle).
 * With a single joined neighbour at the moving corner, the corner slides along
 * that neighbour so the neighbour keeps its own angle; otherwise the length is kept.
 */
export function planWallAngle(walls: Wall[], id: string, angle: number, fixed: WallEndpoint = 'start'): Map<string, Partial<Wall>> {
  if (!Number.isFinite(angle)) throw new Error('Enter an angle in degrees.');
  if (fixed !== 'start' && fixed !== 'end') throw new Error('Choose a fixed wall endpoint.');
  const wall = walls.find(w => w.id === id);
  if (!wall) throw new Error('Select a wall to rotate.');
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (length < MIN_WALL_LENGTH) throw new Error('This wall is too short to rotate. Move its endpoint first.');
  const changes = new Map<string, Partial<Wall>>();
  const moving: WallEndpoint = fixed === 'start' ? 'end' : 'start';
  const origin = wall[fixed], current = { x: wall[moving].x - origin.x, y: wall[moving].y - origin.y };
  const radians = angle * Math.PI / 180;
  let u = { x: Math.cos(radians), y: -Math.sin(radians) };
  // A line angle has two directions; keep the one closest to the wall's current direction.
  if (u.x * current.x + u.y * current.y < 0) u = { x: -u.x, y: -u.y };
  if (Math.abs(u.x * current.y - u.y * current.x) / length < 1e-9) return changes;

  let target = { x: origin.x + u.x * length, y: origin.y + u.y * length };
  const neighbours = connectedWallEndpoints(walls, wall[moving], id);
  if (!wall.curvePoint && neighbours.length === 1) {
    const neighbour = walls.find(w => w.id === neighbours[0].wallId)!;
    const anchor = neighbour[neighbours[0].endpoint === 'start' ? 'end' : 'start'];
    const v = { x: wall[moving].x - anchor.x, y: wall[moving].y - anchor.y };
    const vLength = Math.hypot(v.x, v.y);
    const cross = u.x * v.y - u.y * v.x;
    // Slide along the neighbour unless it is (nearly) parallel to the new direction.
    if (!neighbour.curvePoint && vLength >= MIN_WALL_LENGTH && Math.abs(cross) / vLength > Math.sin(10 * Math.PI / 180)) {
      const t = ((anchor.x - origin.x) * v.y - (anchor.y - origin.y) * v.x) / cross;
      if (t >= MIN_WALL_LENGTH) target = { x: origin.x + u.x * t, y: origin.y + u.y * t };
    }
  }
  const rotation = Math.atan2(target.y - origin.y, target.x - origin.x) - Math.atan2(current.y, current.x);
  const scale = Math.hypot(target.x - origin.x, target.y - origin.y) / length;
  const transform = (p: Point): Point => {
    const dx = p.x - origin.x, dy = p.y - origin.y, c = Math.cos(rotation) * scale, s = Math.sin(rotation) * scale;
    return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
  };
  changes.set(id, { [moving]: target, ...(wall.curvePoint ? { curvePoint: transform(wall.curvePoint) } : {}) });
  for (const connection of neighbours) {
    changes.set(connection.wallId, { ...changes.get(connection.wallId), [connection.endpoint]: { ...target } });
  }
  return planChecked(walls, changes, 'This angle would collapse a joined wall. Choose another angle or fixed endpoint.');
}

/**
 * Snap every straight wall within `tolerance` degrees of horizontal/vertical onto the axis.
 * Joined corners move together: collinear chains share one coordinate (length-weighted),
 * so neighbouring walls stay connected and other walls follow their corners.
 */
export function planStraightenWalls(walls: Wall[], tolerance = 5): Map<string, Partial<Wall>> {
  const keys: string[] = [], points: Point[] = [];
  const index = new Map<string, number>();
  for (const wall of walls) for (const endpoint of ['start', 'end'] as const) {
    index.set(`${wall.id}:${endpoint}`, keys.length); keys.push(`${wall.id}:${endpoint}`); points.push(wall[endpoint]);
  }
  const makeSets = () => keys.map((_, i) => i);
  const find = (parent: number[], i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const union = (parent: number[], a: number, b: number) => { parent[find(parent, a)] = find(parent, b); };

  const corners = makeSets();
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < WALL_JOIN_TOLERANCE) union(corners, i, j);
  }
  const lines = { x: makeSets(), y: makeSets() }; // x: shared X (vertical walls), y: shared Y (horizontal walls)
  const members = { x: [] as Wall[], y: [] as Wall[] };
  for (const wall of walls) {
    if (wall.curvePoint || Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) < MIN_WALL_LENGTH || wallSkew(wall) > tolerance) continue;
    const angle = wallAngle(wall), axis = angle < 45 || angle > 135 ? 'y' : 'x';
    const a = find(corners, index.get(`${wall.id}:start`)!), b = find(corners, index.get(`${wall.id}:end`)!);
    if (a === b) continue;
    union(lines[axis], a, b); members[axis].push(wall);
  }
  type Sum = { sum: number; weight: number; anchorSum: number; anchorWeight: number };
  const sums = { x: new Map<number, Sum>(), y: new Map<number, Sum>() };
  for (const axis of ['x', 'y'] as const) for (const wall of members[axis]) {
    const group = find(lines[axis], find(corners, index.get(`${wall.id}:start`)!));
    const weight = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y), mid = (wall.start[axis] + wall.end[axis]) / 2;
    const entry = sums[axis].get(group) ?? { sum: 0, weight: 0, anchorSum: 0, anchorWeight: 0 };
    entry.sum += weight * mid; entry.weight += weight;
    // Walls that are already square anchor their line, so only the skewed walls move.
    if (wallSkew(wall) < 0.05) { entry.anchorSum += weight * mid; entry.anchorWeight += weight; }
    sums[axis].set(group, entry);
  }
  const targets = { x: new Map<number, number>(), y: new Map<number, number>() };
  for (const axis of ['x', 'y'] as const) for (const [group, entry] of sums[axis]) {
    targets[axis].set(group, entry.anchorWeight ? entry.anchorSum / entry.anchorWeight : entry.sum / entry.weight);
  }
  const changes = new Map<string, Partial<Wall>>();
  for (const wall of walls) {
    const updates: Partial<Wall> = {};
    for (const endpoint of ['start', 'end'] as const) {
      const corner = find(corners, index.get(`${wall.id}:${endpoint}`)!);
      const point = { ...wall[endpoint] };
      for (const axis of ['x', 'y'] as const) {
        const target = targets[axis].get(find(lines[axis], corner));
        if (target !== undefined) point[axis] = target;
      }
      if (point.x !== wall[endpoint].x || point.y !== wall[endpoint].y) updates[endpoint] = point;
    }
    if (Object.keys(updates).length) changes.set(wall.id, updates);
  }
  return planChecked(walls, changes, 'Straightening would collapse a short wall. Adjust it manually first.');
}

export function validPositiveDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
export function validOpeningPosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
