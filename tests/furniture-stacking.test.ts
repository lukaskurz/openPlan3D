import { describe, expect, it } from 'vitest';
import { byElevation, furnitureElevation, surfaceBelow } from '$lib/utils/furnitureStacking';
import { findFurnitureAt } from '$lib/utils/hitTesting';
import { readProject } from '$lib/utils/projectValidation';
import { roomProject } from './fixtures/project';
import type { FurnitureItem } from '$lib/models/types';

const item = (id: string, catalogId: string, x: number, y: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x, y }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

describe('furniture stacking', () => {
  const stand = item('stand', 'tv_stand', 100, 100); // 150 × 45 × 50
  const tv = item('tv', 'television', 110, 100);

  it('finds the top of the object below the item centre', () => {
    expect(surfaceBelow(tv, [stand, tv])).toBe(50);
    expect(surfaceBelow(item('tv2', 'television', 300, 300), [stand])).toBe(0);
    const raised = { ...stand, elevation: 20 };
    expect(surfaceBelow(tv, [raised, tv])).toBe(70);
  });

  it('ignores objects hanging above the item and 2D-only symbols', () => {
    const shelf = item('shelf', 'bookshelf', 110, 100, { elevation: 150 });
    expect(surfaceBelow(tv, [stand, shelf, tv])).toBe(50);
    expect(surfaceBelow(tv, [item('rug', 'rug', 110, 100)])).toBe(1);
    // The stand never goes on top of the (smaller) TV standing on it.
    expect(surfaceBelow(stand, [stand, { ...tv, height: 200 }])).toBe(0);
  });

  it('draws and hit-tests elevated items on top', () => {
    const lifted = { ...tv, elevation: 50 };
    expect(byElevation([lifted, stand]).map(i => i.id)).toEqual(['stand', 'tv']);
    expect(findFurnitureAt({ x: 110, y: 100 }, [lifted, stand])?.id).toBe('tv');
    expect(furnitureElevation(item('x', 'sofa', 0, 0, { elevation: -5 }))).toBe(0);
  });

  it('validates saved elevations', () => {
    const project = roomProject();
    project.floors[0].furniture = [{ ...tv, elevation: 50 }];
    expect(readProject(project).floors[0].furniture[0].elevation).toBe(50);
    project.floors[0].furniture = [{ ...tv, elevation: -1 }];
    expect(() => readProject(project)).toThrow();
  });
});

describe('wall-hung catalog items', () => {
  it('places them at their mounting height, other items on the floor', async () => {
    const { get } = await import('svelte/store');
    const { activeFloor, addFurniture, createDefaultProject, currentProject } = await import('$lib/stores/project');
    currentProject.set(createDefaultProject());
    const lowboard = addFurniture('tv_lowboard', { x: 0, y: 0 });
    const sofa = addFurniture('sofa', { x: 300, y: 0 });
    const placed = (id: string) => get(activeFloor)!.furniture.find(f => f.id === id)!;
    expect(placed(lowboard).elevation).toBe(25);
    expect(placed(sofa)).not.toHaveProperty('elevation');
  });

  it('builds the lowboard model inside its catalog box', async () => {
    const THREE = await import('three');
    const { createFurnitureModel } = await import('$lib/utils/furnitureModels3d');
    const { getCatalogItem } = await import('$lib/utils/furnitureCatalog');
    const def = getCatalogItem('tv_lowboard')!;
    const size = new THREE.Box3().setFromObject(createFurnitureModel('tv_lowboard', def));
    expect(size.min.y).toBeGreaterThanOrEqual(0);
    expect(size.max.y).toBeCloseTo(def.height);
    expect(size.max.x - size.min.x).toBeCloseTo(def.width);
    expect(size.max.z - size.min.z).toBeCloseTo(def.depth);
  });
});

describe('mounts in stacking', () => {
  const table = item('table', 'dining_table', 100, 100); // 120 × 80 × 75
  const vase = item('vase', 'potted_plant', 100, 100);

  it('never rests anything on wall or ceiling mounts', () => {
    const hugeLight = item('light', 'ceiling_light', 100, 100, { width: 400, depth: 400 });
    expect(surfaceBelow(vase, [table, hugeLight, vase])).toBe(75);
    const wallShelf = item('shelf', 'dining_table', 100, 100, { mount: 'wall', elevation: 0 });
    expect(surfaceBelow(vase, [wallShelf, vase])).toBe(0);
  });

  it('draws floor items, then wall items, then ceiling items', () => {
    const pendant = item('pendant', 'pendant_light', 100, 100);
    const outlet = item('outlet', 'sym_outlet', 100, 100, { elevation: 30 });
    const lifted = item('lifted', 'tv_lowboard', 100, 100, { elevation: 120 });
    expect(byElevation([pendant, outlet, lifted, table]).map(i => i.id)).toEqual(['table', 'lifted', 'outlet', 'pendant']);
    expect(byElevation([pendant, table]).map(i => i.id)).toEqual(['table', 'pendant']);
  });
});
