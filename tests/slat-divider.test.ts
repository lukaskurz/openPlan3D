import { expect, it } from 'vitest';
import * as THREE from 'three';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { createFurnitureModel } from '$lib/utils/furnitureModels3d';
import { dividerLayout } from '$lib/utils/furnitureIcons';

const boxes = (group: THREE.Group) => group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry instanceof THREE.BoxGeometry);
const size = (group: THREE.Group) => new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());

it('lays out a module like the Embrace BM1 drawing: 7 slats with 7.8 cm gaps on 8 cm feet', () => {
  const L = dividerLayout(71.6, 245, 7);
  expect(L.posts).toHaveLength(1);
  expect(L.posts[0][0]).toBeCloseTo(-31.8);
  expect(L.posts[0][1]).toBeCloseTo(31.8);
  const gaps = L.profiles.slice(1).map((x, i) => x - L.profiles[i] - 2.8);
  for (const gap of gaps) expect(gap).toBeCloseTo(7.8, 1);
  expect(L.block).toBe(230);
  expect(L.gap).toBeCloseTo(7.5);
});

it('joins modules without a visible seam', () => {
  const L = dividerLayout(143.2, 245, 7);
  expect(L.modules).toBe(2);
  // The end slats of neighbouring modules stand on touching feet, 8 cm apart: close to the 10.6 cm slat pitch.
  expect(L.posts[1][0] - L.posts[0][1]).toBeCloseTo(8);
});

it('builds a floor-to-ceiling slat divider that fills its footprint', () => {
  const def = getCatalogItem('slat_divider')!;
  expect(def).toMatchObject({ width: 71.6, depth: 8, height: 245 });
  const model = createFurnitureModel('slat_divider', def);
  expect(boxes(model)).toHaveLength(7);
  expect(boxes(createFurnitureModel('slat_divider', { ...def, width: 143.2 }))).toHaveLength(14);
  const s = size(model);
  expect(s.x).toBeCloseTo(71.6);
  expect(s.y).toBeCloseTo(245);
  expect(s.z).toBeCloseTo(8);
});

it('hangs three shelves in front of the shelf divider posts', () => {
  const def = getCatalogItem('shelf_divider')!;
  const model = createFurnitureModel('shelf_divider', def);
  const shelves = boxes(model).filter(mesh => (mesh.geometry as THREE.BoxGeometry).parameters.width === 65.8);
  expect(shelves).toHaveLength(3);
  // Shelves start above sideboard height.
  expect(Math.min(...shelves.map(mesh => mesh.position.y))).toBeGreaterThan(100);
  const s = size(model);
  expect(s.x).toBeCloseTo(71.6);
  expect(s.z).toBeCloseTo(20);
});
