import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import * as THREE from 'three';
import type { Floor, Pipe } from '$lib/models/types';
import {
  addPipe, addPipePoint, currentProject, duplicateSelection, loadProject, movePipePoint, pasteSelection, redo, removeElement,
  removePipePoint, rotateSelection, selectedTool, undo, undoHistoryStore, updatePipe, beginUndoGroup, endUndoGroup,
} from '$lib/stores/project';
import { readProject } from '$lib/utils/projectValidation';
import { marqueeSelectionIds } from '$lib/utils/marqueeSelection';
import { multiSelectionBounds } from '$lib/utils/multiSelectionBounds';
import { selectionRotation } from '$lib/utils/selectionRotation';
import { duplicatePlanSelection } from '$lib/utils/duplicateSelection';
import { hitTestPipe, hitTestPipeVertex } from '$lib/utils/pipeHitTesting';
import { DEFAULT_PIPE_DIAMETER, diameterForKind, pipeLength, validPipeData } from '$lib/utils/pipes';
import { editableDef, editableFurniture, editablePlanFloor, pipeEditable, pipeOpacity, pipeSurface, planOpacity, tradeForPlacing, DIMMED_OPACITY } from '$lib/utils/workFilter';
import { getCatalogItem, isPlumbingFixture } from '$lib/utils/furnitureCatalog';
import { buildPipeMeshes, pipeCentreHeight, pipeRadius, storeySpacing, MIN_PIPE_RADIUS, CEILING_PIPE_GAP } from '$lib/utils/pipeModels3d';
import { FLOOR_FINISH } from '$lib/utils/furnitureModelLoader';
import { sceneSignature } from '$lib/utils/sceneSignature';
import { undoMessage } from '$lib/i18n/undoMessages';
import { pipeDraft, pipeToolOptions, addDraftPoint, finishPipeDraft, placeRiser, setPipeKind, setPipeOptions, pipeRunFor } from '$lib/stores/pipeTool';
import { activeSurface, activeTrade } from '$lib/stores/workContext';
import { roomProject } from './fixtures/project';

const project = () => get(currentProject)!;
const floor = () => project().floors[0];
const pipes = () => floor().pipes ?? [];
const entries = () => get(undoHistoryStore).entries.map(entry => entry.description);
const run = (points: [number, number][], extra: Partial<Pipe> = {}): Omit<Pipe, 'id'> =>
  ({ kind: 'cold', diameter: 20, run: 'floor', points: points.map(([x, y]) => ({ x, y })), ...extra });

beforeEach(() => {
  loadProject(roomProject());
  activeTrade.set('furnishing');
  activeSurface.set('floor');
  pipeDraft.set([]);
});

