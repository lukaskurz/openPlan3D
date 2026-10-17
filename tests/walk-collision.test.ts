import { describe, expect, it } from 'vitest';
import type { Door, Floor, Wall } from '../src/lib/models/types';
import { resolveWalk, walkBarriers, WALKER_RADIUS } from '../src/lib/utils/walkCollision';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<Wall> = {}): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 10, height: 250, color: '#cccccc', ...extra });
const door = (wallId: string, position: number, width = 90): Door =>
  ({ id: `d-${wallId}`, wallId, position, width, height: 210, type: 'single', swingDirection: 'left', flipSide: false });
const floor = (walls: Wall[], doors: Door[] = []) => ({ walls, doors } as unknown as Floor);

/** Walk in 1 cm steps, as the motion substeps do, and return where the walker ends. */
function walk(f: Floor, from: { x: number; z: number }, dx: number, dz: number, steps = 400) {
  const barriers = walkBarriers(f);
  let at = from;
  for (let i = 0; i < steps; i++) at = resolveWalk(at, { x: at.x + dx, z: at.z + dz }, barriers);
  return at;
}

describe('walkthrough wall collision', () => {
  // Thickness 10 is widened to the 15 cm viewer minimum: reach 7.5 + radius 20.
  const stop = 7.5 + WALKER_RADIUS;

  it('stops the walker in front of a wall instead of passing through', () => {
    const end = walk(floor([wall('w', -500, 0, 500, 0)]), { x: 0, z: 200 }, 0, -1);
    expect(end.z).toBeCloseTo(stop, 9);
    expect(end.x).toBeCloseTo(0, 9);
  });

  it('slides along the wall when walking into it at an angle', () => {
    const end = walk(floor([wall('w', -500, 0, 500, 0)]), { x: 0, z: 100 }, 0.6, -0.8);
    expect(end.z).toBeCloseTo(stop, 9);
    expect(end.x).toBeCloseTo(240, 6);
  });

  it('lets the walker through a doorway but not beside it', () => {
    const f = floor([wall('w', -500, 0, 500, 0)], [door('w', 0.5)]);
    expect(walk(f, { x: 0, z: 200 }, 0, -1).z).toBeCloseTo(-200, 9);
    expect(walk(f, { x: 100, z: 200 }, 0, -1).z).toBeCloseTo(stop, 9);
  });

  it('holds the walker inside a closed room corner', () => {
    const room = floor([wall('a', 0, 0, 300, 0), wall('b', 300, 0, 300, 300), wall('c', 300, 300, 0, 300), wall('d', 0, 300, 0, 0)]);
    const end = walk(room, { x: 150, z: 150 }, 0.7, 0.7);
    expect(end.x).toBeCloseTo(300 - stop, 6);
    expect(end.z).toBeCloseTo(300 - stop, 6);
  });

  it('blocks curved walls along their whole arc', () => {
    const f = floor([wall('arc', -200, 0, 200, 0, { curvePoint: { x: 0, y: -200 } })]);
    const end = walk(f, { x: 0, z: 100 }, 0, -1);
    expect(end.z).toBeGreaterThan(-100 + stop - 2);
    expect(end.z).toBeLessThan(-100 + stop + 2);
  });

  it('ignores walls with no height', () => {
    expect(walkBarriers(floor([wall('w', 0, 0, 100, 0, { height: 0, startHeight: 0, endHeight: 0 })]))).toEqual([]);
  });
});
