import { describe, expect, it } from 'vitest';
import type { Constraint, Wall } from '$lib/models/types';
import { analyzeConstraints, buildSketch, checkNewConstraint, planConstrainedDrag, planConstraintSolve, planConstraintValue } from '$lib/utils/constraints';
import { measureConstraint } from '$lib/utils/constraints/rows';
import { faceSpan } from '$lib/utils/constraints/faces';
import { wallEdgeInsets } from '$lib/utils/canvasRenderer';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number, extra: Partial<Wall> = {}): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444444', ...extra });
const apply = (walls: Wall[], changes: Map<string, Partial<Wall>>) => walls.map(w => ({ ...w, ...changes.get(w.id) }));
const byId = (walls: Wall[], id: string) => walls.find(w => w.id === id)!;
const len = (w: Wall) => Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);

/** 400 × 300 room, drawn clockwise on screen (y down): bottom edge is y = 0. */
const rectangle = () => [wall('b', 0, 0, 400, 0), wall('r', 400, 0, 400, 300), wall('t', 400, 300, 0, 300), wall('l', 0, 300, 0, 0)];
const square: Constraint[] = [
  { id: 'hb', kind: 'horizontal', wallId: 'b' }, { id: 'ht', kind: 'horizontal', wallId: 't' },
  { id: 'vl', kind: 'vertical', wallId: 'l' }, { id: 'vr', kind: 'vertical', wallId: 'r' },
];
const length = (id: string, wallId: string, value: number, side: 0 | 1 | -1 = 0): Constraint => ({ id, kind: 'length', wallId, side, value });

