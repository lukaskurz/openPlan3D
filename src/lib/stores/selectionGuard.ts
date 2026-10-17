import { derived, get } from 'svelte/store';
import { activeFloor, elevationWallId, selectedElementId, selectedElementIds } from './project';
import { activeTrade, activeSurface } from './workContext';
import { selectableInContext } from '$lib/utils/editableSelection';

/**
 * Keep the selection to what the current trade and surface may edit (spec §4.1). Switching
 * trade or surface already clears it; this catches the other ways an element of another
 * trade gets selected: Undo restoring an older selection, the layers list, an inspector
 * link. A stale selection would otherwise still be moved, rotated or deleted (Delete key,
 * action slot) from a trade that cannot see it. The wall elevation edits its own wall and
 * openings, so the guard rests while it is open. Side-effect module: import it once.
 */
derived([selectedElementId, selectedElementIds, activeTrade, activeSurface, activeFloor, elevationWallId],
  values => values).subscribe(([id, ids, trade, surface, floor, elevation]) => {
  if (!floor || elevation) return;
  const ctx = { trade, surface };
  if (id && !selectableInContext(floor, id, ctx)) selectedElementId.set(null);
  if (ids.size && [...ids].some(member => !selectableInContext(floor, member, ctx))) {
    const kept = new Set([...ids].filter(member => selectableInContext(floor, member, ctx)));
    selectedElementIds.set(kept.size >= 2 ? kept : new Set());
    if (kept.size && !get(selectedElementId)) selectedElementId.set(kept.values().next().value!);
  }
});
