import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Project, Wall } from '$lib/models/types';
import {
  activeFloor, addFloor, createAlternative, createDefaultProject, currentProject, deletePlanAlternative, loadProject,
  redo, renamePlanAlternative, selectedElementId, switchPlanAlternative, undo, updateWall,
} from '$lib/stores/project';
import {
  allPlanFloors, assignAlternativeCodes, branchAlternative, branchCode, deleteAlternative, ensureAlternativeCodes, nextLetterCode, switchAlternative,
} from '$lib/utils/planAlternatives';
import { readProject } from '$lib/utils/projectValidation';

const wall = (id: string, x2: number): Wall =>
  ({ id, start: { x: 0, y: 0 }, end: { x: x2, y: 0 }, thickness: 15, height: 280, color: '#444444' });
const nameFor = (letter: string) => `Option ${letter}`;
const now = new Date('2026-09-24T12:00:00Z');

function plan(): Project {
  const project = createDefaultProject();
  project.floors[0].walls = [wall('w', 400)];
  return project;
}
const wallLength = (project: Project) => project.floors[0].walls[0].end.x;

describe('plan alternatives (pure)', () => {
  it('keeps the current plan and continues in an identical copy', () => {
    const project = plan();
    const created = branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor, thumbnail: 'data:image/jpeg;base64,AA==' });
    expect(created.name).toBe('Option B');
    expect(project.alternatives!.map(alt => [alt.id, alt.name])).toEqual([['a', 'Option A'], ['b', 'Option B']]);
    expect(project.activeAlternativeId).toBe('b');
    expect(project.alternatives![0].floors).toEqual(project.floors);
    expect(project.alternatives![0].floors).not.toBe(project.floors);
    expect(project.alternatives![0].thumbnail).toBe('data:image/jpeg;base64,AA==');
    expect(project.alternatives![1].floors).toEqual([]);
  });

  it('switches between alternatives without mixing their edits', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    project.floors[0].walls[0].end.x = 600;
    expect(switchAlternative(project, 'a', now)).toBe(true);
    expect(wallLength(project)).toBe(400);
    expect(project.alternatives![1].floors[0].walls[0].end.x).toBe(600);
    expect(switchAlternative(project, 'b', now)).toBe(true);
    expect(wallLength(project)).toBe(600);
    expect(switchAlternative(project, 'b', now)).toBe(false);
    expect(allPlanFloors(project)).toHaveLength(2);
  });

  it('branches from whichever alternative is active and names new ones after the next free letter', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    switchAlternative(project, 'a', now);
    branchAlternative(project, { id: 'c', originalId: 'unused', now, nameFor });
    expect(project.alternatives!.map(alt => alt.name)).toEqual(['Option A', 'Option C', 'Option B']);
    expect(project.alternatives!.map(alt => alt.code)).toEqual(['A', 'C', 'B']);
    project.alternatives![1].name = 'Option D';
    expect(nextLetterCode(project.alternatives!)).toBe('D');
    expect(project.alternatives![1].code).toBe('C');
  });

  it('deleting the active alternative switches to a neighbour, and the last one left ends alternatives', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    project.floors[0].walls[0].end.x = 600;
    branchAlternative(project, { id: 'c', originalId: 'unused', now, nameFor });
    project.floors[0].walls[0].end.x = 800;
    expect(deleteAlternative(project, 'c', now)).toBe(true);
    expect(project.activeAlternativeId).toBe('b');
    expect(wallLength(project)).toBe(600);
    expect(deleteAlternative(project, 'a', now)).toBe(true);
    expect(project.alternatives).toBeUndefined();
    expect(project.activeAlternativeId).toBeUndefined();
    expect(wallLength(project)).toBe(600);
  });
});