describe('constraint solving', () => {
  it('leaves floors without constraints alone', () => {
    expect(planConstraintSolve(rectangle(), []).size).toBe(0);
    expect(planConstrainedDrag(rectangle(), [], new Map([['b:end', { x: 10, y: 10 }]]))).toBeNull();
    expect(analyzeConstraints(rectangle(), []).dof).toBe(0);
  });

  it('changes a wall length by moving only the far side of a square room', () => {
    const walls = rectangle(), constraints = [...square, length('len', 'b', 400)];
    const next = apply(walls, planConstraintValue(walls, constraints, 'len', 500, 'start'));
    expect(byId(next, 'b').end.x).toBeCloseTo(500, 4); expect(byId(next, 'b').end.y).toBeCloseTo(0, 4);
    expect(byId(next, 'r').start.x).toBeCloseTo(500, 4); expect(byId(next, 'r').end.x).toBeCloseTo(500, 4);
    expect(byId(next, 't').start.x).toBeCloseTo(500, 4); expect(byId(next, 't').end).toEqual({ x: 0, y: 300 });
    expect(byId(next, 'l')).toEqual(byId(walls, 'l'));
    // Anchoring the other end moves the left side instead.
    const other = apply(walls, planConstraintValue(walls, constraints, 'len', 500, 'end'));
    expect(byId(other, 'b').start.x).toBeCloseTo(-100, 4); expect(byId(other, 'r')).toEqual(byId(walls, 'r'));
  });

  it('solves to the nearest configuration, independent of the steps taken', () => {
    const walls = [wall('a', 0, 0, 100, 0)];
    // Horizontal constraint on a skewed wall: both ends meet halfway.
    const skewed = [wall('a', 0, 0, 100, 20)];
    const next = apply(skewed, planConstraintSolve(skewed, [{ id: 'h', kind: 'horizontal', wallId: 'a' }]));
    expect(byId(next, 'a').start.y).toBeCloseTo(10, 6); expect(byId(next, 'a').end.y).toBeCloseTo(10, 6);
    expect(byId(next, 'a').start.x).toBeCloseTo(0, 6); expect(byId(next, 'a').end.x).toBeCloseTo(100, 6);
    expect(planConstraintSolve(walls, [{ id: 'h', kind: 'horizontal', wallId: 'a' }]).size).toBe(0);
  });

  it('measures faces: surface to surface, inside and outside faces', () => {
    const walls = rectangle(), sketch = buildSketch(walls);
    const facing: Constraint = { id: 'w', kind: 'lineDistance', wallA: 'l', sideA: 1, wallB: 'r', sideB: 1, value: 0 };
    expect(measureConstraint(facing, sketch)).toBeCloseTo(385, 6);
    expect(measureConstraint({ ...facing, sideA: 0, sideB: 0 }, sketch)).toBeCloseTo(400, 6);
    expect(measureConstraint({ ...facing, sideA: -1, sideB: -1 }, sketch)).toBeCloseTo(415, 6);
    expect(measureConstraint(length('i', 'b', 0, 1), sketch)).toBeCloseTo(385, 6);  // inside face (+y)
    expect(measureConstraint(length('o', 'b', 0, -1), sketch)).toBeCloseTo(415, 6); // outside face
    const insets = wallEdgeInsets(walls[0], walls);
    expect(measureConstraint(length('i', 'b', 0, 1), sketch)).toBeCloseTo(400 - insets.start - insets.end, 6);
    // A free end adds nothing; a T-host clips both faces.
    expect(faceSpan({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, thickness: 10 }, 1, [], [])).toBe(100);
    const t = [wall('host', 0, 0, 400, 0, { thickness: 20 }), wall('stem', 200, 0, 200, 300, { thickness: 10 })];
    expect(measureConstraint(length('s', 'stem', 0, 1), buildSketch(t))).toBeCloseTo(290, 6);
    expect(measureConstraint(length('s', 'stem', 0, -1), buildSketch(t))).toBeCloseTo(290, 6);
  });

  it('drives a surface-to-surface width', () => {
    const walls = rectangle();
    const width: Constraint = { id: 'w', kind: 'lineDistance', wallA: 'l', sideA: 1, wallB: 'r', sideB: 1, value: 385 };
    const constraints = [...square, width];
    const next = apply(walls, planConstraintValue(walls, constraints, 'w', 365));
    expect(measureConstraint(width, buildSketch(next))).toBeCloseTo(365, 4);
    expect(byId(next, 'l')).toEqual(byId(walls, 'l'));
    expect(byId(next, 'r').start.x).toBeCloseTo(380, 4);
  });

  it('sets angles at a shared corner without mirroring, including large changes', () => {
    const walls = [wall('a', 0, 0, 300, 0), wall('b', 0, 0, 0, -300)];
    const angle: Constraint = { id: 'ang', kind: 'angle', wallA: 'a', wallB: 'b', flipB: false, value: 90 };
    expect(measureConstraint(angle, buildSketch(walls))).toBeCloseTo(90, 6);
    for (const target of [120, 45, 170, -60]) {
      const next = apply(walls, planConstraintValue(walls, [angle], 'ang', target));
      expect(measureConstraint(angle, buildSketch(next))).toBeCloseTo(target, 4);
      expect(byId(next, 'a')).toEqual(byId(walls, 'a'));
      expect(byId(next, 'b').start).toEqual({ x: 0, y: 0 });
    }
  });

  it('keeps near-miss joins as drawn', () => {
    const walls = [wall('a', 0, 0, 100, 0), wall('b', 100, 3, 100, 200)];
    const next = apply(walls, planConstraintValue(walls, [length('len', 'a', 100)], 'len', 150));
    expect(byId(next, 'a').end.x).toBeCloseTo(150, 6); expect(byId(next, 'a').end.y).toBeCloseTo(0, 6);
    expect(byId(next, 'b').start.x).toBeCloseTo(150, 6); expect(byId(next, 'b').start.y).toBeCloseTo(3, 6);
  });

  it('keeps T-junction endpoints on their host and enforces fixes', () => {
    const walls = [wall('host', 0, 0, 400, 0), wall('stem', 200, 0, 200, 200)];
    const fix: Constraint = { id: 'f', kind: 'fix', target: { wallId: 'host' }, at: [{ x: 0, y: 0 }, { x: 400, y: 40 }] };
    const next = apply(walls, planConstraintSolve(walls, [fix]));
    expect(byId(next, 'host').end).toEqual({ x: 400, y: 40 });
    const s = byId(next, 'stem').start;
    expect(s.y).toBeCloseTo(s.x / 10, 6);
    expect(analyzeConstraints(walls, [fix]).conflicts.has('f')).toBe(true);
    expect(analyzeConstraints(next, [fix]).conflicts.size).toBe(0);
  });

  it('rejects values the constraints cannot take, without changing anything', () => {
    const walls = [wall('a', 0, 0, 100, 0), wall('b', 100, 0, 50, 86.6), wall('c', 50, 86.6, 0, 0)];
    const constraints = [length('la', 'a', 100), length('lb', 'b', 100), length('lc', 'c', 100)];
    expect(() => planConstraintValue(walls, constraints, 'lc', 300)).toThrow();
    expect(walls[0].end).toEqual({ x: 100, y: 0 });
  });
});

