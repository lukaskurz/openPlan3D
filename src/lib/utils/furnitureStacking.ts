import type { FurnitureItem, Point } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize } from './furnitureCatalog';
import { furnitureMount } from './mounting';

/**
 * The stored height of the item's bottom above the floor, in centimetres. Ceiling
 * mounts store none (this returns 0); use `effectiveElevation` from mounting.ts
 * wherever the real height of every mount is needed.
 */
export function furnitureElevation(item: FurnitureItem): number {
  return typeof item.elevation === 'number' && Number.isFinite(item.elevation) && item.elevation > 0 ? item.elevation : 0;
}

export function furnitureContains(item: FurnitureItem, p: Point): boolean {
  const angle = -(item.rotation * Math.PI) / 180, dx = p.x - item.position.x, dy = p.y - item.position.y;
  const rx = dx * Math.cos(angle) - dy * Math.sin(angle), ry = dx * Math.sin(angle) + dy * Math.cos(angle);
  const size = getFurnitureSize(item);
  return Math.abs(rx) < size.width / 2 && Math.abs(ry) < size.depth / 2;
}

/** Top surface of the tallest larger 3D object under the item's centre, or 0 for the floor. */
export function surfaceBelow(item: FurnitureItem, furniture: FurnitureItem[]): number {
  const size = getFurnitureSize(item), area = size.width * size.depth;
  let top = 0;
  for (const other of furniture) {
    if (other.id === item.id || (getCatalogItem(other.catalogId)?.symbol && !other.customModelId)) continue;
    // Wall and ceiling mounts are not surfaces: a pendant over a table holds nothing up.
    if (furnitureMount(other) !== 'floor') continue;
    if (!furnitureContains(other, item.position)) continue;
    // Things rest on larger things: a TV on its stand, never the stand on the TV.
    const otherSize = getFurnitureSize(other);
    if (otherSize.width * otherSize.depth < area) continue;
    // Ignore objects hanging above this item, such as a shelf over a TV.
    if (furnitureElevation(other) >= furnitureElevation(item) + size.height / 2) continue;
    top = Math.max(top, furnitureElevation(other) + getFurnitureSize(other).height);
  }
  return top;
}

const MOUNT_RANK = { floor: 0, wall: 1, ceiling: 2 } as const;

/**
 * Draw order: floor items, then wall items, then ceiling items; within each, lower
 * objects first, so stacked and overhead items render (and hit-test) on top. Stable.
 */
export function byElevation(furniture: FurnitureItem[]): FurnitureItem[] {
  const rank = (item: FurnitureItem) => MOUNT_RANK[furnitureMount(item)];
  return furniture.some(item => furnitureElevation(item) > 0 || rank(item) > 0)
    ? furniture.map((item, index) => ({ item, index, rank: rank(item) }))
      .sort((a, b) => a.rank - b.rank || furnitureElevation(a.item) - furnitureElevation(b.item) || a.index - b.index).map(({ item }) => item)
    : furniture;
}
