import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Floor, FurnitureItem, Project, Wall } from '$lib/models/types';
import {
  addFurniture, createDefaultFloor, createDefaultProject, currentProject, detectedRoomsStore, redo, removeRoom,
  setRoomCeilingHeight, undo, undoHistoryStore, updateFurniture, updateItemDetails,
} from '$lib/stores/project';
import {
  ceilingSummary, createCeilingResolver, effectiveRoomCeiling, floorDefaultCeiling, roomCeilingOverride, storeyCeiling,
} from '$lib/utils/ceilingHeights';
import { effectiveElevation } from '$lib/utils/mounting';
import { resolveRooms } from '$lib/utils/roomDetection';
import { readProject } from '$lib/utils/projectValidation';
import { undoMessage } from '$lib/i18n/undoMessages';

function rect(prefix: string, x0: number, y0: number, x1: number, y1: number, height = 280): Wall[] {
  const points = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return points.map((start, i) => ({ id: `${prefix}${i}`, start, end: points[(i + 1) % 4], thickness: 10, height, color: '#eeeeee' }));
}
const item = (id: string, catalogId: string, x: number, y: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x, y }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

/** Two rooms side by side: a 280 cm living room (0..400) and a 250 cm bathroom (400..600). */
function twoRooms(): Project {
  const project = createDefaultProject('Ceilings');
  const floor = project.floors[0];
  floor.walls = [...rect('a', 0, 0, 400, 300), ...rect('b', 400, 0, 600, 300, 250)];
  return project;
}
const roomAt = (floor: Floor, x: number) => resolveRooms(floor).find(room => {
  const ids = new Set(room.walls);
  return x < 400 ? ids.has('a0') : ids.has('b0');
})!;

describe('effective ceiling heights', () => {
  it('uses uniform boundary walls, then the tallest wall, then the storey', () => {
    const project = twoRooms(), floor = project.floors[0];
    expect(effectiveRoomCeiling(project, floor, roomAt(floor, 100))).toBe(280);
    // The shared wall belongs to both rooms; the bathroom's boundary mixes 280 and 250.
    const bath = roomAt(floor, 500);
    expect(bath.walls).toContain('a1');
    expect(effectiveRoomCeiling(project, floor, bath)).toBe(280);
    // A room whose walls are gone falls back to the storey ceiling.
    expect(effectiveRoomCeiling(project, floor, { id: 'gone', walls: ['missing'] })).toBe(295);
  });

  it('prefers the override, then the legacy room metadata', () => {
    const project = twoRooms(), floor = project.floors[0], room = roomAt(floor, 100);
    expect(effectiveRoomCeiling(project, floor, { ...room, details: { ceilingHeight: 260 } })).toBe(260);
    floor.roomCeilingHeights = { [room.id]: 240 };
    expect(roomCeilingOverride(floor, room.id)).toBe(240);
    expect(effectiveRoomCeiling(project, floor, { ...room, details: { ceilingHeight: 260 } })).toBe(240);
    floor.roomCeilingHeights = { [room.id]: -3 };
    expect(roomCeilingOverride(floor, room.id)).toBeUndefined();
  });

  it('takes the storey from the floor above minus its slab', () => {
    const project = createDefaultProject(), ground = project.floors[0];
    expect(storeyCeiling(project, ground)).toBe(295);
    const upper = createDefaultFloor(1);
    project.floors.push(upper);
    expect(storeyCeiling(project, ground)).toBe(295);
    upper.elevation = 320; upper.slabThickness = 20;
    expect(storeyCeiling(project, ground)).toBe(300);
    expect(storeyCeiling(project, upper)).toBe(295);
    // Without walls the floor default is the storey; with walls, their most common height.
    expect(floorDefaultCeiling(project, ground)).toBe(300);
    ground.walls = [...rect('a', 0, 0, 100, 100, 260), ...rect('b', 200, 0, 300, 100, 260), ...rect('c', 400, 0, 500, 100, 240)];
    expect(floorDefaultCeiling(project, ground)).toBe(260);
  });

  it('resolves the ceiling above a point from the smallest room containing it', () => {
    const project = twoRooms(), floor = project.floors[0];
    // A closet inside the living room with a dropped ceiling.
    floor.walls.push(...rect('c', 20, 20, 120, 120, 280));
    const closet = resolveRooms(floor).find(room => room.walls.includes('c0'))!;
    floor.rooms = [closet];
    floor.roomCeilingHeights = { [closet.id]: 220 };
    const ceilingAt = createCeilingResolver(project, floor);
    expect(ceilingAt({ x: 70, y: 70 })).toBe(220);
    expect(ceilingAt({ x: 300, y: 200 })).toBe(280);
    expect(ceilingAt({ x: 500, y: 150 })).toBe(280);
    expect(ceilingAt({ x: 5000, y: 5000 })).toBe(floorDefaultCeiling(project, floor));
    // A pendant (30 cm, 60 cm cord) over the closet hangs below the dropped ceiling.
    expect(effectiveElevation(item('p', 'pendant_light', 70, 70), ceilingAt)).toBe(220 - 60 - 30);
  });

  it('summarises the ceiling: electrical ceiling items and the ceiling range', () => {
    const project = twoRooms(), floor = project.floors[0];
    const bath = roomAt(floor, 500);
    floor.rooms = [bath];
    floor.roomCeilingHeights = { [bath.id]: 230 };
    floor.furniture = [
      item('1', 'pendant_light', 100, 100), item('2', 'sym_smoke', 200, 100), item('3', 'ceiling_fan', 100, 200),
      item('4', 'ceiling_projector', 300, 100), item('5', 'floor_lamp', 50, 50), item('6', 'sym_outlet', 0, 50),
    ];
    expect(ceilingSummary(project, floor)).toEqual({ lights: 3, min: 230, max: 280 });
    const empty = createDefaultProject();
    expect(ceilingSummary(empty, empty.floors[0])).toEqual({ lights: 0, min: 295, max: 295 });
  });
});

