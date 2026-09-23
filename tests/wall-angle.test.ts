import { describe, expect, it } from 'vitest';
import { planStraightenWalls, planWallAngle, wallAngle, wallSkew } from '$lib/utils/wallEditing';
import type { Wall } from '$lib/models/types';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<Wall> = {}): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444444', ...extra });
const apply = (walls: Wall[], changes: Map<string, Partial<Wall>>) => walls.map(w => ({ ...w, ...changes.get(w.id) }));

describe('wall angles', () => {
  it('reports line angles counter-clockwise with plan Y pointing up, independent of direction', () => {
    expect(wallAngle(wall('a', 0, 0, 100, 0))).toBeCloseTo(0);
    expect(wallAngle(wall('a', 100, 0, 0, 0))).toBeCloseTo(0);
    expect(wallAngle(wall('a', 0, 0, 0, -100))).toBeCloseTo(90);
    expect(wallAngle(wall('a', 0, 100, 0, 0))).toBeCloseTo(90);
    expect(wallAngle(wall('a', 0, 0, 100, -100))).toBeCloseTo(45);
    expect(wallSkew(wall('a', 0, 0, 1, 100))).toBeCloseTo(0.573, 2);
  });

  it('slides the moving corner along a single joined neighbour so it keeps its angle', () => {
    // Slightly skewed vertical wall between two horizontal walls.
    const walls = [wall('top', 0, 0, 300, 0), wall('side', 300, 0, 306, 400), wall('bottom', 306, 400, 0, 400)];
    const next = apply(walls, planWallAngle(walls, 'side', 90, 'start'));
    expect(next[1].end.x).toBeCloseTo(300); expect(next[1].end.y).toBeCloseTo(400);
    expect(next[2].start).toEqual(next[1].end);
    expect(wallAngle(next[2])).toBeCloseTo(0);
    expect(next[0]).toEqual(walls[0]);
  });

  it('keeps the length without a single straight neighbour, and chooses the nearest direction', () => {
    const walls = [wall('a', 0, 0, 100, 3)];
    const next = apply(walls, planWallAngle(walls, 'a', 180, 'start'));
    expect(next[0].end.x).toBeCloseTo(Math.hypot(100, 3)); expect(next[0].end.y).toBeCloseTo(0);
    const fromEnd = apply(walls, planWallAngle(walls, 'a', 0, 'end'));
    expect(fromEnd[0].end).toEqual(walls[0].end); expect(fromEnd[0].start.y).toBeCloseTo(3);
  });

  it('returns no changes for an already exact angle and rejects invalid input', () => {
    const walls = [wall('a', 0, 0, 100, 0)];
    expect(planWallAngle(walls, 'a', 0).size).toBe(0);
    expect(planWallAngle(walls, 'a', 180).size).toBe(0);
    expect(() => planWallAngle(walls, 'a', Number.NaN)).toThrow();
    expect(() => planWallAngle([wall('a', 0, 0, 0, 0)], 'a', 90)).toThrow();
  });
});

describe('straighten walls', () => {
  it('snaps nearly axis-aligned walls, keeps corners joined, and leaves intentional diagonals', () => {
    const walls = [
      wall('top', 0, 0, 400, 2),         // 0.29° off
      wall('right', 400, 2, 403, 300),   // 0.58° off
      wall('bottom', 403, 300, 0, 300),
      wall('left', 0, 300, 0, 0),
      wall('diag', 403, 300, 600, 250),  // ~14° — intentional
    ];
    const next = apply(walls, planStraightenWalls(walls));
    for (const w of next.slice(0, 4)) expect(wallSkew(w)).toBeCloseTo(0, 9);
    expect(next[0].end).toEqual(next[1].start);
    expect(next[1].end).toEqual(next[2].start);
    expect(next[2].end).toEqual(next[3].start);
    expect(next[3].end).toEqual(next[0].start);
    // The diagonal follows its corner but keeps its far end.
    expect(next[4].start).toEqual(next[1].end);
    expect(next[4].end).toEqual(walls[4].end);
    expect(wallSkew(next[4])).toBeGreaterThan(10);
  });

  it('keeps collinear chains on one line weighted by length, and ignores curved walls', () => {
    const walls = [wall('long', 0, 0, 300, 1), wall('short', 300, 1, 400, 5), wall('curve', 400, 4, 500, 4, { curvePoint: { x: 450, y: 50 } })];
    const next = apply(walls, planStraightenWalls(walls));
    expect(next[0].start.y).toBeCloseTo(next[1].end.y);
    expect(next[0].start.y).toBeCloseTo((300 * 0.5 + 100 * 3) / 400, 1);
    expect(next[2].curvePoint).toEqual(walls[2].curvePoint);
    expect(next[2].start).toEqual(next[1].end);
  });

  it('anchors lines on walls that are already square', () => {
    const walls = [wall('square', 0, 0, 0, 300), wall('skewed', 0, 300, 4, 500)];
    const next = apply(walls, planStraightenWalls(walls));
    expect(next[0]).toEqual(walls[0]);
    expect(next[1].end).toEqual({ x: 0, y: 500 });
  });

  it('is a no-op for a square plan', () => {
    const walls = [wall('a', 0, 0, 100, 0), wall('b', 100, 0, 100, 100), wall('c', 100, 100, 0, 100), wall('d', 0, 100, 0, 0)];
    expect(planStraightenWalls(walls).size).toBe(0);
  });
});
