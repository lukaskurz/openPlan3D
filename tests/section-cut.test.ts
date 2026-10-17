import { describe, expect, it } from 'vitest';
import type { Floor, FurnitureItem, PlanSection, Project, Wall } from '$lib/models/types';
import {
  beyondItems, computeSection, cutPipes, cutRooms, cutSlabs, cutWalls, sectionDimensions, sectionFloors, sectionFrame,
  wallElevationSection, type BeyondItem, type BeyondWall,
} from '$lib/utils/sectionCut';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';

const wall = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<Wall> = {}): Wall =>
  ({ id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 10, height: 280, color: '#eee', ...extra });
const item = (id: string, catalogId: string, x: number, y: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x, y }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });
const floor = (id: string, extra: Partial<Floor> = {}): Floor => ({
  id, name: id, level: 0, walls: [], rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [],
  guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [], ...extra,
});

/**
 * Two rooms in a 600 × 300 box: a living room (x 0..400) and a bathroom (400..600),
 * split by a partition with a door at its middle; a window in the north wall.
 */
function twoRoomFloor(id = 'ground', extra: Partial<Floor> = {}): Floor {
  return floor(id, {
    walls: [
      wall('north', 0, 0, 600, 0), wall('east', 600, 0, 600, 300), wall('south', 600, 300, 0, 300), wall('west', 0, 300, 0, 0),
      wall('partition', 400, 0, 400, 300),
    ],
    doors: [{ id: 'door', wallId: 'partition', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }],
    windows: [{ id: 'win', wallId: 'north', position: 200 / 600, width: 120, height: 120, sillHeight: 90, type: 'standard' }],
    ...extra,
  });
}
const project = (...floors: Floor[]): Pick<Project, 'floors'> => ({ floors });
/** West → east through the middle, looking north (u = x + 50). */
const northCut = (extra: Partial<PlanSection> = {}): PlanSection =>
  ({ id: 's', code: 'A', start: { x: -50, y: 150 }, end: { x: 650, y: 150 }, look: -1, ...extra });

describe('sectionFrame', () => {
  it('puts the viewer’s left end at u = 0 for both viewing directions', () => {
    const north = sectionFrame(northCut());
    expect(north.view).toEqual({ x: 0, y: -1 });
    expect(north.origin).toEqual({ x: -50, y: 150 });
    expect(north.toCut({ x: 100, y: 50 })).toEqual({ u: 150, d: 100 });
    const south = sectionFrame(northCut({ look: 1 }));
    // Looking south (down the plan), east is on the viewer's left: the line's end is u = 0.
    expect(south.view).toEqual({ x: 0, y: 1 });
    expect(south.origin).toEqual({ x: 650, y: 150 });
    expect(south.toCut({ x: 600, y: 200 })).toEqual({ u: 50, d: 50 });
    const p = south.toPlan(120, 30);
    expect(south.toCut(p).u).toBeCloseTo(120);
    expect(south.toCut(p).d).toBeCloseTo(30);
    expect(south.length).toBe(700);
  });
});