describe('setRoomCeilingHeight', () => {
  beforeEach(() => {
    currentProject.set(twoRooms());
    detectedRoomsStore.set(resolveRooms(get(currentProject)!.floors[0]));
  });
  const floor = () => get(currentProject)!.floors[0];

  it('saves a detected room, writes the map and the native mirror, and undoes in one step', () => {
    const room = get(detectedRoomsStore).find(r => r.walls.includes('a0'))!;
    const pendant = addFurniture('pendant_light', { x: 100, y: 100 });
    const before = structuredClone(floor());
    const steps = get(undoHistoryStore).entries.length;
    setRoomCeilingHeight(room.id, 250);
    expect(floor().rooms.map(r => r.id)).toEqual([room.id]);
    expect(floor().roomCeilingHeights).toEqual({ [room.id]: 250 });
    expect(floor().rooms[0].details?.ceilingHeight).toBe(250);
    expect(get(undoHistoryStore).entries.length).toBe(steps + 1);
    expect(get(undoHistoryStore).entries.at(-1)!.description).toBe('Changed ceiling height');
    expect(undoMessage('Changed ceiling height', 'pt')).toBe('Pé-direito alterado');
    // The pendant follows the new ceiling.
    const at = createCeilingResolver(get(currentProject)!, floor());
    expect(effectiveElevation(floor().furniture.find(f => f.id === pendant)!, at)).toBe(250 - 90);
    // A repeat with the same value is no change at all.
    setRoomCeilingHeight(room.id, 250);
    expect(get(undoHistoryStore).entries.length).toBe(steps + 1);
    undo();
    expect(floor()).toEqual(before);
    redo();
    expect(floor().roomCeilingHeights).toEqual({ [room.id]: 250 });
  });

  it('clears the override and the mirror, leaving the walls to decide', () => {
    const room = get(detectedRoomsStore)[0];
    setRoomCeilingHeight(room.id, 240);
    setRoomCeilingHeight(room.id, undefined);
    expect(floor().roomCeilingHeights).toBeUndefined();
    expect(floor().rooms[0].details?.ceilingHeight).toBeNull();
    expect(effectiveRoomCeiling(get(currentProject)!, floor(), floor().rooms[0])).toBe(280);
    // The cleared mirror survives a reload without bringing the override back.
    expect(readProject(get(currentProject)).floors[0].roomCeilingHeights).toBeUndefined();
  });

  it('ignores invalid heights, unknown rooms and clearing an unsaved room', () => {
    const steps = get(undoHistoryStore).entries.length;
    const room = get(detectedRoomsStore)[0];
    for (const bad of [0, -10, Number.NaN, Infinity, 200_000]) setRoomCeilingHeight(room.id, bad);
    setRoomCeilingHeight('missing', 250);
    setRoomCeilingHeight(room.id, undefined);
    expect(floor().rooms).toEqual([]);
    expect(get(undoHistoryStore).entries.length).toBe(steps);
  });

  it('forgets a deleted room’s override', () => {
    const room = get(detectedRoomsStore).find(r => r.walls.includes('a0'))!;
    setRoomCeilingHeight(room.id, 250);
    removeRoom(room.id);
    expect(floor().roomCeilingHeights).toBeUndefined();
  });

  it('takes a ceiling height edited in the item details panel into the map', () => {
    const project = get(currentProject)!;
    const room = get(detectedRoomsStore)[0];
    updateItemDetails({ floorId: project.floors[0].id, kind: 'rooms', id: room.id }, { ceilingHeight: 265 });
    expect(floor().roomCeilingHeights).toEqual({ [room.id]: 265 });
  });

  it('never stores an elevation on ceiling items', () => {
    const id = addFurniture('pendant_light', { x: 100, y: 100 });
    expect(floor().furniture.find(f => f.id === id)!.elevation).toBeUndefined();
    updateFurniture(id, { elevation: 120 });
    expect(floor().furniture.find(f => f.id === id)!.elevation).toBeUndefined();
    updateFurniture(id, { drop: 15 });
    expect(floor().furniture.find(f => f.id === id)!.drop).toBe(15);
  });

  it('places wall items at their mounting height with an optional host wall', () => {
    const outlet = addFurniture('sym_outlet', { x: 100, y: 0 }, { wallId: 'a0', wallPosition: 0.25, wallSide: -1 });
    expect(floor().furniture.find(f => f.id === outlet)).toMatchObject({ elevation: 30, wallId: 'a0', wallPosition: 0.25, wallSide: -1 });
    const loose = addFurniture('sym_switch', { x: 100, y: 0 }, { wallId: 'missing', wallPosition: 0.5, wallSide: 1 });
    const placed = floor().furniture.find(f => f.id === loose)!;
    expect(placed.elevation).toBe(105);
    expect(placed.wallId).toBeUndefined();
    // A host is only for wall items.
    const sofa = addFurniture('sofa', { x: 100, y: 100 }, { wallId: 'a0', wallPosition: 0.5, wallSide: 1 });
    expect(floor().furniture.find(f => f.id === sofa)!.wallId).toBeUndefined();
  });
});