describe('plan alternatives validation', () => {
  it('round-trips through JSON, including dates and each alternative\'s floors', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    const read = readProject(JSON.parse(JSON.stringify(project)));
    expect(read.alternatives![0].updatedAt).toEqual(now);
    expect(read.alternatives![0].floors[0].walls).toEqual(project.floors[0].walls);
    expect(read.activeAlternativeId).toBe('b');
  });

  it('rejects broken alternatives and never keeps floors on the active entry', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    const stray = structuredClone(project); stray.alternatives![1].floors = structuredClone(project.floors);
    expect(readProject(stray).alternatives![1].floors).toEqual([]);
    const missing = structuredClone(project); missing.activeAlternativeId = 'nope';
    expect(() => readProject(missing)).toThrow('activeAlternativeId must refer to an alternative');
    const empty = structuredClone(project); empty.alternatives![0].floors = [];
    expect(() => readProject(empty)).toThrow('alternatives[0].floors must contain at least one floor');
    const badWall = structuredClone(project); (badWall.alternatives![0].floors[0].walls[0] as any).thickness = -1;
    expect(() => readProject(badWall)).toThrow('alternatives[0].floors[0].walls[0]');
    const noAlternatives = structuredClone(project); delete noAlternatives.alternatives;
    expect(readProject(noAlternatives)).not.toHaveProperty('activeAlternativeId');
  });
});

describe('plan alternatives store', () => {
  beforeEach(() => loadProject(plan()));

  it('creates, switches, renames and deletes alternatives as undoable steps', () => {
    createAlternative({ nameFor });
    updateWall('w', { end: { x: 600, y: 0 } });
    const [a, b] = get(currentProject)!.alternatives!;
    selectedElementId.set('w');
    switchPlanAlternative(a.id);
    expect(selectedElementId && get(selectedElementId)).toBeNull();
    expect(get(activeFloor)!.walls[0].end.x).toBe(400);
    undo();
    expect(get(activeFloor)!.walls[0].end.x).toBe(600);
    expect(get(currentProject)!.activeAlternativeId).toBe(b.id);
    redo();
    expect(get(currentProject)!.activeAlternativeId).toBe(a.id);
    renamePlanAlternative(b.id, '  Sofa by the window ');
    expect(get(currentProject)!.alternatives![1].name).toBe('Sofa by the window');
    deletePlanAlternative(a.id);
    expect(get(currentProject)!.alternatives).toBeUndefined();
    expect(get(activeFloor)!.walls[0].end.x).toBe(600);
    undo();
    expect(get(currentProject)!.alternatives).toHaveLength(2);
    expect(get(activeFloor)!.walls[0].end.x).toBe(400);
  });

  it('keeps each alternative\'s floors and active floor separate', () => {
    createAlternative({ nameFor });
    addFloor('Upstairs', 'empty');
    const upstairs = get(currentProject)!.activeFloorId;
    const [a, b] = get(currentProject)!.alternatives!;
    switchPlanAlternative(a.id);
    expect(get(currentProject)!.floors).toHaveLength(1);
    switchPlanAlternative(b.id);
    expect(get(currentProject)!.floors).toHaveLength(2);
    expect(get(currentProject)!.activeFloorId).toBe(upstairs);
  });
});