describe('cut walls', () => {
  it('fills each crossed wall over its thickness and splits around a door', () => {
    const walls = cutWalls(sectionFrame(northCut()), twoRoomFloor(), 0);
    expect(walls.map(w => w.wallId)).toEqual(['west', 'partition', 'east']);
    expect(walls[0]).toMatchObject({ u0: 45, u1: 55, top: 280, pieces: [{ z0: 0, z1: 280 }], openings: [] });
    const partition = walls[1];
    expect(partition.u0).toBeCloseTo(445);
    expect(partition.pieces).toEqual([{ z0: 210, z1: 280 }]);
    expect(partition.openings).toEqual([{ kind: 'door', id: 'door', u0: partition.u0, u1: partition.u1, z0: 0, z1: 210 }]);
  });

  it('fills below the sill and above the head of a window', () => {
    // North → south through the window at x = 200.
    const section: PlanSection = { id: 'n', code: 'B', start: { x: 200, y: -50 }, end: { x: 200, y: 350 }, look: 1 };
    const walls = cutWalls(sectionFrame(section), twoRoomFloor(), 0);
    const north = walls.find(w => w.wallId === 'north')!;
    expect(north.pieces).toEqual([{ z0: 0, z1: 90 }, { z0: 210, z1: 280 }]);
    expect(north.openings[0]).toMatchObject({ kind: 'window', z0: 90, z1: 210 });
  });

  it('widens oblique crossings, follows curved walls and skips walls along the cut', () => {
    const diagonal: PlanSection = { id: 'd', code: 'C', start: { x: -100, y: -100 }, end: { x: 300, y: 300 }, look: 1 };
    const west = cutWalls(sectionFrame(diagonal), floor('f', { walls: [wall('west', 0, 300, 0, 0)] }), 0)[0];
    expect(west.u1 - west.u0).toBeCloseTo(10 / Math.SQRT1_2, 3);

    const curved = floor('c', { walls: [wall('arc', 0, 0, 400, 0, { curvePoint: { x: 200, y: 200 }, height: 250 })] });
    const cut = cutWalls(sectionFrame({ start: { x: 200, y: -50 }, end: { x: 200, y: 300 }, look: 1 }), curved, 0);
    expect(cut).toHaveLength(1);
    expect(cut[0].top).toBe(250);

    const along = cutWalls(sectionFrame({ start: { x: -50, y: 0 }, end: { x: 650, y: 0 }, look: 1 }), floor('p', { walls: [wall('north', 0, 0, 600, 0)] }), 0);
    expect(along).toEqual([]);
  });

  it('uses the wall height at the cut for sloped walls', () => {
    const sloped = floor('s', { walls: [wall('w', 0, 0, 0, 400, { startHeight: 200, endHeight: 300 })] });
    const cut = cutWalls(sectionFrame({ start: { x: -50, y: 100 }, end: { x: 50, y: 100 }, look: 1 }), sloped, 0);
    expect(cut[0].top).toBeCloseTo(225);
  });
});

describe('rooms and slabs', () => {
  it('gives each room its clear width and ceiling', () => {
    const f = twoRoomFloor();
    f.rooms = resolveRoomGeometry(f).map(({ room }) => room);
    f.roomCeilingHeights = {};
    const frame = sectionFrame(northCut());
    const rooms = cutRooms(project(f), frame, f, 0);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].u0).toBeCloseTo(55);
    expect(rooms[0].u1).toBeCloseTo(445);
    expect(rooms[1].u1 - rooms[1].u0).toBeCloseTo(190);
    expect(rooms[0].ceiling).toBe(280);
    // An override (a dropped ceiling) is what the section shows.
    f.roomCeilingHeights[rooms[1].roomId] = 240;
    expect(cutRooms(project(f), frame, f, 0)[1].ceiling).toBe(240);
  });

  it('puts a slab under the rooms and walls, with the floor’s thickness', () => {
    const f = twoRoomFloor('g', { slabThickness: 20 });
    const frame = sectionFrame(northCut());
    const walls = cutWalls(frame, f, 300);
    const slabs = cutSlabs(f, 300, walls, cutRooms(project(f), frame, f, 300, walls));
    expect(slabs).toHaveLength(1);
    expect(slabs[0].u0).toBeCloseTo(45);
    expect(slabs[0].u1).toBeCloseTo(655);
    expect(slabs[0]).toMatchObject({ z0: 280, z1: 300 });
    // Without rooms: from the first cut wall to the last, default thickness.
    const bare = floor('b', { walls: [wall('a', 0, 0, 0, 300), wall('b', 300, 0, 300, 300)] });
    const fallback = cutSlabs(bare, 0, cutWalls(frame, bare, 0), []);
    expect(fallback).toEqual([{ floorId: 'b', u0: 45, u1: 355, z0: -5, z1: 0 }]);
  });
});