describe('pipe store', () => {
  it('adds, edits and deletes pipes as undoable steps', () => {
    const id = addPipe(run([[0, 0], [100, 0]]))!;
    expect(pipes()).toEqual([{ id, kind: 'cold', diameter: 20, run: 'floor', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]);
    updatePipe(id, { kind: 'hot' });
    addPipePoint(id, { x: 100, y: 100 });
    movePipePoint(id, 2, { x: 120, y: 100 });
    removePipePoint(id, 0);
    expect(pipes()[0]).toMatchObject({ kind: 'hot', points: [{ x: 100, y: 0 }, { x: 120, y: 100 }] });
    expect(entries()).toEqual(['Added pipe', 'Edited pipe', 'Added pipe point', 'Moved pipe point', 'Removed pipe point']);
    removeElement(id);
    expect(pipes()).toEqual([]);
    undo();
    expect(pipes()).toHaveLength(1);
    for (let i = 0; i < 5; i++) undo();
    expect(pipes()).toEqual([]);
    redo();
    expect(pipes()[0].points).toHaveLength(2);
  });

  it('coalesces rapid edits of the same pipe field and point', () => {
    const id = addPipe(run([[0, 0], [100, 0]]))!;
    movePipePoint(id, 1, { x: 110, y: 0 });
    movePipePoint(id, 1, { x: 120, y: 0 });
    movePipePoint(id, 1, { x: 130, y: 0 });
    updatePipe(id, { diameter: 16 });
    updatePipe(id, { diameter: 25 });
    expect(entries()).toEqual(['Added pipe', 'Moved pipe point', 'Edited pipe']);
    undo();
    expect(pipes()[0].diameter).toBe(20);
    undo();
    expect(pipes()[0].points[1]).toEqual({ x: 100, y: 0 });
  });

  it('refuses malformed pipes and edits, and clears optional fields with undefined', () => {
    expect(addPipe(run([[0, 0]]))).toBeNull();
    expect(addPipe(run([[0, 0], [1, 1]], { diameter: 0 }))).toBeNull();
    expect(addPipe(run([[0, 0], [NaN, 1]]))).toBeNull();
    expect(addPipe(run([[5, 5]], { riser: true }))).toBeTruthy();
    const id = addPipe(run([[0, 0], [100, 0]], { elevation: 40 }))!;
    updatePipe(id, { diameter: -5 });
    updatePipe(id, { points: [{ x: 0, y: 0 }] });
    expect(pipes()[1]).toMatchObject({ diameter: 20, elevation: 40 });
    updatePipe(id, { elevation: undefined });
    expect('elevation' in pipes()[1]).toBe(false);
  });

  it('removes a pipe left with too few points', () => {
    const id = addPipe(run([[0, 0], [100, 0]]))!;
    removePipePoint(id, 1);
    expect(pipes()).toEqual([]);
  });

  it('duplicates, pastes and rotates pipes with the selection', () => {
    const id = addPipe(run([[0, 0], [100, 0]]))!;
    const [copy] = duplicateSelection(new Set([id]));
    expect(pipes().find(p => p.id === copy)!.points).toEqual([{ x: 30, y: 30 }, { x: 130, y: 30 }]);
    const pasted = pasteSelection(structuredClone(floor()), new Set([id]), 2);
    expect(pipes().find(p => p.id === pasted[0])!.points[0]).toEqual({ x: 60, y: 60 });
    rotateSelection(new Set([id]), 90);
    const rotated = pipes().find(p => p.id === id)!.points;
    // About its centre (50, 0): the run turns to vertical.
    expect(rotated[0].x).toBeCloseTo(50); expect(rotated[0].y).toBeCloseTo(-50);
    expect(rotated[1].x).toBeCloseTo(50); expect(rotated[1].y).toBeCloseTo(50);
    expect(entries().at(-1)).toBe('Rotated selection');
  });

  it('moves a whole pipe in one undo group, as the canvas drag does', () => {
    const id = addPipe(run([[0, 0], [100, 0]]))!;
    beginUndoGroup();
    for (const dx of [10, 20, 30]) updatePipe(id, { points: [{ x: dx, y: 0 }, { x: 100 + dx, y: 0 }] });
    endUndoGroup('Moved pipe');
    expect(entries()).toEqual(['Added pipe', 'Moved pipe']);
    undo();
    expect(pipes()[0].points[0]).toEqual({ x: 0, y: 0 });
  });

  it('translates pipe undo messages', () => {
    for (const message of ['Added pipe', 'Edited pipe', 'Moved pipe', 'Added pipe point', 'Moved pipe point', 'Removed pipe point']) {
      expect(undoMessage(message, 'pt')).not.toBe(message);
    }
  });
});

describe('pipe validation', () => {
  const withPipes = (items: unknown[]) => {
    const p = roomProject() as any;
    p.floors[0].pipes = items;
    return p;
  };

  it('keeps projects without pipes unchanged and round-trips pipes', () => {
    expect('pipes' in readProject(roomProject()).floors[0]).toBe(false);
    const p = withPipes([{ id: 'p', kind: 'waste', diameter: 110, run: 'ceiling', elevation: -3, riser: true, points: [{ x: 1, y: 2 }] }]);
    expect(readProject(JSON.parse(JSON.stringify(p))).floors[0].pipes).toEqual(p.floors[0].pipes);
  });

  it.each([
    [{ kind: 'gas' }, 'kind'],
    [{ diameter: 0 }, 'diameter'],
    [{ diameter: Infinity }, 'diameter'],
    [{ run: 'roof' }, 'run'],
    [{ elevation: 'high' }, 'elevation'],
    [{ riser: 'yes' }, 'riser'],
    [{ points: [{ x: 0, y: 0 }] }, 'points'],
    [{ points: [{ x: 0, y: 0 }, { x: 'a', y: 0 }] }, 'points[1].x'],
    [{ id: 'a-0' }, 'id'],
  ])('rejects %j', (patch, path) => {
    const pipe = { id: 'p', kind: 'cold', diameter: 20, run: 'floor', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], ...patch };
    expect(() => readProject(withPipes([pipe]))).toThrow(path);
  });

  it('accepts a riser with a single point', () => {
    expect(validPipeData(run([[0, 0]], { riser: true }))).toBe(true);
    expect(() => readProject(withPipes([{ id: 'r', kind: 'hot', diameter: 20, run: 'floor', riser: true, points: [{ x: 0, y: 0 }] }]))).not.toThrow();
  });
});

