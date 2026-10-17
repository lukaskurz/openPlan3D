import { get } from 'svelte/store';
import { activeSurface, type Surface } from '$lib/stores/workContext';
import { selectedElementId, selectedElementIds, selectedRoomId } from '$lib/stores/project';
import { chooseGroup } from './tools';

/**
 * Switch between the current storey's floor and ceiling (spec §5.2): the same
 * clean-up as a trade switch, so nothing selected or half-placed on one surface
 * carries over to the other. Returns false when that surface was already showing.
 */
export function switchSurface(surface: Surface): boolean {
  if (get(activeSurface) === surface) return false;
  activeSurface.set(surface);
  chooseGroup('select');
  selectedElementId.set(null);
  selectedElementIds.set(new Set());
  selectedRoomId.set(null);
  return true;
}