describe('alternative codes', () => {
  const alt = (id: string, name: string, code?: string) => ({ id, name, ...(code ? { code } : {}) });
  const codes = (list: { id: string; name: string; code?: string }[]) => Object.fromEntries(assignAlternativeCodes(list));
  const coded = (...list: string[]) => list.map(code => ({ code }));

  it('branches into the letter part plus the lowest unused number', () => {
    expect(branchCode(coded('A'), 'A')).toBe('A1');
    expect(branchCode(coded('A', 'A1'), 'A')).toBe('A2');
    expect(branchCode(coded('A', 'A1'), 'A1')).toBe('A2');
    expect(branchCode(coded('A', 'A1', 'A2', 'B'), 'B')).toBe('B1');
    expect(branchCode(coded('A', 'A2'), 'A')).toBe('A1');
    expect(branchCode(coded('AB'), 'AB')).toBe('AB1');
  });

  it('gives a new alternative the next letter no code uses, even when A–D exist', () => {
    expect(nextLetterCode(coded('A', 'B', 'C', 'D'))).toBe('E');
    expect(nextLetterCode(coded('A', 'A1', 'C'))).toBe('B');
    expect(nextLetterCode(coded('B1'))).toBe('A');
    expect(nextLetterCode(coded(...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))))).toBe('AA');
  });

  it('gives codes by position when no name is a letter', () => {
    expect(codes([alt('a', 'Kitchen open'), alt('b', 'Kitchen closed'), alt('c', 'Third')])).toEqual({ a: 'A', b: 'B', c: 'C' });
  });

  it('keeps a name that is exactly one letter as its code', () => {
    expect(codes([alt('a', 'Big kitchen'), alt('b', 'A'), alt('c', ' c ')])).toEqual({ a: 'B', b: 'A', c: 'C' });
  });

  it('gives the next unused letter to the rest, and a repeated letter only once', () => {
    expect(codes([alt('a', 'B'), alt('b', 'B'), alt('c', 'Other')])).toEqual({ a: 'B', b: 'A', c: 'C' });
  });

  it('reads the default names of earlier versions in English and Portuguese', () => {
    expect(codes([alt('a', 'Option A'), alt('b', 'Option C'), alt('c', 'Copy')])).toEqual({ a: 'A', b: 'C', c: 'B' });
    expect(codes([alt('a', 'Opção D'), alt('b', 'Plano')])).toEqual({ a: 'D', b: 'A' });
  });

  it('keeps valid stored codes first and replaces repeated or invalid ones', () => {
    expect(codes([alt('a', 'Option C', 'A1'), alt('b', 'Wide', 'B'), alt('c', 'Narrow', 'B'), alt('d', 'Open', 'a2'), alt('e', 'Option C')]))
      .toEqual({ a: 'A1', b: 'B', c: 'D', d: 'E', e: 'C' });
  });

  it('runs past Z into two letters', () => {
    const many = Array.from({ length: 28 }, (_, i) => alt(`id${i}`, `Plan ${i}`));
    const result = assignAlternativeCodes(many);
    expect(result.get('id25')).toBe('Z');
    expect(result.get('id26')).toBe('AA');
    expect(result.get('id27')).toBe('AB');
  });

  it('migrates a stored project once, and leaves its codes alone afterwards', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    branchAlternative(project, { id: 'c', originalId: 'unused', now, nameFor });
    for (const entry of project.alternatives!) delete entry.code;
    project.alternatives![0].name = 'Kitchen';
    project.alternatives![1].name = 'Option C';
    project.alternatives![2].name = 'b';
    ensureAlternativeCodes(project);
    expect(project.alternatives!.map(entry => entry.code)).toEqual(['A', 'C', 'B']);
    project.alternatives![2].name = 'Option D';
    ensureAlternativeCodes(project);
    expect(project.alternatives!.map(entry => entry.code)).toEqual(['A', 'C', 'B']);
  });

  it('assigns codes when branching and starting new alternatives', () => {
    const project = plan();
    const copyNameFor = (code: string) => `Copy of ${code}`;
    const a1 = branchAlternative(project, { id: 'a1', originalId: 'a', now, nameFor, copyNameFor, kind: 'branch' });
    expect(project.alternatives![0]).toMatchObject({ id: 'a', code: 'A', name: 'Option A' });
    expect(a1).toMatchObject({ code: 'A1', parentCode: 'A', name: 'Copy of A' });
    const a2 = branchAlternative(project, { id: 'a2', originalId: 'unused', now, nameFor, kind: 'branch' });
    expect(a2).toMatchObject({ code: 'A2', parentCode: 'A1', name: 'Copy of A1' });
    const b = branchAlternative(project, { id: 'b', originalId: 'unused', now, nameFor, kind: 'new' });
    expect(b).toMatchObject({ code: 'B', name: 'Option B' });
    expect(b).not.toHaveProperty('parentCode');
    const b1 = branchAlternative(project, { id: 'b1', originalId: 'unused', now, nameFor, kind: 'branch', name: 'Sofa' });
    expect(b1).toMatchObject({ code: 'B1', parentCode: 'B', name: 'Sofa' });
    expect(branchAlternative(project, { id: 'c', originalId: 'unused', now, nameFor }).code).toBe('C');
  });

  it('keeps every code through renames and deletes; the last one left is the plan, implicitly A', () => {
    const project = plan();
    branchAlternative(project, { id: 'b', originalId: 'a', now, nameFor });
    branchAlternative(project, { id: 'c', originalId: 'unused', now, nameFor });
    project.alternatives![1].name = 'Renamed';
    expect(deleteAlternative(project, 'a', now)).toBe(true);
    expect(project.alternatives!.map(entry => entry.code)).toEqual(['B', 'C']);
    expect(deleteAlternative(project, 'b', now)).toBe(true);
    expect(project.alternatives).toBeUndefined();
    expect(branchAlternative(project, { id: 'd', originalId: 'e', now, nameFor }).code).toBe('B');
    expect(project.alternatives![0].code).toBe('A');
  });

  it('round-trips codes through readProject and repairs broken ones', () => {
    const project = plan();
    branchAlternative(project, { id: 'a1', originalId: 'a', now, nameFor, kind: 'branch' });
    branchAlternative(project, { id: 'b', originalId: 'unused', now, nameFor });
    const read = readProject(JSON.parse(JSON.stringify(project)));
    expect(read.alternatives!.map(entry => [entry.code, entry.parentCode])).toEqual([['A', undefined], ['A1', 'A'], ['B', undefined]]);

    const broken = JSON.parse(JSON.stringify(project));
    broken.alternatives[1].code = 'A';
    broken.alternatives[1].parentCode = 'nope';
    broken.alternatives[2].code = 42;
    const repaired = readProject(broken);
    // The third keeps its letter from its default name "Option B"; the repeated A gets the next free one.
    expect(repaired.alternatives!.map(entry => entry.code)).toEqual(['A', 'C', 'B']);
    expect(repaired.alternatives![1]).not.toHaveProperty('parentCode');

    const legacy = JSON.parse(JSON.stringify(project));
    for (const entry of legacy.alternatives) { delete entry.code; delete entry.parentCode; }
    legacy.alternatives[1].name = 'Option C';
    expect(readProject(legacy).alternatives!.map(entry => entry.code)).toEqual(['A', 'C', 'B']);
  });

  it('restores codes on undo and gives them to projects loaded without readProject', () => {
    const legacy = plan();
    branchAlternative(legacy, { id: 'b', originalId: 'a', now, nameFor });
    for (const entry of legacy.alternatives!) delete entry.code;
    loadProject(legacy);
    expect(get(currentProject)!.alternatives!.map(entry => entry.code)).toEqual(['A', 'B']);
    createAlternative({ nameFor, kind: 'branch' });
    expect(get(currentProject)!.alternatives!.map(entry => entry.code)).toEqual(['A', 'B', 'B1']);
    createAlternative({ nameFor });
    expect(get(currentProject)!.alternatives!.map(entry => entry.code)).toEqual(['A', 'B', 'B1', 'C']);
    renamePlanAlternative('b', 'Kitchen');
    undo();
    undo();
    expect(get(currentProject)!.alternatives!.map(entry => [entry.code, entry.parentCode])).toEqual([['A', undefined], ['B', undefined], ['B1', 'B']]);
    redo();
    expect(get(currentProject)!.alternatives!.map(entry => entry.code)).toEqual(['A', 'B', 'B1', 'C']);
  });
});
