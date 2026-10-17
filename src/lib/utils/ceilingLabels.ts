import type { Floor, Project, Room } from '$lib/models/types';
import { formatLength } from '$lib/stores/settings';
import { effectiveRoomCeiling, floorDefaultCeiling, type CeilingSummary } from './ceilingHeights';
import { furnitureMount } from './mounting';
import { furnitureTrade } from './furnitureCatalog';

/**
 * Text for ceiling heights in the ceiling plan (chips, status line, action slot).
 * Metric heights always show two decimals (`2.60 m`), as architects write them;
 * imperial ones use feet and inches.
 */
export function formatCeilingHeight(cm: number, units: 'metric' | 'imperial'): string {
  return units === 'imperial' ? formatLength(cm, units) : `${(cm / 100).toFixed(2)} m`;
}

/** `2.40–2.60 m`, or a single value when the range is one height. */
export function formatCeilingRange(min: number, max: number, units: 'metric' | 'imperial'): string {
  if (Math.round(min) === Math.round(max)) return formatCeilingHeight(min, units);
  if (units === 'imperial') return `${formatLength(min, units)}–${formatLength(max, units)}`;
  return `${(min / 100).toFixed(2)}–${(max / 100).toFixed(2)} m`;
}

/**
 * Like `ceilingSummary`, for rooms that are already resolved without their outlines
 * (the detected rooms the canvas publishes), so the status line needs no room detection.
 */
export function ceilingSummaryOfRooms(project: Pick<Project, 'floors'>, floor: Floor, rooms: readonly Pick<Room, 'id' | 'walls' | 'details'>[]): CeilingSummary {
  const lights = floor.furniture.filter(item => furnitureMount(item) === 'ceiling' && furnitureTrade(item) === 'electrical').length;
  const heights = rooms.map(room => effectiveRoomCeiling(project, floor, room));
  if (!heights.length) {
    const fallback = floorDefaultCeiling(project, floor);
    return { lights, min: fallback, max: fallback };
  }
  return { lights, min: Math.min(...heights), max: Math.max(...heights) };
}
