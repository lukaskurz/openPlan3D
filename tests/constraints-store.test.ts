import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Constraint, Wall } from '$lib/models/types';
import {
  activeFloor, addConstraint, createDefaultProject, currentProject, pasteSelection, removeElement, resizeWallLength,
  reverseWall, setConstraintDriven, splitWall, undo, updateConstraint, updateConstraintValue, updateWall,
} from '$lib/stores/project';
import { analyzeConstraints } from '$lib/utils/constraints';
import { readProject } from '$lib/utils/projectValidation';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444444' });
const floor = () => get(activeFloor)!;
const byId = (id: string) => floor().walls.find(w => w.id === id)!;
const analysis = () => analyzeConstraints(floor().walls, floor().constraints ?? []);

beforeEach(() => {
  const project = createDefaultProject();
  project.floors[0].walls = [wall('b', 0, 0, 400, 0), wall('r', 400, 0, 400, 300), wall('t', 400, 300, 0, 300), wall('l', 0, 300, 0, 0)];
  currentProject.set(project);
  for (const [kind, wallId] of [['horizontal', 'b'], ['horizontal', 't'], ['vertical', 'l'], ['vertical', 'r']] as const) {
    expect(addConstraint({ kind, wallId })).toMatchObject({ driven: false });
  }
});

