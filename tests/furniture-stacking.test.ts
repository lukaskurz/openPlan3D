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
