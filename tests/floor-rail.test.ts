import { beforeEach, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Floor } from '$lib/models/types';
import { createDefaultFloor, loadProject, selectedElementId, selectedElementIds, selectedRoomId, selectedTool, panMode } from '$lib/stores/project';
import { activeSurface } from '$lib/stores/workContext';
import { railLabel, railStoreys } from '$lib/utils/floorRail';
import { switchSurface } from '$lib/components/chrome/surface';
import { roomProject } from './fixtures/project';

function floor(id: string, name: string, level?: number): Floor {
  const f = createDefaultFloor();
  f.id = id;
  f.name = name;
  if (level === undefined) delete (f as Partial<Floor>).level;
  else f.level = level;
  return f;
}

beforeEach(() => {
  loadProject(roomProject());
  activeSurface.set('floor');
});

it('labels storeys by the number in their name, G for the ground floor, otherwise the initial', () => {
  expect(railLabel('Floor 1', 1)).toBe('1');
  expect(railLabel('Level -1', -1)).toBe('-1');
  expect(railLabel('Ground Floor', 0)).toBe('G');
  expect(railLabel('Basement', -1)).toBe('B');
  expect(railLabel('  attic', 2)).toBe('A');
  expect(railLabel('   ', 3)).toBe('3');
});

it('orders the rail like the building, highest storey first, and marks the current one', () => {
  const floors = [floor('g', 'Ground', 0), floor('b', 'Basement', -1), floor('t', 'Top', 2), floor('f1', 'Floor 1', 1)];
  const rail = railStoreys(floors, 'f1');
  expect(rail.map(entry => entry.floor.id)).toEqual(['t', 'f1', 'g', 'b']);
  expect(rail.map(entry => entry.label)).toEqual(['T', '1', 'G', 'B']);
  expect(rail.filter(entry => entry.current).map(entry => entry.floor.id)).toEqual(['f1']);
  expect(rail.find(entry => entry.floor.id === 't')!.elevation).toBe(600);
});

it('keeps legacy floors without a level in their array order, and handles no or unknown active floor', () => {
  const floors = [floor('a', 'Ground', undefined), floor('b', 'Upper', undefined)];
  expect(railStoreys(floors, null).map(entry => entry.floor.id)).toEqual(['b', 'a']);
  expect(railStoreys(floors, 'missing').some(entry => entry.current)).toBe(false);
  expect(railStoreys([], 'a')).toEqual([]);
});

it('switches between floor and ceiling with the trade-switch clean-up', () => {
  selectedTool.set('wall');
  panMode.set(true);
  selectedElementId.set('w1');
  selectedElementIds.set(new Set(['w1', 'w2']));
  selectedRoomId.set('r1');

  expect(switchSurface('ceiling')).toBe(true);
  expect(get(activeSurface)).toBe('ceiling');
  expect(get(selectedTool)).toBe('select');
  expect(get(panMode)).toBe(false);
  expect(get(selectedElementId)).toBeNull();
  expect(get(selectedElementIds).size).toBe(0);
  expect(get(selectedRoomId)).toBeNull();

  // Tapping the surface already showing changes nothing.
  selectedElementId.set('w1');
  expect(switchSurface('ceiling')).toBe(false);
  expect(get(selectedElementId)).toBe('w1');

  expect(switchSurface('floor')).toBe(true);
  expect(get(activeSurface)).toBe('floor');
});
