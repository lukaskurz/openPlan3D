import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { get } from 'svelte/store';
import { activeFloor, addFurniture, createDefaultProject, currentProject, detectedRoomsStore, setRoomCeilingHeight } from '$lib/stores/project';
import { createFurnitureModel, createSymbolModel, SYMBOL_FACEPLATE, CEILING_SYMBOL_THICKNESS } from '$lib/utils/furnitureModels3d';
import { createFloorFurnitureModels, createPlacedFurnitureModel, FLOOR_FINISH } from '$lib/utils/furnitureModelLoader';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { createCeilingResolver } from '$lib/utils/ceilingHeights';
import { snapFurnitureToWalls } from '$lib/utils/furnitureGeometry';
import { resolveRooms, resolveRoomGeometry } from '$lib/utils/roomDetection';
import type { FurnitureItem, Wall } from '$lib/models/types';

/** A 400 × 300 room with the default 280 cm walls. */
function walls280(): Wall[] {
  const points = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  return points.map((start, i) => ({ id: `w${i}`, start, end: points[(i + 1) % 4], thickness: 15, height: 280, color: '#eeeeee' }));
}

const box = (object: THREE.Object3D) => { object.updateMatrixWorld(true); return new THREE.Box3().setFromObject(object); };
const item = (catalogId: string, x = 200, y = 150, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id: catalogId, catalogId, position: { x, y }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

describe('a pendant over a table in 3D', () => {
  beforeEach(() => {
    const project = createDefaultProject();
    project.floors[0].walls = walls280();
    currentProject.set(project);
    detectedRoomsStore.set(resolveRooms(project.floors[0]));
  });

  /** What the 3D build does: resolve rooms once, build the resolver, place every item. */
  function build() {
    const project = get(currentProject)!, floor = get(activeFloor)!;
    const ceilingAt = createCeilingResolver(project, floor, resolveRoomGeometry(floor));
    const models = createFloorFurnitureModels(floor, ceilingAt, project);
    return new Map(floor.furniture.map((placed, i) => [placed.catalogId, models[i]]));
  }

  it('hangs at ceiling − drop − height with its cord reaching the ceiling, above the table', () => {
    addFurniture('dining_table', { x: 200, y: 150 });
    addFurniture('pendant_light', { x: 200, y: 150 });
    const models = build();
    const pendant = models.get('pendant_light')!, table = models.get('dining_table')!;
    const def = getCatalogItem('pendant_light')!;
    expect(pendant.position.y).toBe(280 - 60 - def.height);
    expect(box(pendant).max.y).toBeCloseTo(280);
    expect(box(table).max.y).toBeCloseTo(FLOOR_FINISH + 75);
    expect(box(pendant).min.y).toBeGreaterThan(box(table).max.y);
  });

  it('follows a change of the room\'s ceiling height', () => {
    addFurniture('pendant_light', { x: 200, y: 150 });
    const room = get(detectedRoomsStore)[0];
    setRoomCeilingHeight(room.id, 250);
    let pendant = build().get('pendant_light')!;
    expect(pendant.position.y).toBe(250 - 60 - 30);
    expect(box(pendant).max.y).toBeCloseTo(250);
    setRoomCeilingHeight(room.id, undefined);
    pendant = build().get('pendant_light')!;
    expect(pendant.position.y).toBe(280 - 60 - 30);
  });

  it('uses the item\'s own drop and keeps the cord its real length when the item is scaled', () => {
    const id = addFurniture('pendant_light', { x: 200, y: 150 });
    const floor = get(activeFloor)!, placed = floor.furniture.find(f => f.id === id)!;
    const scaled = { ...placed, drop: 20, scale: { x: 2, y: 2, z: 2 } };
    const model = createFloorFurnitureModels({ furniture: [scaled] }, 280)[0];
    expect(model.position.y).toBe(280 - 20 - 60);
    const bounds = box(model);
    expect(bounds.min.y).toBeCloseTo(200);
    expect(bounds.max.y).toBeCloseTo(280);
  });

  it('puts a flush ceiling light against the ceiling with no cord', () => {
    addFurniture('ceiling_light', { x: 200, y: 150 });
    const light = build().get('ceiling_light')!;
    expect(light.getObjectByName('ceiling_cord')).toBeUndefined();
    expect(box(light).max.y).toBeCloseTo(280);
    expect(box(light).min.y).toBeCloseTo(280 - getCatalogItem('ceiling_light')!.height);
  });
});

describe('ceiling fixtures are built in their own box [0, h]', () => {
  for (const id of ['ceiling_light', 'chandelier', 'recessed_light', 'pendant_light', 'ceiling_fan', 'smoke_detector']) {
    it(id, () => {
      const def = getCatalogItem(id)!;
      const bounds = box(createFurnitureModel(id, def));
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.max.y).toBeCloseTo(def.height); // the top meets the ceiling (or the cord)
      expect(bounds.max.x).toBeLessThanOrEqual(def.width / 2 + 1e-6);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-def.width / 2 - 1e-6);
      expect(bounds.max.z).toBeLessThanOrEqual(def.depth / 2 + 1e-6);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-def.depth / 2 - 1e-6);
    });
  }

  it('the fan has five blades spanning nearly its full width and a light below', () => {
    const def = getCatalogItem('ceiling_fan')!;
    const fan = createFurnitureModel('ceiling_fan', def);
    expect(box(fan).getSize(new THREE.Vector3()).x).toBeGreaterThan(def.width * 0.9);
    const lights: THREE.Light[] = [];
    fan.traverse(child => { if (child instanceof THREE.Light) lights.push(child); });
    expect(lights).toHaveLength(1);
    expect(lights[0].position.y).toBeLessThanOrEqual(0);
  });
});

