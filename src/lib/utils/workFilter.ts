import type { Floor, FurnitureItem, Pipe, Surface, Trade } from '$lib/models/types';
import { furnitureTrade, isPlumbingFixture, type FurnitureDef } from './furnitureCatalog';
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
 * - Exception: **sanitary fixtures** (toilet, sinks, shower, bathtub, washer…, see
 *   `FurnitureDef.plumbingFixture`) stay Furnishing items but are also editable in
 *   Plumbing on the floor, so the Plumbing Fixture tool places them without a trade switch.
 * - Pipes belong to Plumbing and to the floor surface, or to the ceiling when they run
 *   under it: editable only there, dimmed everywhere else (`pipeEditable`).
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
  const surface = itemSurface(item);
  return editableIn(furnitureTrade(item), surface, ctx) || plumbingFixtureEditable(isPlumbingFixture(item), surface, ctx);
}

/** Plumbing on the floor also edits the sanitary fixtures standing there. */
function plumbingFixtureEditable(fixture: boolean, surface: Surface, ctx: WorkContext): boolean {
  return fixture && surface === 'floor' && ctx.trade === 'plumbing' && ctx.surface === 'floor';
}

/**
 * A catalog item placed now would be editable in this trade once the plan shows its
 * surface: placing it then needs a surface switch at most, not a trade switch.
 */
export function editableDef(def: FurnitureDef, trade: Trade): boolean {
  const surface = defSurface(def);
  const ctx = { trade, surface };
  return editableIn(furnitureTrade(def), surface, ctx) || plumbingFixtureEditable(isPlumbingFixture(def), surface, ctx);
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

/** The surface a pipe is drawn and edited on: the ceiling for ceiling runs, else the floor. */
export function pipeSurface(pipe: Pick<Pipe, 'run'>): Surface {
  return pipe.run === 'ceiling' ? 'ceiling' : 'floor';
}

/** Pipes are edited in Plumbing on their surface only. */
export function pipeEditable(pipe: Pick<Pipe, 'run'>, ctx: WorkContext): boolean {
  return ctx.trade === 'plumbing' && ctx.surface === pipeSurface(pipe);
}

/** How strongly to draw a pipe: 1 where it can be edited, else DIMMED_OPACITY. */
export function pipeOpacity(pipe: Pick<Pipe, 'run'>, ctx: WorkContext): number {
  return pipeEditable(pipe, ctx) ? 1 : DIMMED_OPACITY;
}

/** Opacity for structure that is drawn but not editable (stairs, columns, entourage). */
export function structureOpacity(ctx: WorkContext): number {
  return structureEditable(ctx) ? 1 : DIMMED_OPACITY;
}

/**
 * The floor with only what can be selected in this context, for box select, select all
 * and copy: non-editable furniture is left out, and with structure not editable its
 * walls, openings, stairs, columns and entourage too, and pipes outside Plumbing on their
 * surface. Measurements, dimensions, text
 * and everything else are kept as they are. Returns the same floor when nothing is left out.
 */
export function editablePlanFloor(floor: Floor, ctx: WorkContext): Floor {
  const furniture = floor.furniture.filter(item => editableFurniture(item, ctx));
  const pipes = floor.pipes?.filter(pipe => pipeEditable(pipe, ctx));
  const structure = structureEditable(ctx);
  if (structure && furniture.length === floor.furniture.length && pipes?.length === floor.pipes?.length) return floor;
  const kept = pipes === undefined ? { ...floor, furniture } : { ...floor, furniture, pipes };
  return structure
    ? kept
    : { ...kept, walls: [], doors: [], windows: [], stairs: [], columns: [], entourage: [] };
}