describe('constraint store', () => {
  it('adds dimensions, turns redundant ones into driven dimensions and refuses redundant constraints', () => {
    const width = addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 });
    expect(width).toMatchObject({ driven: false });
    expect(addConstraint({ kind: 'length', wallId: 't', side: 0, value: 400 })).toMatchObject({ driven: true });
    expect(addConstraint({ kind: 'perpendicular', wallA: 'b', wallB: 'l' })).toHaveProperty('error');
    expect(floor().constraints).toHaveLength(6);
  });

  it('moves the plan when a dimension changes, reversibly, and rejects impossible values without a history entry', () => {
    const { id } = addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 }) as { id: string };
    expect(updateConstraintValue(id, 450)).toBeNull();
    expect(byId('r').start.x).toBeCloseTo(450, 4);
    expect(byId('l')).toEqual(wall('l', 0, 300, 0, 0));
    undo();
    expect(byId('r').start.x).toBe(400);
    expect(updateConstraintValue(id, -20)).toBeTruthy();
    expect(byId('r').start.x).toBe(400);
    undo(); // the previous entry is still the dimension itself
    expect(floor().constraints?.some(c => c.id === id)).toBe(false);
  });

  it('routes Properties length edits through a length dimension', () => {
    addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 });
    expect(resizeWallLength('b', 380, 'start')).toBeNull();
    expect(byId('b').end.x).toBeCloseTo(380, 4);
    expect((floor().constraints!.find(c => c.kind === 'length') as { value: number }).value).toBe(380);
    // A free edge still resizes, and joined constraints follow.
    expect(resizeWallLength('l', 250, 'end')).toBeNull();
    expect(analysis().conflicts.size).toBe(0);
  });

  it('switches driven dimensions back only when that no longer over-constrains', () => {
    const a = addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 }) as { id: string };
    const b = addConstraint({ kind: 'length', wallId: 't', side: 0, value: 400 }) as { id: string };
    expect(setConstraintDriven(b.id, false)).toBeTruthy();
    expect(setConstraintDriven(a.id, true)).toBeNull();
    expect(setConstraintDriven(b.id, false)).toBeNull();
    expect(floor().constraints!.find(c => c.id === b.id)!.driven).toBeUndefined();
  });

  it('keeps surface dimensions when a wall gets thicker', () => {
    const { id } = addConstraint({ kind: 'lineDistance', wallA: 'l', sideA: 1, wallB: 'r', sideB: 1, value: 385 }) as { id: string };
    updateWall('r', { thickness: 25 });
    expect(byId('r').thickness).toBe(25);
    expect(byId('r').start.x - byId('l').end.x).toBeCloseTo(405, 4); // centres move apart by the extra half thickness
    expect(analysis().measures.get(id)).toBeCloseTo(385, 4);
    expect(analysis().conflicts.size).toBe(0);
  });

  it('re-solves direct geometry edits, and refuses ones the constraints forbid', () => {
    updateWall('b', { end: { x: 400, y: 40 } });
    expect(byId('b').start.y).toBeCloseTo(40, 4); // the horizontal wall moves as a whole
    expect(byId('l').end.y).toBeCloseTo(40, 4);
    expect(analysis().conflicts.size).toBe(0);
    expect(addConstraint({ kind: 'fix', target: { wallId: 'l' }, at: [byId('l').start, byId('l').end] })).toMatchObject({ driven: false });
    updateWall('b', { end: { x: 400, y: 80 } }); // would have to slope the horizontal wall
    expect(byId('b').end.y).toBeCloseTo(40, 6);
  });

  it('removes constraints with their walls, and on their own', () => {
    const { id } = addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 }) as { id: string };
    removeElement(id);
    expect(floor().constraints!.some(c => c.id === id)).toBe(false);
    removeElement('b');
    expect(floor().constraints!.some(c => c.kind === 'horizontal' && c.wallId === 'b')).toBe(false);
  });

  it('keeps constraints meaningful when a wall is split or reversed', () => {
    addConstraint({ kind: 'length', wallId: 'b', side: 0, value: 400 });
    addConstraint({ kind: 'lineDistance', wallA: 'b', sideA: 1, wallB: 't', sideB: -1, value: 0 });
    const before = [...analysis().measures.values()].map(Math.abs).sort();
    reverseWall('b');
    expect(analysis().conflicts.size).toBe(0);
    expect([...analysis().measures.values()].map(Math.abs).sort()).toEqual(before.map(v => expect.closeTo(v, 6)));
    const newId = splitWall('b', 0.25)!;
    expect(analysis().conflicts.size).toBe(0);
    const constraints = floor().constraints!;
    expect(constraints.some(c => c.kind === 'pointDistance')).toBe(true);
    expect(constraints.some(c => c.kind === 'parallel' && c.wallB === newId)).toBe(true);
    // The split pieces stay collinear when the room changes.
    const width = constraints.find(c => c.kind === 'pointDistance')!;
    expect(updateConstraintValue(width.id, 420)).toBeNull();
    const first = byId('b'), second = byId(newId);
    expect(first.start.y).toBeCloseTo(second.end.y, 6); expect(first.end.y).toBeCloseTo(0, 6);
  });

  it('copies constraints with pasted walls', () => {
    const source = structuredClone(floor());
    const ids = pasteSelection(source, new Set(['b', 'r', 't', 'l']));
    expect(ids).toHaveLength(4);
    expect(floor().constraints).toHaveLength(8);
    expect(analysis().conflicts.size).toBe(0);
    updateConstraint(floor().constraints![0].id, { offset: 60 });
    expect(floor().constraints![0].offset).toBe(60);
  });
});

describe('constraint persistence', () => {
  it('validates constraints and drops ones that point at missing walls', () => {
    const project = structuredClone(get(currentProject)!);
    const constraints: Constraint[] = [
      { id: 'ok', kind: 'length', wallId: 'b', side: 1, value: 385 },
      { id: 'gone', kind: 'parallel', wallA: 'b', wallB: 'missing' },
      { id: 'fix', kind: 'fix', target: { wallId: 'b', end: 'start' }, at: [{ x: 0, y: 0 }] },
    ];
    project.floors[0].constraints = constraints;
    const read = readProject(project);
    expect(read.floors[0].constraints!.map(c => c.id)).toEqual(['ok', 'fix']);
    expect(project.floors[0].constraints).toHaveLength(3);
    const bad = structuredClone(project);
    bad.floors[0].constraints = [{ id: 'x', kind: 'length', wallId: 'b', side: 2, value: 1 } as unknown as Constraint];
    expect(() => readProject(bad)).toThrow();
    const noConstraints = structuredClone(project);
    delete noConstraints.floors[0].constraints;
    expect(readProject(noConstraints).floors[0].constraints).toBeUndefined();
  });
});