describe('pipe geometry helpers', () => {
  it('measures runs and switches diameter presets with the kind', () => {
    expect(pipeLength(run([[0, 0], [300, 0], [300, 400]]))).toBe(700);
    expect(diameterForKind('waste', 20)).toBe(DEFAULT_PIPE_DIAMETER.waste);
    expect(diameterForKind('hot', 25)).toBe(25);
    expect(diameterForKind('cold', 110)).toBe(20);
  });

  it('hit-tests the polyline with a tolerance in screen pixels, topmost first, and risers by their ring', () => {
    const a: Pipe = { id: 'a', ...run([[0, 0], [100, 0], [100, 100]]) };
    const b: Pipe = { id: 'b', ...run([[50, -50], [50, 50]]) };
    const r: Pipe = { id: 'r', ...run([[300, 300]], { riser: true }) };
    expect(hitTestPipe({ x: 50, y: 0 }, [a, b], 1)?.id).toBe('b');
    expect(hitTestPipe({ x: 100, y: 60 }, [a, b], 1)?.id).toBe('a');
    expect(hitTestPipe({ x: 20, y: 9 }, [a], 1)?.id).toBe('a');
    expect(hitTestPipe({ x: 20, y: 30 }, [a], 1)).toBeNull();
    // Zoomed out the same pixels reach further.
    expect(hitTestPipe({ x: 20, y: 30 }, [a], 0.25)?.id).toBe('a');
    expect(hitTestPipe({ x: 304, y: 300 }, [r], 1)?.id).toBe('r');
    expect(hitTestPipeVertex({ x: 98, y: 3 }, a, 1)).toBe(1);
    expect(hitTestPipeVertex({ x: 50, y: 0 }, a, 1)).toBeNull();
    expect(hitTestPipeVertex({ x: 0, y: 0 }, null, 1)).toBeNull();
  });
});

describe('pipes in multi-selection', () => {
  const plan = (): Floor => {
    const f = structuredClone(roomProject().floors[0]);
    f.pipes = [{ id: 'p', ...run([[50, 50], [150, 50], [150, 120]]) }, { id: 'out', ...run([[50, 50], [900, 50]]) }];
    return f;
  };
  const all = { measurements: true, annotations: true, textAnnotations: true };

  it('box-selects pipes by all their points', () => {
    const ids = marqueeSelectionIds(plan(), { minX: 40, maxX: 200, minY: 40, maxY: 200 }, all);
    expect(ids).toContain('p');
    expect(ids).not.toContain('out');
  });

  it('bounds, rotation and duplication include pipes', () => {
    const f = plan();
    const bounds = multiSelectionBounds(f, new Set(['p', 'a-0']))!;
    expect(bounds.maxY).toBeGreaterThanOrEqual(120);
    const updates = selectionRotation(f, new Set(['p']), 180);
    expect(updates.get('p')!.points![0].x).toBeCloseTo(150);
    const ids = duplicatePlanSelection(f, new Set(['p']), (() => { let n = 0; return () => `copy-${n++}`; })());
    expect(ids).toEqual(['copy-0']);
    expect(f.pipes!.at(-1)!.points[0]).toEqual({ x: 80, y: 80 });
  });
});

