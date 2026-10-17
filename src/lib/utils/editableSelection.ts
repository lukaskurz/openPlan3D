import type { Floor } from '$lib/models/types';
import { editableFurniture, pipeEditable, structureEditable, type WorkContext } from './workFilter';

/**
 * Whether a selected element can stay selected while working on this trade and surface
 * (spec §4.1): furniture of another trade or surface, structure outside Furnishing on the
 * floor, pipes outside Plumbing and switch links outside Electrical cannot. Ids that are
 * not on the floor (measurements, notes, guides, rooms…) are left alone.
 */
export function selectableInContext(floor: Floor, id: string, ctx: WorkContext): boolean {
  const item = floor.furniture.find(fi => fi.id === id);
  if (item) return editableFurniture(item, ctx);
  const structure = [floor.walls, floor.doors, floor.windows, floor.stairs ?? [], floor.columns ?? [], floor.entourage ?? []];
  if (structure.some(items => items.some(element => element.id === id))) return structureEditable(ctx);
  const pipe = floor.pipes?.find(p => p.id === id);
  if (pipe) return pipeEditable(pipe, ctx);
  if (floor.switchLinks?.some(link => link.id === id)) return ctx.trade === 'electrical';
  return true;
}