describe('beyond the cut', () => {
  it('outlines the first wall in view with its openings and the items in front of it', () => {
    const f = twoRoomFloor('g', {
      furniture: [
        item('table', 'table', 200, 100),
        item('sofa', 'sofa', 200, 250), // behind the viewer
        item('outside', 'table', 200, -60), // beyond the north wall
        item('pendant', 'pendant_light', 300, 100),
        item('sconce', 'wall_sconce', 500, 10, { wallId: 'north', wallPosition: 500 / 600, wallSide: 1, rotation: 0 }),
      ],
    });
    const shapes = beyondItems(project(f), sectionFrame(northCut()), f, 0);
    const walls = shapes.filter((s): s is BeyondWall => s.kind === 'wall');
    const items = shapes.filter((s): s is BeyondItem => s.kind === 'item');
    expect(walls.map(w => w.wallId)).toEqual(['north']);
    expect(walls[0].depth).toBeCloseTo(145);
    expect(walls[0].u0).toBeCloseTo(50, 0);
    expect(walls[0].u1).toBeCloseTo(650, 0);
    expect(walls[0].openings).toHaveLength(1);
    expect(walls[0].openings[0]).toMatchObject({ kind: 'window', z0: 90, z1: 210 });
    expect(walls[0].openings[0].u0).toBeCloseTo(190);
    expect(walls[0].openings[0].u1).toBeCloseTo(310);
    expect(items.map(i => i.itemId).sort()).toEqual(['pendant', 'sconce', 'table']);
    const table = items.find(i => i.itemId === 'table')!;
    expect(table).toMatchObject({ z0: 0, z1: 75, u0: 200, u1: 300 });
    // Pendant: 30 cm tall with a 60 cm drop under the 280 cm ceiling.
    const pendant = items.find(i => i.itemId === 'pendant')!;
    expect(pendant).toMatchObject({ z0: 190, z1: 220, hang: { u: 350, z0: 220, z1: 280 } });
    expect(items.find(i => i.itemId === 'sconce')).toMatchObject({ z0: 170, mount: 'wall' });
    // Far to near: the wall first.
    expect(shapes[0].kind).toBe('wall');
    for (let i = 1; i < shapes.length; i++) expect(shapes[i].depth).toBeLessThanOrEqual(shapes[i - 1].depth);
  });

  it('stops at the clip depth when no wall is in view', () => {
    const f = floor('open', { walls: [wall('w', 0, 300, 0, 0)], furniture: [item('near', 'table', 100, 100), item('far', 'table', 100, -3000)] });
    const shapes = beyondItems(project(f), sectionFrame(northCut()), f, 0, { clipDepth: 500 });
    expect(shapes.map(s => s.kind === 'item' ? s.itemId : s.kind)).toEqual(['near']);
  });

  it('draws pipes crossing the cut as circles at their height', () => {
    const f = twoRoomFloor('g', { pipes: [{ id: 'p', kind: 'cold', diameter: 20, run: 'wall', points: [{ x: 100, y: 0 }, { x: 100, y: 300 }] }] });
    const pipes = cutPipes(project(f), sectionFrame(northCut()), f, 100);
    expect(pipes).toHaveLength(1);
    expect(pipes[0].u).toBeCloseTo(150);
    expect(pipes[0].z).toBeGreaterThan(130);
    expect(pipes[0].r).toBe(1);
  });
});

