import type { FurnitureItem, Mount, Point, Surface } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize, type FurnitureDef } from './furnitureCatalog';

/**
 * How placed items are fixed (spec §4.2). Pure helpers, no stores.
 *
 * - floor:   `elevation` is the bottom above the floor (missing = 0).
 * - wall:    `elevation` is the mounting height; `wallId`/`wallPosition`/`wallSide` host it on a wall.
 * - ceiling: no stored elevation. The bottom is computed from the ceiling above the item:
 *            `ceiling − drop − height`, so a ceiling-height change moves the item.
 */

/** Mounting height for a wall item whose catalog entry names none, in cm. */
export const DEFAULT_WALL_MOUNT_HEIGHT = 105;

/** The ceiling height at the item: a fixed value in cm, or a resolver by plan point (see `createCeilingResolver`). */
export type CeilingAt = number | ((p: Point) => number);

type Mountable = Pick<FurnitureItem, 'catalogId' | 'mount'>;

/** The item's mount: its own, else its catalog definition's, else 'floor'. */
export function furnitureMount(item: Mountable): Mount {
  return item.mount ?? getCatalogItem(item.catalogId)?.mount ?? 'floor';
}

/** Ceiling items: distance from the ceiling to the item's top in cm (own `drop`, else the catalog's `defaultDrop`, else 0). Other mounts: 0. */
export function furnitureDrop(item: Pick<FurnitureItem, 'catalogId' | 'mount' | 'drop'>): number {
  if (furnitureMount(item) !== 'ceiling') return 0;
  const drop = item.drop ?? getCatalogItem(item.catalogId)?.defaultDrop ?? 0;
  return Number.isFinite(drop) && drop > 0 ? drop : 0;
}

/** The surface an item belongs to in the plan: ceiling mounts on the ceiling, everything else (floor and wall mounts) on the floor. */
export function itemSurface(item: Mountable): Surface {
  return furnitureMount(item) === 'ceiling' ? 'ceiling' : 'floor';
}

/** Surface a catalog definition is placed on (for switching the plan before placing). */
export function defSurface(def: Pick<FurnitureDef, 'mount'>): Surface {
  return def.mount === 'ceiling' ? 'ceiling' : 'floor';
}

/** The stored elevation (floor and wall items), clamped like `furnitureElevation`. */
function storedElevation(item: Pick<FurnitureItem, 'elevation'>): number {
  return typeof item.elevation === 'number' && Number.isFinite(item.elevation) && item.elevation > 0 ? item.elevation : 0;
}

/**
 * Height of the item's bottom above the floor in cm, for every mount. Ceiling items
 * hang at `ceiling − drop − height` (never below the floor), where the ceiling is
 * `ceilingAt` itself or `ceilingAt(item.position)`. Floor and wall items use their
 * stored `elevation` and ignore `ceilingAt`; a wall item saved without one (older
 * files) hangs at its catalog's mounting height.
 */
export function effectiveElevation(item: FurnitureItem, ceilingAt: CeilingAt): number {
  const mount = furnitureMount(item);
  if (mount === 'wall' && item.elevation === undefined) {
    const def = getCatalogItem(item.catalogId);
    return defaultMountingHeight({ mount: 'wall', elevation: def?.mount === 'wall' ? def.elevation : undefined }) ?? 0;
  }
  if (mount !== 'ceiling') return storedElevation(item);
  const ceiling = typeof ceilingAt === 'function' ? ceilingAt(item.position) : ceilingAt;
  return Math.max(0, ceiling - furnitureDrop(item) - getFurnitureSize(item).height);
}

/**
 * The `elevation` to store on a newly placed item of this definition: the catalog's
 * for floor items (none when 0), the catalog's or DEFAULT_WALL_MOUNT_HEIGHT for wall
 * items, and none for ceiling items (their height follows the ceiling).
 */
export function defaultMountingHeight(def: Pick<FurnitureDef, 'mount' | 'elevation'>): number | undefined {
  const mount = def.mount ?? 'floor';
  if (mount === 'ceiling') return undefined;
  if (mount === 'wall') return def.elevation !== undefined && def.elevation >= 0 ? def.elevation : DEFAULT_WALL_MOUNT_HEIGHT;
  return def.elevation && def.elevation > 0 ? def.elevation : undefined;
}
