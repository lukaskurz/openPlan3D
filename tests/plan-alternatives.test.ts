import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Project, Wall } from '$lib/models/types';
import {
  activeFloor, addFloor, createAlternative, createDefaultProject, currentProject, deletePlanAlternative, loadProject,
  redo, renamePlanAlternative, selectedElementId, switchPlanAlternative, undo, updateWall,
} from '$lib/stores/project';
import { allPlanFloors, branchAlternative, deleteAlternative, nextAlternativeLetter, switchAlternative } from '$lib/utils/planAlternatives';
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
    project.alternatives![1].name = 'Option D';
    expect(nextAlternativeLetter(project, nameFor)).toBe('C');
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