describe('over-constraint detection', () => {
  it('flags a redundant length and lets a driven one follow', () => {
    const walls = rectangle(), constraints = [...square, length('lb', 'b', 400)];
    expect(checkNewConstraint(walls, constraints, length('lt', 't', 400)).status).toBe('overConstrained');
    expect(checkNewConstraint(walls, constraints, length('ll', 'l', 300)).status).toBe('ok');
    const withDriven = [...constraints, { ...length('lt', 't', 400), driven: true }];
    const next = apply(walls, planConstraintValue(walls, withDriven, 'lb', 450));
    expect(analyzeConstraints(next, withDriven).measures.get('lt')).toBeCloseTo(450, 4);
  });

  it('refuses a redundant perpendicular', () => {
    const walls = rectangle(), constraints = square.filter(c => c.id === 'hb' || c.id === 'vl');
    expect(checkNewConstraint(walls, constraints, { id: 'p', kind: 'perpendicular', wallA: 'b', wallB: 'l' }).status).toBe('overConstrained');
    expect(checkNewConstraint(walls, [], { id: 'p', kind: 'perpendicular', wallA: 'b', wallB: 'l' }).status).toBe('ok');
  });

  it('counts degrees of freedom and allows fixing a fully dimensioned wall', () => {
    const walls = rectangle(), constraints = [...square, length('lb', 'b', 400), length('ll', 'l', 300)];
    const before = analyzeConstraints(walls, constraints);
    expect(before.dof).toBe(2);
    expect(before.fullyConstrainedWalls.size).toBe(0);
    const fix: Constraint = { id: 'f', kind: 'fix', target: { wallId: 'b' }, at: [{ x: 0, y: 0 }, { x: 400, y: 0 }] };
    expect(checkNewConstraint(walls, constraints, fix).status).toBe('ok');
    const after = analyzeConstraints(walls, [...constraints, fix]);
    expect(after.dof).toBe(0);
    expect(after.fullyConstrainedWalls).toEqual(new Set(['b', 'r', 't', 'l']));
  });

  it('drops an implied parallel that other constraints already give', () => {
    const walls = rectangle();
    const width: Constraint = { id: 'd', kind: 'lineDistance', wallA: 'b', sideA: 1, wallB: 't', sideB: 1, value: 285 };
    expect(checkNewConstraint(walls, square, width).status).toBe('ok');
  });

  it('flags a distance between walls held slightly apart', () => {
    const walls = [wall('a', 0, 0, 400, 0), wall('b', 0, 200, 400, 210.5)];
    const angle = measureConstraint({ id: 'x', kind: 'angle', wallA: 'a', wallB: 'b', flipB: false, value: 0 }, buildSketch(walls))!;
    const constraints: Constraint[] = [{ id: 'h', kind: 'horizontal', wallId: 'a' }, { id: 'ang', kind: 'angle', wallA: 'a', wallB: 'b', flipB: false, value: angle }];
    const width: Constraint = { id: 'd', kind: 'lineDistance', wallA: 'a', sideA: 0, wallB: 'b', sideB: 0, value: -205 };
    expect(checkNewConstraint(walls, constraints, width).status).toBe('overConstrained');
  });

  it('sees through a right angle that momentarily makes a width and a length equivalent', () => {
    // Width between parallel side walls, plus the length of the wall joining them, fix the angle.
    const walls = rectangle();
    const constraints: Constraint[] = [
      { id: 'w', kind: 'lineDistance', wallA: 'l', sideA: 1, wallB: 'r', sideB: 1, value: 385 },
      length('lb', 'b', 400),
    ];
    const angle: Constraint = { id: 'a', kind: 'angle', wallA: 'b', wallB: 'r', flipB: false, value: measureConstraint({ id: 'x', kind: 'angle', wallA: 'b', wallB: 'r', flipB: false, value: 0 }, buildSketch(walls))! };
    expect(checkNewConstraint(walls, constraints, angle).status).toBe('overConstrained');
    expect(checkNewConstraint(walls, [constraints[0]], length('lb', 'b', 400)).status).toBe('ok');
  });

  it('does not mistake collinear corners for redundancy', () => {
    const walls = [wall('a', 0, 0, 100, 0), wall('b', 100, 0, 200, 0)];
    const constraints = [length('la', 'a', 100), length('lb', 'b', 100)];
    const across: Constraint = { id: 'x', kind: 'pointDistance', a: { wallId: 'a', end: 'start' }, b: { wallId: 'b', end: 'end' }, axis: 'aligned', value: 200 };
    expect(checkNewConstraint(walls, constraints, across).status).toBe('ok');
  });
});

describe('constrained dragging', () => {
  it('pivots a fixed-length wall about a fixed wall instead of stretching it', () => {
    const walls = [wall('a', 0, 0, 300, 0), wall('b', 300, 0, 300, 200)];
    const constraints: Constraint[] = [
      { id: 'f', kind: 'fix', target: { wallId: 'a' }, at: [{ x: 0, y: 0 }, { x: 300, y: 0 }] },
      length('lb', 'b', 200),
    ];
    const plan = planConstrainedDrag(walls, constraints, new Map([['b:end', { x: 450, y: 100 }]]))!;
    const next = apply(walls, plan.changes);
    expect(len(byId(next, 'b'))).toBeCloseTo(200, 3);
    const end = byId(next, 'b').end;
    expect(Math.atan2(end.y, end.x - 300)).toBeCloseTo(Math.atan2(100, 150), 2);
    expect(byId(next, 'a')).toEqual(byId(walls, 'a'));
    expect(plan.handled.has('b:end')).toBe(true);
  });

  it('does not move a fully constrained corner, and ignores unconstrained walls', () => {
    const walls = rectangle();
    const constraints: Constraint[] = [...square, length('lb', 'b', 400), length('ll', 'l', 300),
      { id: 'f', kind: 'fix', target: { wallId: 'b' }, at: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }];
    const plan = planConstrainedDrag(walls, constraints, new Map([['r:end', { x: 450, y: 350 }], ['t:start', { x: 450, y: 350 }]]))!;
    const next = apply(walls, plan.changes);
    expect(byId(next, 'r').end.x).toBeCloseTo(400, 4); expect(byId(next, 'r').end.y).toBeCloseTo(300, 4);
    const loose = [...walls, wall('free', 1000, 0, 1100, 0)];
    expect(planConstrainedDrag(loose, constraints, new Map([['free:end', { x: 1200, y: 50 }]]))).toBeNull();
  });
});
