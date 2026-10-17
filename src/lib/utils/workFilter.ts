import type { Floor, FurnitureItem, Surface, Trade } from '$lib/models/types';
import { furnitureTrade, type FurnitureDef } from './furnitureCatalog';
import { defSurface, itemSurface } from './mounting';

/**
 * What can be edited and how strongly things are drawn in the plan, for the trade
 * and surface being worked on (spec §4.1). Pure: pass the context in.
 *
 * The rules:
 * - Items belong to a trade (their catalog's, see `furnitureTrade`) and to a surface
 *   (ceiling mounts on the ceiling, floor and wall mounts on the floor, see `itemSurface`).
 * - An item is editable (hit-testable, selectable, draggable) when it is on the active
 *   surface and belongs to the active trade.
 * - Exception: **Furnishing on the ceiling edits the ceiling items of every trade.**
 *   The Furnishing ceiling tools (Light, Fan, Smoke detector) place electrical items,
 *   and the ceiling is planned as a whole there; Electrical and Plumbing on the ceiling
 *   stay strict to their own trade.
 * - Walls, doors, windows, rooms, stairs, columns and entourage are structure: always
 *   drawn, but editable only in Furnishing on the floor. On the ceiling surface a room
 *   can still be selected to set its ceiling height (the canvas handles that separately).
 * - Measurements, dimensions and text are editable in every trade and on both surfaces.
 * - Drawing: editable items at full strength, everything else at DIMMED_OPACITY, except
 *   that the ceiling surface shows the ceiling items of every trade at full strength.
 */

export interface WorkContext { trade: Trade; surface: Surface }

/** Opacity of items that belong to another trade or surface. */
export const DIMMED_OPACITY = 0.18;

/** Whether an item of this trade on this surface can be edited in the context. */
export function editableIn(trade: Trade, surface: Surface, ctx: WorkContext): boolean {
  if (surface !== ctx.surface) return false;
  return trade === ctx.trade || (ctx.trade === 'furnishing' && ctx.surface === 'ceiling');
}

/** A placed item can be hit-tested, selected and moved in this context. */
export function editableFurniture(item: Pick<FurnitureItem, 'catalogId' | 'mount'>, ctx: WorkContext): boolean {
  return editableIn(furnitureTrade(item), itemSurface(item), ctx);
}

/**
 * A catalog item placed now would be editable in this trade once the plan shows its
 * surface: placing it then needs a surface switch at most, not a trade switch.
 */
export function editableDef(def: FurnitureDef, trade: Trade): boolean {
  const surface = defSurface(def);
  return editableIn(furnitureTrade(def), surface, { trade, surface });
}

/** The trade to work in for placing this catalog item: the current one when it can edit it, else the item's own. */
export function tradeForPlacing(def: FurnitureDef, current: Trade): Trade {
  return editableDef(def, current) ? current : furnitureTrade(def);
}

/** Walls, openings, rooms, stairs, columns and entourage are edited only in Furnishing on the floor. */
export function structureEditable(ctx: WorkContext): boolean {
  return ctx.trade === 'furnishing' && ctx.surface === 'floor';
}

/** How strongly to draw an item in the plan: 1, or DIMMED_OPACITY. */
export function planOpacity(item: Pick<FurnitureItem, 'catalogId' | 'mount'>, ctx: WorkContext): number {
  if (ctx.surface === 'ceiling' && itemSurface(item) === 'ceiling') return 1;
  return editableFurniture(item, ctx) ? 1 : DIMMED_OPACITY;
}

/** Opacity for structure that is drawn but not editable (stairs, columns, entourage). */
export function structureOpacity(ctx: WorkContext): number {
  return structureEditable(ctx) ? 1 : DIMMED_OPACITY;
}

/**
 * The floor with only what can be selected in this context, for box select, select all
 * and copy: non-editable furniture is left out, and with structure not editable its
 * walls, openings, stairs, columns and entourage too. Measurements, dimensions, text
 * and everything else are kept as they are. Returns the same floor when nothing is left out.
 */
export function editablePlanFloor(floor: Floor, ctx: WorkContext): Floor {
  const furniture = floor.furniture.filter(item => editableFurniture(item, ctx));
  const structure = structureEditable(ctx);
  if (structure && furniture.length === floor.furniture.length) return floor;
  return structure
    ? { ...floor, furniture }
    : { ...floor, furniture, walls: [], doors: [], windows: [], stairs: [], columns: [], entourage: [] };
}