describe('plumbing work filter', () => {
  const toilet = { catalogId: 'toilet' };
  const plumbingFloor = { trade: 'plumbing' as const, surface: 'floor' as const };

  it('flags the sanitary fixtures', () => {
    for (const id of ['toilet', 'sink_b', 'sink_k', 'shower', 'bathtub', 'washer_dryer', 'dishwasher']) expect(isPlumbingFixture(getCatalogItem(id)!)).toBe(true);
    expect(isPlumbingFixture(getCatalogItem('sofa')!)).toBe(false);
  });

  it('edits fixtures in Plumbing and Furnishing on the floor, never in Electrical', () => {
    expect(editableFurniture(toilet, plumbingFloor)).toBe(true);
    expect(editableFurniture(toilet, { trade: 'furnishing', surface: 'floor' })).toBe(true);
    expect(editableFurniture(toilet, { trade: 'electrical', surface: 'floor' })).toBe(false);
    expect(editableFurniture(toilet, { trade: 'plumbing', surface: 'ceiling' })).toBe(false);
    expect(editableFurniture({ catalogId: 'sofa' }, plumbingFloor)).toBe(false);
    expect(planOpacity({ catalogId: 'sofa' }, plumbingFloor)).toBe(DIMMED_OPACITY);
    expect(editableDef(getCatalogItem('toilet')!, 'plumbing')).toBe(true);
    expect(tradeForPlacing(getCatalogItem('toilet')!, 'plumbing')).toBe('plumbing');
    expect(tradeForPlacing(getCatalogItem('toilet')!, 'electrical')).toBe('furnishing');
  });

  it('edits pipes in Plumbing on their surface only', () => {
    const floorRun = { run: 'floor' as const }, wallRun = { run: 'wall' as const }, ceilingRun = { run: 'ceiling' as const };
    expect(pipeSurface(wallRun)).toBe('floor');
    expect(pipeSurface(ceilingRun)).toBe('ceiling');
    expect(pipeEditable(floorRun, plumbingFloor)).toBe(true);
    expect(pipeEditable(wallRun, plumbingFloor)).toBe(true);
    expect(pipeEditable(ceilingRun, plumbingFloor)).toBe(false);
    expect(pipeEditable(ceilingRun, { trade: 'plumbing', surface: 'ceiling' })).toBe(true);
    expect(pipeEditable(floorRun, { trade: 'furnishing', surface: 'floor' })).toBe(false);
    expect(pipeOpacity(floorRun, { trade: 'electrical', surface: 'floor' })).toBe(DIMMED_OPACITY);
    expect(pipeOpacity(floorRun, plumbingFloor)).toBe(1);
  });

  it('box select and select all only take pipes in Plumbing on their surface', () => {
    const f = structuredClone(roomProject().floors[0]);
    f.pipes = [{ id: 'floor', ...run([[0, 0], [1, 0]]) }, { id: 'ceil', ...run([[0, 0], [1, 0]], { run: 'ceiling' }) }];
    f.furniture = [{ id: 'wc', catalogId: 'toilet', position: { x: 50, y: 50 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } }];
    expect(editablePlanFloor(f, { trade: 'furnishing', surface: 'floor' }).pipes).toEqual([]);
    const plumbing = editablePlanFloor(f, plumbingFloor);
    expect(plumbing.pipes!.map(p => p.id)).toEqual(['floor']);
    expect(plumbing.furniture.map(i => i.id)).toEqual(['wc']);
    expect(plumbing.walls).toEqual([]);
    expect(editablePlanFloor(f, { trade: 'plumbing', surface: 'ceiling' }).pipes!.map(p => p.id)).toEqual(['ceil']);
    const bare = structuredClone(roomProject().floors[0]);
    expect(editablePlanFloor(bare, { trade: 'furnishing', surface: 'floor' })).toBe(bare);
  });
});

describe('pipe tool', () => {
  it('draws a run with the current options and the surface it was started on', () => {
    setPipeKind('waste');
    expect(get(pipeToolOptions)).toMatchObject({ kind: 'waste', diameter: 50 });
    setPipeOptions({ floorRun: 'wall', riser: false });
    addDraftPoint({ x: 0, y: 0 });
    addDraftPoint({ x: 0, y: 0 });
    addDraftPoint({ x: 200, y: 0 });
    expect(get(pipeDraft)).toHaveLength(2);
    const id = finishPipeDraft()!;
    expect(pipes().find(p => p.id === id)).toMatchObject({ kind: 'waste', diameter: 50, run: 'wall' });
    expect(get(pipeDraft)).toEqual([]);
    expect(pipeRunFor({ floorRun: 'wall' }, 'ceiling')).toBe('ceiling');
    setPipeKind('cold');
  });

  it('drops a one-point draft and places risers with one tap', () => {
    addDraftPoint({ x: 0, y: 0 });
    expect(finishPipeDraft()).toBeNull();
    expect(pipes()).toEqual([]);
    activeSurface.set('ceiling');
    const id = placeRiser({ x: 10, y: 20 })!;
    expect(pipes().find(p => p.id === id)).toMatchObject({ riser: true, run: 'ceiling', points: [{ x: 10, y: 20 }] });
  });

  it('keeps the run drawn so far when the tool is left', () => {
    selectedTool.set('pipe');
    addDraftPoint({ x: 0, y: 0 });
    addDraftPoint({ x: 0, y: 150 });
    selectedTool.set('select');
    expect(pipes()).toHaveLength(1);
    expect(get(pipeDraft)).toEqual([]);
  });
});

