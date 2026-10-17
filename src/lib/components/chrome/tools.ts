import { derived, get } from 'svelte/store';
import {
  selectedTool, placingStair, placingColumn, placingColumnShape, placingFurnitureId, placingEntourageId,
  placingDoorType, constraintPickMode, calibrationMode, activateMeasurementTool, elevationPickMode, panMode,
} from '$lib/stores/project';
import { catalogOpen, closePopover } from '$lib/stores/chrome';
import { selectMode } from '$lib/stores/planView';

/**
 * The tools in the strip. View moves around and taps to look at things without
 * dragging anything; Select edits. The drawing tools open into their own options.
 */
export type ToolGroup = 'view' | 'select' | 'wall' | 'openings' | 'structure' | 'annotate' | 'furniture';

export const toolGroup = derived(
  [selectedTool, placingStair, placingColumn, catalogOpen, placingFurnitureId, panMode],
  ([$tool, $stair, $column, $catalog, $placing, $pan]): ToolGroup => {
    if ($stair || $column) return 'structure';
    if ($tool === 'door' || $tool === 'window') return 'openings';
    if ($tool === 'measure' || $tool === 'annotate' || $tool === 'text') return 'annotate';
    if ($tool === 'furniture' || $catalog || $placing) return 'furniture';
    if ($tool === 'wall') return 'wall';
    return $pan ? 'view' : 'select';
  },
);

/** View or Select, whichever the person last chose: where Done goes back to. */
let homeGroup: 'view' | 'select' = 'select';

/** Touch screens start in View, so moving around the plan never drags a wall by accident. */
export function startingGroup(): 'view' | 'select' {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'view' : 'select';
}

/** Leave every placing mode so the next tool starts clean. */
export function clearPlacing() {
  placingStair.set(false);
  placingColumn.set(false);
  placingFurnitureId.set(null);
  placingEntourageId.set(null);
  constraintPickMode.set(null);
  calibrationMode.set(false);
  elevationPickMode.set(false);
}

export function chooseGroup(group: ToolGroup) {
  closePopover();
  if (group !== 'furniture') catalogOpen.set(false);
  panMode.set(group === 'view');
  if (group === 'view' || group === 'select') homeGroup = group;
  switch (group) {
    case 'view':
      clearPlacing();
      selectMode.set('tap');
      selectedTool.set('select');
      break;
    case 'select':
      clearPlacing();
      selectMode.set('tap');
      selectedTool.set('select');
      break;
    case 'wall':
      clearPlacing();
      selectedTool.set('wall');
      break;
    case 'openings':
      clearPlacing();
      selectedTool.set(get(placingDoorType) === 'opening' ? 'door' : get(selectedTool) === 'window' ? 'window' : 'door');
      break;
    case 'structure':
      clearPlacing();
      selectedTool.set('select');
      placingStair.set(true);
      break;
    case 'annotate':
      clearPlacing();
      activateMeasurementTool('measure');
      break;
    case 'furniture':
      clearPlacing();
      selectedTool.set('select');
      catalogOpen.set(true);
      break;
  }
}

export function placeColumn(shape: 'round' | 'square') {
  placingStair.set(false);
  panMode.set(false);
  placingColumnShape.set(shape);
  placingColumn.set(true);
  selectedTool.set('select');
}

export function placeStairs() {
  placingColumn.set(false);
  panMode.set(false);
  placingStair.set(true);
  selectedTool.set('select');
}

/** Done: back to View or Select with nothing armed. */
export function finishTool() {
  chooseGroup(homeGroup);
}
