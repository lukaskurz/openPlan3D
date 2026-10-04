import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { get } from 'svelte/store';
import { activeFloor, addFurniture, createDefaultProject, currentProject } from '$lib/stores/project';
import { createFurnitureModel } from '$lib/utils/furnitureModels3d';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';

describe('ceiling projector', () => {
  it('hangs from a default 280 cm ceiling when placed', () => {
    currentProject.set(createDefaultProject());
    const id = addFurniture('ceiling_projector', { x: 0, y: 0 });
    const item = get(activeFloor)!.furniture.find(f => f.id === id)!;
    const def = getCatalogItem('ceiling_projector')!;
    expect(item.elevation! + def.height).toBe(280);
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
