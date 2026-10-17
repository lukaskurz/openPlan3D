import { get, writable } from 'svelte/store';
import type { PipeKind, PipeRun, Point, Surface } from '$lib/models/types';
import { DEFAULT_PIPE_DIAMETER, PIPE_KINDS, dedupePipePoints, diameterForKind } from '$lib/utils/pipes';
import { activeFloor, addPipe, selectedElementId, selectedElementIds, selectedTool } from './project';
import { activeSurface } from './workContext';

/**
 * The Pipe tool (Plumbing, spec §3.3): its options, kept for the next pipe, and the
 * run being drawn. The canvas adds points to the draft; Finish, Done, a tap on the
 * last point or a double tap turn the draft into a pipe.
 */
export interface PipeToolOptions {
  kind: PipeKind;
  /** mm */
  diameter: number;
  /** Floor or wall run on the floor surface; the ceiling surface always draws ceiling runs. */
  floorRun: Exclude<PipeRun, 'ceiling'>;
  /** One tap places a vertical stack instead of drawing a run. */
  riser: boolean;
}

const KEY = 'o3d_pipe_tool';
const DEFAULTS: PipeToolOptions = { kind: 'cold', diameter: DEFAULT_PIPE_DIAMETER.cold, floorRun: 'floor', riser: false };

function load(): PipeToolOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && PIPE_KINDS.includes(saved.kind)) {
      return {
        kind: saved.kind,
        diameter: typeof saved.diameter === 'number' && saved.diameter > 0 ? saved.diameter : diameterForKind(saved.kind),
        floorRun: saved.floorRun === 'wall' ? 'wall' : 'floor',
        riser: saved.riser === true,
      };
    }
  } catch { /* storage unavailable or malformed */ }
  return { ...DEFAULTS };
}

export const pipeToolOptions = writable<PipeToolOptions>(typeof window === 'undefined' ? { ...DEFAULTS } : load());
pipeToolOptions.subscribe(options => {
  try { localStorage.setItem(KEY, JSON.stringify(options)); } catch { /* storage unavailable */ }
});

/** Points of the run being drawn, in plan cm. Empty when no run is in progress. */
export const pipeDraft = writable<Point[]>([]);
/** The surface the draft was started on: a surface switch finishes it as it was drawn. */
let draftSurface: Surface = 'floor';

/** Switch kind; the diameter follows to the new kind's presets unless it already is one of them. */
export function setPipeKind(kind: PipeKind) {
  pipeToolOptions.update(options => ({ ...options, kind, diameter: diameterForKind(kind, options.diameter) }));
}

export function setPipeOptions(updates: Partial<PipeToolOptions>) {
  pipeToolOptions.update(options => ({ ...options, ...updates }));
}

/** The run a new pipe gets on this surface with these options. */
export function pipeRunFor(options: Pick<PipeToolOptions, 'floorRun'>, surface: Surface): PipeRun {
  return surface === 'ceiling' ? 'ceiling' : options.floorRun;
}

/** Add a point to the run being drawn. */
export function addDraftPoint(point: Point) {
  if (!get(pipeDraft).length) draftSurface = get(activeSurface);
  pipeDraft.update(points => dedupePipePoints([...points, point]));
}

/** Drop the last point of the run being drawn (undo while drawing). */
export function removeLastDraftPoint() {
  pipeDraft.update(points => points.slice(0, -1));
}

function select(id: string) {
  selectedElementIds.set(new Set());
  selectedElementId.set(id);
}

/**
 * Turn the draft into a pipe with the current options and start a new draft.
 * A draft with fewer than two distinct points is dropped. Returns the new pipe's id.
 */
export function finishPipeDraft(selectNew = false): string | null {
  const points = dedupePipePoints(get(pipeDraft));
  pipeDraft.set([]);
  if (points.length < 2) return null;
  const options = get(pipeToolOptions);
  const id = addPipe({ kind: options.kind, diameter: options.diameter, points, run: pipeRunFor(options, draftSurface) });
  if (id && selectNew) select(id);
  return id;
}

// Any way of leaving the Pipe tool (a shortcut, Done, another tool) keeps the run drawn
// so far, like the wall tool keeps its walls. A storey switch drops it: it belongs to
// the storey it was drawn on, and edits always go to the active one.
selectedTool.subscribe(tool => { if (tool !== 'pipe' && get(pipeDraft).length) finishPipeDraft(); });
let draftFloorId: string | null = null;
activeFloor.subscribe(floor => {
  const id = floor?.id ?? null;
  if (id !== draftFloorId) { draftFloorId = id; pipeDraft.set([]); }
});

/** Place a riser (a vertical stack) at a point with the current options. */
export function placeRiser(point: Point): string | null {
  const options = get(pipeToolOptions);
  return addPipe({ kind: options.kind, diameter: options.diameter, points: [{ x: point.x, y: point.y }], run: pipeRunFor(options, get(activeSurface)), riser: true });
}