describe('plan symbols in 3D', () => {
  it('builds outlet and switch faceplates within [0, plate height], back at −depth/2', () => {
    for (const id of ['sym_outlet', 'sym_switch']) {
      const bounds = box(createSymbolModel(id, getCatalogItem(id)!)!);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.max.y).toBeLessThanOrEqual(SYMBOL_FACEPLATE.height + 1e-6);
      expect(bounds.min.z).toBeCloseTo(-SYMBOL_FACEPLATE.depth / 2);
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(SYMBOL_FACEPLATE.width);
    }
  });

  it('builds ceiling symbols as a thin disc and nothing for other symbols', () => {
    for (const id of ['sym_ceiling_light', 'sym_recessed_light', 'sym_pendant', 'sym_ceiling_fan', 'sym_smoke']) {
      const bounds = box(createSymbolModel(id, getCatalogItem(id)!)!);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.y).toBeCloseTo(CEILING_SYMBOL_THICKNESS);
    }
    for (const id of ['sym_junction', 'sym_drain', 'sym_gas_line']) {
      expect(createSymbolModel(id, getCatalogItem(id)!)).toBeNull();
      expect(createPlacedFurnitureModel(item(id), undefined, undefined, 0)).toBeNull();
    }
  });

  it('mounts an outlet on the wall at its height, facing away from the wall on either side', () => {
    const wall: Wall = { id: 'w', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 15, height: 280, color: '#eee' };
    const def = getCatalogItem('sym_outlet')!;
    for (const [y, sign] of [[20, 1], [-20, -1]] as const) {
      const snap = snapFurnitureToWalls({ x: 200, y }, def, [wall])!;
      const outlet = item('sym_outlet', snap.position.x, snap.position.y, { rotation: snap.rotation });
      const bounds = box(createPlacedFurnitureModel(outlet, undefined, undefined, 30)!);
      // Centred on its mounting height above the floor finish
      expect((bounds.min.y + bounds.max.y) / 2).toBeCloseTo(FLOOR_FINISH + 30);
      // The back sits on the wall face (half the thickness from the wall's line); the sockets stand proud of the plate
      const back = sign > 0 ? bounds.min.z : -bounds.max.z, front = sign > 0 ? bounds.max.z : -bounds.min.z;
      expect(back).toBeCloseTo(wall.thickness / 2);
      expect(front).toBeGreaterThan(wall.thickness / 2 + SYMBOL_FACEPLATE.depth);
      expect(Math.abs((bounds.min.x + bounds.max.x) / 2 - 200)).toBeLessThan(1e-6);
    }
  });

  it('puts a ceiling symbol just under the ceiling', () => {
    const smoke = createPlacedFurnitureModel(item('sym_smoke'), undefined, undefined, 250)!;
    const bounds = box(smoke);
    expect(bounds.max.y).toBeCloseTo(250);
    expect(bounds.min.y).toBeCloseTo(250 - CEILING_SYMBOL_THICKNESS);
  });
});
