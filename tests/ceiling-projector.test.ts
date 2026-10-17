import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { get } from 'svelte/store';
import { activeFloor, addFurniture, createDefaultProject, currentProject, detectedRoomsStore, setRoomCeilingHeight } from '$lib/stores/project';
import { createFurnitureModel } from '$lib/utils/furnitureModels3d';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { effectiveElevation, furnitureMount } from '$lib/utils/mounting';
import { createCeilingResolver } from '$lib/utils/ceilingHeights';
import { resolveRooms } from '$lib/utils/roomDetection';
import type { Wall } from '$lib/models/types';

/** A 400 × 300 room with the default 280 cm walls. */
function walls280(): Wall[] {
  const points = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }];
  return points.map((start, i) => ({ id: `w${i}`, start, end: points[(i + 1) % 4], thickness: 15, height: 280, color: '#eeeeee' }));
}

describe('ceiling projector', () => {
  beforeEach(() => {
    const project = createDefaultProject();
    project.floors[0].walls = walls280();
    currentProject.set(project);
    detectedRoomsStore.set(resolveRooms(project.floors[0]));
  });

  const elevationOf = (id: string) => {
    const project = get(currentProject)!, floor = get(activeFloor)!;
    const item = floor.furniture.find(f => f.id === id)!;
    return effectiveElevation(item, createCeilingResolver(project, floor));
  };

  it('is a ceiling mount that stores no elevation and hangs with its top at a 280 cm ceiling', () => {
    const id = addFurniture('ceiling_projector', { x: 200, y: 150 });
    const item = get(activeFloor)!.furniture.find(f => f.id === id)!;
    const def = getCatalogItem('ceiling_projector')!;
    expect(furnitureMount(item)).toBe('ceiling');
    expect(item.elevation).toBeUndefined();
    expect(def.elevation).toBeUndefined();
    // The same place as the former fixed elevation of 245 cm.
    expect(elevationOf(id)).toBe(245);
    expect(elevationOf(id) + def.height + (def.defaultDrop ?? 0)).toBe(280);
  });

  it('follows the room when its ceiling height changes', () => {
    const id = addFurniture('ceiling_projector', { x: 200, y: 150 });
    const room = get(detectedRoomsStore)[0];
    setRoomCeilingHeight(room.id, 250);
    expect(elevationOf(id)).toBe(250 - 35);
    setRoomCeilingHeight(room.id, undefined);
    expect(elevationOf(id)).toBe(245);
  });

  it('builds the model inside its catalog box with the lens at the front', () => {
    const def = getCatalogItem('ceiling_projector')!;
    const model = createFurnitureModel('ceiling_projector', def);
    const size = new THREE.Box3().setFromObject(model);
    expect(size.min.y).toBeGreaterThanOrEqual(0);
    expect(size.max.y).toBeCloseTo(def.height);
    expect(size.max.x - size.min.x).toBeLessThanOrEqual(def.width + 0.01);
    // The lens protrudes past the body at the front (+Z); nothing sticks out at the back
    expect(size.max.z).toBeGreaterThan(def.depth / 2);
    expect(size.min.z).toBeGreaterThanOrEqual(-def.depth / 2 - 0.5);
  });
});
