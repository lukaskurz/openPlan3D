import { describe, expect, it } from 'vitest';
import type { Floor, FurnitureItem, PlanSection, Room } from '$lib/models/types';
import { translate } from '$lib/i18n';
import { furnitureName } from '$lib/i18n/furnitureNames';
import { contextForElement, elementGroups, filterElementGroups, furnitureGroup, roomGroups, type ElementsListOptions } from '$lib/utils/elementsList';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';
import { roomProject } from './fixtures/project';

const item = (id: string, catalogId: string, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

function plan(): Floor {
  const floor = roomProject().floors[0];
  floor.doors = [{ id: 'door', wallId: 'a-0', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }];
  floor.windows = [{ id: 'window', wallId: 'a-2', position: 0.5, width: 120, height: 120, sillHeight: 90, type: 'casement' }];
  floor.furniture = [
    item('sofa', 'sofa'),
    item('pendant', 'pendant_light', { mount: 'ceiling' }),
    item('lamp', 'floor_lamp'),
    item('outlet', 'sym_outlet', { mount: 'wall', wallId: 'a-1', wallPosition: 0.5, wallSide: 1, elevation: 30 }),
    item('smoke', 'smoke_detector'),
    item('toilet', 'toilet'),
    item('drain', 'sym_drain'),
    item('tree', 'tree_oak'),
  ];
  floor.pipes = [{ id: 'pipe', kind: 'cold', diameter: 20, points: [{ x: 0, y: 0 }, { x: 420, y: 0 }], run: 'floor' }];
  floor.measurements = [{ id: 'measure', x1: 0, y1: 0, x2: 0, y2: 250 }];
  floor.textAnnotations = [{ id: 'note', x: 0, y: 0, text: '  Check\nthe  slope ', fontSize: 14, color: '#000000', rotation: 0 }];
  return floor;
}

const rooms: ElementsListOptions['rooms'] = [{ room: { id: 'room', name: 'Kitchen', walls: [], floorTexture: 'wood', area: 12 } as Room, polygon: [] }];
const sections: PlanSection[] = [{ id: 'cut', code: 'A', start: { x: 0, y: 0 }, end: { x: 300, y: 0 }, look: 1 }];
const options: ElementsListOptions = {
  t: (key, variables) => translate('en', key, variables),
  units: 'metric',
  rooms,
  sections,
  furnitureLabel: fi => furnitureName(fi.catalogId, 'en'),
  entourageLabel: (_, i) => `Plant ${i + 1}`,
};

const group = (floor: Floor, key: string) => elementGroups(floor, options).find(g => g.key === key);
const ids = (floor: Floor, key: string) => group(floor, key)?.entries.map(entry => entry.id);

describe('elements list', () => {
  it('lists every element of the storey in its group, leaving empty groups out', () => {
    const floor = plan();
    expect(elementGroups(floor, options).map(g => g.key)).toEqual([
      'walls', 'doors', 'windows', 'rooms', 'furniture', 'lights', 'electrical', 'plumbing', 'outdoor', 'sections', 'measurements', 'notes',
    ]);
    expect(ids(floor, 'walls')).toEqual(['a-0', 'a-1', 'a-2', 'a-3']);
    expect(ids(floor, 'furniture')).toEqual(['sofa']);
    expect(ids(floor, 'lights')).toEqual(['pendant', 'lamp']);
    expect(ids(floor, 'electrical')).toEqual(['outlet', 'smoke']);
    expect(ids(floor, 'plumbing')).toEqual(['toilet', 'drain', 'pipe']);
    expect(ids(floor, 'outdoor')).toEqual(['tree']);
  });

  it('names elements and describes them by size, type and place', () => {
    const floor = plan();
    expect(group(floor, 'walls')!.entries[0]).toMatchObject({ name: 'Wall 1', detail: '4 m · 15 cm thick' });
    expect(group(floor, 'doors')!.entries[0]).toMatchObject({ name: 'Door 1', detail: 'Single · 90 cm · Wall 1' });
    expect(group(floor, 'windows')!.entries[0]).toMatchObject({ name: 'Window 1', detail: 'Casement · 1.2 m · Wall 3' });
    expect(group(floor, 'rooms')!.entries[0]).toMatchObject({ name: 'Kitchen', detail: '12.0 m²', room: true });
    expect(group(floor, 'furniture')!.entries[0]).toMatchObject({ name: 'Sofa', detail: '200 × 90 cm', icon: 'sofa' });
    expect(group(floor, 'lights')!.entries[0]).toMatchObject({ name: 'Pendant Light', detail: 'On the ceiling', icon: 'bulb' });
    expect(group(floor, 'electrical')!.entries[0]).toMatchObject({ name: 'Power Outlet', detail: 'At 30 cm · Wall 2', icon: 'outlet' });
    expect(group(floor, 'plumbing')!.entries[2]).toMatchObject({ name: 'Cold pipe', detail: '20 mm · 4.2 m', icon: 'pipeRun' });
    expect(group(floor, 'sections')!.entries[0]).toMatchObject({ name: 'Section A', detail: '3 m' });
    expect(group(floor, 'notes')!.entries[0]).toMatchObject({ name: 'Check the slope' });
  });

  it('gives the groups the plan can hide a layer to switch', () => {
    const floor = plan();
    expect(group(floor, 'walls')!.layer).toBe('walls');
    expect(group(floor, 'notes')!.layer).toBe('textAnnotations');
    expect(group(floor, 'furniture')!.layer).toBeUndefined();
    expect(group(floor, 'rooms')!.layer).toBeUndefined();
  });

  it('marks locked furniture', () => {
    const floor = plan();
    floor.furniture[0].locked = true;
    expect(group(floor, 'furniture')!.entries[0].locked).toBe(true);
  });

  it('keeps light fittings apart from the rest of Electrical and sanitary fixtures with Plumbing', () => {
    expect(furnitureGroup({ catalogId: 'sym_recessed_light' })).toBe('lights');
    expect(furnitureGroup({ catalogId: 'wall_sconce_outdoor' })).toBe('lights');
    expect(furnitureGroup({ catalogId: 'ceiling_fan' })).toBe('electrical');
    expect(furnitureGroup({ catalogId: 'sink_k' })).toBe('plumbing');
    expect(furnitureGroup({ catalogId: 'unknown_custom' })).toBe('furniture');
  });

  it('filters by the query as a phrase, else by every word of it, over names, details and group labels', () => {
    const groups = elementGroups(plan(), options);
    expect(filterElementGroups(groups, '').length).toBe(groups.length);
    expect(filterElementGroups(groups, 'wall 3').flatMap(g => g.entries.map(entry => entry.id))).toEqual(['a-2', 'window']);
    expect(filterElementGroups(groups, 'cold 20').flatMap(g => g.entries.map(entry => entry.id))).toEqual(['pipe']);
    expect(filterElementGroups(groups, 'LIGHTS').flatMap(g => g.entries.map(entry => entry.id))).toEqual(['pendant', 'lamp']);
    expect(filterElementGroups(groups, 'nothing like this')).toEqual([]);
  });
});

describe('selecting from the elements list', () => {
  const furnishingFloor = { trade: 'furnishing', surface: 'floor' } as const;

  it('stays in the current trade and surface when they can select the element', () => {
    const floor = plan();
    for (const id of ['a-0', 'door', 'sofa', 'lamp', 'toilet', 'measure', 'note', 'cut']) expect(contextForElement(floor, id, furnishingFloor)).toBeNull();
    expect(contextForElement(floor, 'toilet', { trade: 'plumbing', surface: 'floor' })).toBeNull();
  });

  it("switches to the element's trade and surface when they cannot", () => {
    const floor = plan();
    expect(contextForElement(floor, 'outlet', furnishingFloor)).toEqual({ trade: 'electrical', surface: 'floor' });
    expect(contextForElement(floor, 'pipe', furnishingFloor)).toEqual({ trade: 'plumbing', surface: 'floor' });
    expect(contextForElement(floor, 'a-0', { trade: 'electrical', surface: 'ceiling' })).toEqual({ trade: 'furnishing', surface: 'floor' });
    expect(contextForElement(floor, 'sofa', { trade: 'plumbing', surface: 'floor' })).toEqual({ trade: 'furnishing', surface: 'floor' });
  });

  it('keeps Furnishing for a ceiling item, which Furnishing edits on the ceiling', () => {
    const floor = plan();
    expect(contextForElement(floor, 'pendant', furnishingFloor)).toEqual({ trade: 'furnishing', surface: 'ceiling' });
    expect(contextForElement(floor, 'pendant', { trade: 'electrical', surface: 'floor' })).toEqual({ trade: 'electrical', surface: 'ceiling' });
    expect(contextForElement(floor, 'pendant', { trade: 'plumbing', surface: 'floor' })).toEqual({ trade: 'electrical', surface: 'ceiling' });
  });
});

describe('elements by room', () => {
  /** The plan split by a wall at x = 200 into Kitchen (left) and Bath (right), with a tree outside. */
  function splitPlan() {
    const floor = plan();
    floor.walls.push({ id: 'mid', start: { x: 200, y: 0 }, end: { x: 200, y: 300 }, thickness: 10, height: 250, color: '#eeeeee' });
    floor.furniture = [
      item('sofa', 'sofa', { position: { x: 100, y: 150 } }),
      item('pendant', 'pendant_light', { mount: 'ceiling', position: { x: 100, y: 100 } }),
      item('toilet', 'toilet', { position: { x: 300, y: 150 } }),
      // On the dividing wall, facing right (side −1), with a stale position on the left: the face decides.
      item('outlet', 'sym_outlet', { mount: 'wall', wallId: 'mid', wallPosition: 0.5, wallSide: -1, elevation: 30, position: { x: 190, y: 150 } }),
      item('tree', 'tree_oak', { position: { x: 700, y: 150 } }),
    ];
    const faces = resolveRoomGeometry(floor).map(face => {
      const x = face.polygon.reduce((sum, p) => sum + p.x, 0) / face.polygon.length;
      return { ...face, room: { ...face.room, name: x < 200 ? 'Kitchen' : 'Bath' } };
    });
    return { floor, faces, groups: roomGroups(floor, { ...options, rooms: faces }) };
  }
  const roomId = (faces: ReturnType<typeof splitPlan>['faces'], name: string) => faces.find(face => face.room.name === name)!.room.id;

  it('lists each room with what is in it, in alphabetical order, then what is in no room', () => {
    const { faces, groups } = splitPlan();
    expect(groups.slice(0, 3).map(g => g.label)).toEqual(['Bath', 'Kitchen', 'Outside rooms']);
    const content = (name: string) => groups.find(g => g.label === name)!.entries.map(entry => entry.id);
    expect(content('Kitchen')).toEqual(['sofa', 'pendant']);
    // Within a room: furniture, lights, electrical, plumbing… whatever order they were placed in.
    expect(content('Bath')).toEqual(['outlet', 'toilet']);
    expect(content('Outside rooms')).toEqual(['tree']);
    expect(groups[1]).toMatchObject({ key: `room:${roomId(faces, 'Kitchen')}`, room: { id: roomId(faces, 'Kitchen') } });
  });

  it('lists walls, doors, windows and pipe runs once, in groups of their own', () => {
    const { groups } = splitPlan();
    expect(groups.slice(3).map(g => g.key)).toEqual(['walls', 'doors', 'windows', 'pipes', 'sections', 'measurements', 'notes']);
    const all = groups.flatMap(g => g.entries.map(entry => entry.id));
    expect(new Set(all).size).toBe(all.length);
    expect(groups.find(g => g.key === 'pipes')!.entries.map(entry => entry.id)).toEqual(['pipe']);
  });

  it('shows an empty room so it can still be picked, and finds it by name', () => {
    const { floor, faces } = splitPlan();
    floor.furniture = [];
    const groups = roomGroups(floor, { ...options, rooms: faces });
    expect(groups.find(g => g.label === 'Kitchen')!.entries).toEqual([]);
    expect(filterElementGroups(groups, 'kitchen').map(g => g.label)).toEqual(['Kitchen']);
  });
});