describe('pipes in 3D', () => {
  const box = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

  it('builds tubes at the run height with a visible minimum radius', () => {
    const f: Pick<Floor, 'pipes' | 'slabThickness'> = { pipes: [
      { id: 'floor', ...run([[0, 0], [100, 0], [100, 100]], { diameter: 10 }) },
      { id: 'wall', ...run([[0, 50], [100, 50]], { run: 'wall', kind: 'hot' }) },
      { id: 'ceil', ...run([[0, 0], [200, 0]], { run: 'ceiling', kind: 'waste', diameter: 110 }) },
    ] };
    const meshes = buildPipeMeshes(f, p => (p.x > 150 ? 240 : 260), 300);
    expect(meshes).toHaveLength(3);
    const [floorRun, wallRun, ceilRun] = meshes.map(box);
    expect(pipeRadius({ diameter: 10 })).toBe(MIN_PIPE_RADIUS);
    // Open-ended tubes: the run spans its points, grown by the radius across it.
    expect(floorRun.min.x).toBeCloseTo(0, 1);
    expect(floorRun.max.x).toBeCloseTo(100 + MIN_PIPE_RADIUS, 1);
    expect(floorRun.min.z).toBeCloseTo(-MIN_PIPE_RADIUS, 1);
    expect(floorRun.max.z).toBeCloseTo(100, 1);
    expect(floorRun.min.y).toBeCloseTo(FLOOR_FINISH, 1);
    expect((wallRun.min.y + wallRun.max.y) / 2).toBeCloseTo(FLOOR_FINISH + 30, 1);
    // Level under the lowest ceiling it passes: 240 − 5.5 − 2.
    expect(ceilRun.max.y).toBeCloseTo(240 - CEILING_PIPE_GAP, 1);
    expect(ceilRun.max.x - ceilRun.min.x).toBeCloseTo(200, 1);
    expect(ceilRun.max.z - ceilRun.min.z).toBeCloseTo(11, 1);
    const material = ((meshes[1].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial);
    expect(material.color.getHexString()).toBe('f87171');
    // Not x-ray tagged: the walls' x-ray fades tagged meshes, so pipes stay solid.
    meshes[0].traverse(child => expect(child.userData.xray).toBeUndefined());
  });

  it('honours an explicit elevation and runs risers through the storey', () => {
    const elevated: Pipe = { id: 'e', ...run([[0, 0], [10, 0]], { elevation: 80 }) };
    expect(pipeCentreHeight(elevated, 250)).toBe(FLOOR_FINISH + 80);
    const meshes = buildPipeMeshes({ slabThickness: 20, pipes: [{ id: 'r', ...run([[40, 40]], { riser: true }) }] }, 250, 320);
    const b = box(meshes[0]);
    expect(b.min.y).toBeCloseTo(-20, 1);
    expect(b.max.y).toBeCloseTo(320, 1);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(40);
  });

  it('finds the storey spacing from the floor elevations', () => {
    const p = roomProject();
    const upper = structuredClone(p.floors[0]);
    upper.id = 'upper'; upper.level = 1; upper.elevation = 280;
    p.floors.push(upper);
    expect(storeySpacing(p, p.floors[0])).toBe(280);
    expect(storeySpacing(p, upper)).toBe(300);
    expect(storeySpacing(undefined, upper)).toBe(300);
  });

  it('rebuilds the scene when a pipe changes', () => {
    const p = roomProject();
    p.floors[0].pipes = [{ id: 'p', ...run([[0, 0], [10, 0]]) }];
    const before = sceneSignature(p, p.floors[0], false, 'metric');
    p.floors[0].pipes[0].diameter = 25;
    expect(sceneSignature(p, p.floors[0], false, 'metric')).not.toBe(before);
  });
});
