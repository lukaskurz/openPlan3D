import { derived, get } from 'svelte/store';
import {
  selectedTool, placingStair, placingColumn, placingColumnShape, placingFurnitureId, placingEntourageId,
  placingDoorType, constraintPickMode, calibrationMode, activateMeasurementTool, elevationPickMode,
} from '$lib/stores/project';
import { catalogOpen, closePopover } from '$lib/stores/chrome';
import { selectMode } from '$lib/stores/planView';

/** The six tools in the strip. Each opens into its own options. */
export type ToolGroup = 'select' | 'wall' | 'openings' | 'structure' | 'annotate' | 'furniture';

export const toolGroup = derived(
  [selectedTool, placingStair, placingColumn, catalogOpen, placingFurnitureId],
  ([$tool, $stair, $column, $catalog, $placing]): ToolGroup => {
    if ($stair || $column) return 'structure';
    if ($tool === 'door' || $tool === 'window') return 'openings';
    if ($tool === 'measure' || $tool === 'annotate' || $tool === 'text') return 'annotate';
    if ($tool === 'furniture' || $catalog || $placing) return 'furniture';
    if ($tool === 'wall') return 'wall';
    return 'select';
  },
);

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
  switch (group) {
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
  placingColumnShape.set(shape);
  placingColumn.set(true);
  selectedTool.set('select');
}

export function placeStairs() {
  placingColumn.set(false);
  placingStair.set(true);
  selectedTool.set('select');
}

/** Done: back to Select with nothing armed. */
export function finishTool() {
  chooseGroup('select');
}