describe('storeys and the whole section', () => {
  function twoStoreys() {
    const ground = twoRoomFloor('ground');
    ground.elevation = 0;
    // The upper storey only covers the west half; the slab under it is 20 cm.
    const upper = floor('upper', { level: 1, elevation: 300, slabThickness: 20, walls: [
      wall('u1', 0, 0, 300, 0, { height: 260 }), wall('u2', 300, 0, 300, 300, { height: 260 }),
      wall('u3', 300, 300, 0, 300, { height: 260 }), wall('u4', 0, 300, 0, 0, { height: 260 }),
    ] });
    const attic = floor('attic', { level: 2, elevation: 600, walls: [wall('x', 1000, 0, 1000, 100)] });
    return project(attic, ground, upper);
  }

  it('lists the storeys the line crosses, lowest first, honouring floorIds', () => {
    const p = twoStoreys();
    expect(sectionFloors(p, northCut()).map(e => [e.floor.id, e.base])).toEqual([['ground', 0], ['upper', 300]]);
    expect(sectionFloors(p, northCut({ floorIds: ['upper'] })).map(e => e.floor.id)).toEqual(['upper']);
    // Unknown ids are ignored.
    expect(sectionFloors(p, northCut({ floorIds: ['gone'] })).map(e => e.floor.id)).toEqual(['ground', 'upper']);
  });

  it('computes walls, slabs, rooms, beyond and dimensions in absolute heights', () => {
    const model = computeSection(twoStoreys(), northCut());
    expect(model.code).toBe('A');
    expect(model.length).toBe(700);
    expect(model.storeys.map(s => [s.floorId, s.base, s.top])).toEqual([['ground', 0, 300], ['upper', 300, 600]]);
    expect(model.walls.filter(w => w.floorId === 'upper').map(w => [w.base, w.top])).toEqual([[300, 560], [300, 560]]);
    expect(model.slabs.find(s => s.floorId === 'upper')).toMatchObject({ z0: 280, z1: 300 });
    expect(model.rooms).toHaveLength(3);
    expect(model.bounds.minZ).toBe(-5);
    expect(model.bounds.maxZ).toBe(600);
    const kinds = model.dimensions.map(d => d.kind);
    expect(kinds.filter(k => k === 'storey')).toHaveLength(2);
    expect(kinds.filter(k => k === 'ceiling')).toHaveLength(3);
    expect(kinds.filter(k => k === 'width')).toHaveLength(3);
    const overall = model.dimensions.find(d => d.kind === 'overall')!;
    expect(overall).toMatchObject({ at: -5 });
    expect(overall.from).toBeCloseTo(45);
    expect(overall.to).toBeCloseTo(655);
    const upperRoom = model.rooms.find(r => r.floorId === 'upper')!;
    expect(upperRoom.ceiling).toBe(260);
    expect(model.dimensions).toContainEqual(expect.objectContaining({ kind: 'ceiling', from: 300, to: 560 }));
  });

  it('builds dimensions from the model alone', () => {
    const dims = sectionDimensions({ length: 100, storeys: [], rooms: [], bounds: { minU: 0, maxU: 100, minZ: 0, maxZ: 0 } });
    expect(dims).toEqual([{ kind: 'overall', axis: 'h', from: 0, to: 100, at: 0, offset: 36 }]);
  });
});

describe('wall elevations as sections', () => {
  it('places the cut just inside the wall, looking at it with its start on the left', () => {
    const north = wall('north', 0, 0, 600, 0);
    const section = wallElevationSection(north, 1, 60);
    expect(section.start).toEqual({ x: 0, y: 65 });
    expect(section.end).toEqual({ x: 600, y: 65 });
    const frame = sectionFrame(section);
    expect(frame.view.y).toBe(-1);
    expect(frame.toCut(north.start).u).toBeCloseTo(0);
    const f = twoRoomFloor('g', { furniture: [item('sconce', 'wall_sconce', 500, 10, { wallId: 'north', wallPosition: 500 / 600, wallSide: 1 })] });
    const shapes = beyondItems(project(f), frame, f, 0);
    expect(shapes.find(s => s.kind === 'wall')).toMatchObject({ wallId: 'north' });
    expect(shapes.find(s => s.kind === 'item')).toMatchObject({ itemId: 'sconce', z0: 170 });
    // As the elevation uses it: furniture within a metre of the face, not the room's middle.
    const room = twoRoomFloor('g', { furniture: [item('sideboard', 'table', 100, 40), item('middle', 'table', 200, 200)] });
    const near = beyondItems(project(room), sectionFrame(wallElevationSection(north, 1, 100)), room, 0, { clipDepth: 200 });
    expect(near.filter(s => s.kind === 'item').map(s => (s as BeyondItem).itemId)).toEqual(['sideboard']);
    // The other side looks from outside, start on the right.
    const outside = sectionFrame(wallElevationSection(north, -1, 60));
    expect(outside.view.y).toBe(1);
    expect(outside.toCut(north.end).u).toBeCloseTo(0);
  });
});
