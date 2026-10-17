import { writable } from 'svelte/store';

/**
 * Bridge between the plan canvas and the floating editor chrome.
 * The canvas owns its camera and gesture state; it registers these commands
 * on mount and publishes the few values the chrome needs to draw itself.
 */
export interface PlanViewApi {
  /** Zoom about the centre of the plan. */
  zoomBy(factor: number): void;
  resetZoom(): void;
  zoomToFit(selectionOnly?: boolean): void;
  /** Wall tool: close the current chain back to its first corner. */
  closeWallLoop(): void;
  /** Wall tool: stop the current chain (the old Esc / double-click). */
  finishWall(): void;
  /** Wall tool: add the next segment at an exact length (cm) and angle (degrees, 0 = east, counter-clockwise). */
  placeWallSegment(lengthCm: number, angleDeg: number): void;
  /** Run one of the canvas actions (the old right-click menu) on an element. */
  runAction(action: string, targetId?: string | null): void;
  /** Open the actions menu for a spot on screen (long-press). */
  openActionsAt(clientX: number, clientY: number): void;
  /** Start renaming a room on the plan. */
  renameRoom(roomId: string): void;
  copySelection(): void;
  paste(): void;
  hasClipboard(): boolean;
  /** Move the view by a number of screen pixels. */
  panBy(dx: number, dy: number): void;
}

export const planViewApi = writable<PlanViewApi | null>(null);

/** What the plan shows. Grid, rulers and minimap live here so the View menu can switch them;
 * room labels are a layer (layerVisibility.roomLabels) so the plan exports honour them too. */
export interface PlanDisplay {
  grid: boolean;
  rulers: boolean;
  minimap: boolean;
}
export const planDisplay = writable<PlanDisplay>({ grid: true, rulers: false, minimap: false });

/** Screen rectangle (viewport pixels) around the current selection, for placing the selection bar. */
export interface ScreenRect { left: number; top: number; right: number; bottom: number }
export const selectionAnchor = writable<ScreenRect | null>(null);

/** Screen rectangle the plan canvas occupies. */
export const canvasRect = writable<ScreenRect | null>(null);

/** Live values of the wall being drawn. Null when no chain is in progress. */
export interface WallDraft {
  /** Length of the segment under the finger, in cm. */
  lengthCm: number;
  /** Direction of that segment, degrees counter-clockwise from east. */
  angleDeg: number;
  /** Corners placed so far in this chain. */
  corners: number;
  /** True when the next tap would land on the first corner. */
  nearFirst: boolean;
  /** Name of what the endpoint latched onto, if anything. */
  snappedTo: 'corner' | 'wall' | null;
}
export const wallDraft = writable<WallDraft | null>(null);

/** How a one-finger press on the plan behaves in the Select tool. */
export type SelectMode = 'tap' | 'box' | 'add';
export const selectMode = writable<SelectMode>('tap');

/** Short instruction from the canvas for the status pill (a translation key). */
export const canvasHint = writable<string | null>(null);

/** Snapping choices that apply to every tool. Grid size and wall sticking live in project settings. */
export interface SnapOptions {
  /** Walls lock to multiples of this angle while drawing; 0 turns angle snapping off. */
  angleStep: 0 | 15 | 45 | 90;
  /** Corners and wall faces pull the pointer in. */
  objects: boolean;
}
export const snapOptions = writable<SnapOptions>({ angleStep: 45, objects: true });

/** Elements an Assistant proposal added or changed; the plan outlines them until it is applied or discarded. */
export const previewHighlight = writable<ReadonlySet<string>>(new Set());

/** Width in pixels of a panel docked over the right edge of the plan (the Assistant). Fitting keeps clear of it. */
export const planInsetRight = writable(0);
