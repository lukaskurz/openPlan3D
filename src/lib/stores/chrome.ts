import { derived, writable } from 'svelte/store';
import { activeFloor } from './project';
import type { Floor } from '$lib/models/types';

/**
 * Open/closed state of the editor's floating panels.
 * Only one popover is open at a time, so opening one closes the others.
 */
export type ChromePopover =
  | 'view' | 'alternatives' | 'floors-add' | 'floor-settings' | 'snap-settings'
  | 'sel-length' | 'sel-constrain' | 'sel-more' | 'sel-type' | 'sel-align' | 'sel-size' | 'sel-colour'
  | 'wall-length' | 'wall-angle' | 'room-shapes' | 'history'
  | null;

export const popover = writable<ChromePopover>(null);
export function togglePopover(name: Exclude<ChromePopover, null>) {
  popover.update(current => current === name ? null : name);
}
export function closePopover() { popover.set(null); }

export const drawerOpen = writable(false);
export const catalogOpen = writable(false);
export const elementsListOpen = writable(false);
export const assistantOpen = writable(false);

/** The inspector floats over the plan; it remembers whether the person keeps it open. */
const INSPECTOR_KEY = 'o3d_inspector_open';
function initialInspector(): boolean {
  try {
    const saved = localStorage.getItem(INSPECTOR_KEY);
    if (saved !== null) return saved === '1';
  } catch { /* storage unavailable */ }
  return typeof window !== 'undefined' && window.innerWidth >= 1280;
}
export const inspectorOpen = writable(typeof window === 'undefined' ? false : initialInspector());
inspectorOpen.subscribe(open => {
  try { localStorage.setItem(INSPECTOR_KEY, open ? '1' : '0'); } catch { /* storage unavailable */ }
});
/** Which inspector tab to show next time it opens (Shape, Look, Details). */
export const inspectorFocus = writable<string | null>(null);

/** One-off dialogs the menu drawer opens. */
export type ChromeDialog = 'export' | 'settings' | 'versions' | 'area' | 'help' | 'print' | 'assistant' | null;
export const dialog = writable<ChromeDialog>(null);

/**
 * The active floor for the chrome. The project store edits elements in place, so
 * runes-mode `$derived` values built on `activeFloor` would keep returning the same
 * objects and never update. Each emission here carries fresh element objects.
 */
export const floorView = derived(activeFloor, (floor): Floor | null => floor && {
  ...floor,
  walls: floor.walls.map(item => ({ ...item })),
  doors: floor.doors.map(item => ({ ...item })),
  windows: floor.windows.map(item => ({ ...item })),
  furniture: floor.furniture.map(item => ({ ...item })),
  stairs: floor.stairs?.map(item => ({ ...item })),
  columns: floor.columns?.map(item => ({ ...item })),
  entourage: floor.entourage?.map(item => ({ ...item })),
  measurements: floor.measurements?.map(item => ({ ...item })),
  constraints: floor.constraints?.map(item => ({ ...item })),
  groups: (floor.groups ?? []).map(item => ({ ...item })),
});