describe('ceiling heights in saved projects', () => {
  it('round-trips overrides, mounts, drops and wall hosts', () => {
    const project = twoRooms(), floor = project.floors[0];
    floor.roomCeilingHeights = { r1: 245.5 };
    floor.furniture = [
      item('p', 'pendant_light', 100, 100, { drop: 20 }),
      item('s', 'sofa', 100, 100, { mount: 'floor' }),
      item('o', 'sym_outlet', 100, 0, { elevation: 30, wallId: 'a0', wallPosition: 0.25, wallSide: -1 }),
    ];
    const read = readProject(JSON.parse(JSON.stringify(project)));
    expect(read.floors[0].roomCeilingHeights).toEqual({ r1: 245.5 });
    expect(read.floors[0].furniture).toEqual(floor.furniture);
    expect(readProject(read)).toEqual(read);
  });

  it('rejects malformed mounting and ceiling data', () => {
    const bad = (edit: (floor: any) => void) => {
      const project: any = twoRooms(); project.floors[0].furniture = [item('o', 'sym_outlet', 0, 0)];
      edit(project.floors[0]);
      return () => readProject(project);
    };
    expect(bad(f => { f.furniture[0].mount = 'roof'; })).toThrow(/mount/);
    expect(bad(f => { f.furniture[0].drop = -1; })).toThrow(/drop/);
    expect(bad(f => { Object.assign(f.furniture[0], { wallId: 'a0', wallPosition: 1.5 }); })).toThrow(/wallPosition/);
    expect(bad(f => { Object.assign(f.furniture[0], { wallId: 'a0', wallPosition: 0.5, wallSide: 0 }); })).toThrow(/wallSide/);
    expect(bad(f => { f.roomCeilingHeights = []; })).toThrow(/roomCeilingHeights/);
    expect(bad(f => { f.roomCeilingHeights = { r: 0 }; })).toThrow(/roomCeilingHeights/);
    expect(bad(f => { f.roomCeilingHeights = { r: 100_001 }; })).toThrow(/roomCeilingHeights/);
    expect(bad(f => { f.roomCeilingHeights = { r: '250' }; })).toThrow(/roomCeilingHeights/);
    expect(bad(f => { f.roomCeilingHeights = { r: 100_000 }; })).not.toThrow();
  });

  it('drops a wall host whose wall is gone and keeps the item', () => {
    const project: any = twoRooms();
    project.floors[0].furniture = [
      item('o', 'sym_outlet', 0, 0, { elevation: 30, wallId: 'deleted', wallPosition: 0.5, wallSide: 1 }),
      item('s', 'sym_switch', 0, 0, { wallPosition: 0.5 } as Partial<FurnitureItem>),
      item('t', 'sym_switch', 0, 0, { wallId: 'a0' }),
    ];
    const read = readProject(project).floors[0].furniture;
    expect(read.map(f => [f.wallId, f.wallPosition, f.wallSide])).toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined], [undefined, undefined, undefined]]);
    expect(read[0].elevation).toBe(30);
  });

  it('migrates room metadata ceiling heights into the map, metadata winning', () => {
    const project: any = twoRooms(), floor = project.floors[0];
    floor.rooms = [
      { id: 'r1', name: 'A', walls: ['a0', 'a1', 'a2', 'a3'], floorTexture: 'hardwood', area: 12, details: { ceilingHeight: 255 } },
      { id: 'r2', name: 'B', walls: ['b0', 'b1', 'b2', 'b3'], floorTexture: 'hardwood', area: 6, details: { ceilingHeight: 240 } },
      { id: 'r3', name: 'C', walls: [], floorTexture: 'hardwood', area: 0, details: { ceilingHeight: null } },
      { id: 'r4', name: 'D', walls: [], floorTexture: 'hardwood', area: 0 },
    ];
    floor.roomCeilingHeights = { r2: 230, r3: 270, r4: 260 };
    const read = readProject(project);
    // r1 absent → copied; r2 differs → metadata wins; r3 cleared natively → removed; r4 has no metadata → kept.
    expect(read.floors[0].roomCeilingHeights).toEqual({ r2: 240, r4: 260, r1: 255 });
    expect(project.floors[0].roomCeilingHeights).toEqual({ r2: 230, r3: 270, r4: 260 });
    expect(readProject(read)).toEqual(read);
  });

  it('leaves files without ceiling metadata unchanged', () => {
    const project = twoRooms();
    project.floors[0].rooms = resolveRooms(project.floors[0]);
    expect('roomCeilingHeights' in readProject(project).floors[0]).toBe(false);
  });
});
