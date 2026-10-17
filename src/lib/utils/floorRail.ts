import type { Floor } from '$lib/models/types';
import { floorElevations } from './floors';

export interface RailStorey {
  floor: Floor;
  level: number;
  elevation: number;
  /** Short label for the rail button: `G`, `1`, `B`… */
  label: string;
  current: boolean;
}

/** Short label for the rail: the number in the floor's name, G for the ground floor, otherwise its initial. */
export function railLabel(name: string, level: number): string {
  const digits = name.match(/-?\d+/)?.[0];
  if (digits) return digits;
  if (level === 0) return 'G';
  return name.trim().charAt(0).toUpperCase() || String(level);
}

/** The storeys as the floor rail shows them: highest at the top, like the building. */
export function railStoreys(floors: Floor[], activeId: string | null | undefined): RailStorey[] {
  return floorElevations(floors).reverse().map(({ floor, level, elevation }) => ({
    floor, level, elevation,
    label: railLabel(floor.name, level),
    current: floor.id === activeId,
  }));
}
