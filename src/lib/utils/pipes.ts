import type { Pipe, PipeKind, PipeRun, Point } from '$lib/models/types';

/** Pipe kinds in the order the tool offers them. */
export const PIPE_KINDS: readonly PipeKind[] = ['cold', 'hot', 'waste'];

/** Plan and 3D colours per kind (spec §4.5). */
export const PIPE_COLORS: Readonly<Record<PipeKind, string>> = { cold: '#38bdf8', hot: '#f87171', waste: '#a8a29e' };

/** Diameter presets in mm offered for each kind: supply pipes are thin, waste pipes thick. */
export const PIPE_DIAMETERS: Readonly<Record<PipeKind, readonly number[]>> = {
  cold: [16, 20, 25],
  hot: [16, 20, 25],
  waste: [40, 50, 110],
};

/** The diameter a new pipe of each kind starts with. */
export const DEFAULT_PIPE_DIAMETER: Readonly<Record<PipeKind, number>> = { cold: 20, hot: 20, waste: 50 };

/** Largest diameter accepted from numeric entry, mm. */
export const MAX_PIPE_DIAMETER = 1000;

/**
 * Default heights of the pipe's centre above the floor surface, in cm, when a pipe
 * has no `elevation`: floor runs lie in the screed just under the finish (slightly
 * above in 3D, see buildPipeMeshes, so they stay visible), wall runs 30 cm up.
 * Ceiling runs hang just under the ceiling, which depends on the room.
 */
export const PIPE_RUN_ELEVATION: Readonly<Record<Exclude<PipeRun, 'ceiling'>, number>> = { floor: -3, wall: 30 };

/** Fewest points a pipe can have: a riser stands at one point, a run needs two. */
export function minPipePoints(pipe: Pick<Pipe, 'riser'>): number {
  return pipe.riser ? 1 : 2;
}

/** Keep a diameter when the kind offers it, else the kind's default (switching cold to waste picks 50 mm). */
export function diameterForKind(kind: PipeKind, current?: number): number {
  return current !== undefined && PIPE_DIAMETERS[kind].includes(current) ? current : DEFAULT_PIPE_DIAMETER[kind];
}

/** Plan length of the run in cm (0 for a riser's single point). */
export function pipeLength(pipe: Pick<Pipe, 'points'>): number {
  let length = 0;
  for (let i = 1; i < pipe.points.length; i++) {
    length += Math.hypot(pipe.points[i].x - pipe.points[i - 1].x, pipe.points[i].y - pipe.points[i - 1].y);
  }
  return length;
}

/** Plan extents of the pipe's points, grown by half its diameter (mm → cm). */
export function pipePlanBounds(pipe: Pick<Pipe, 'points' | 'diameter'>): { minX: number; minY: number; maxX: number; maxY: number } {
  const pad = pipe.diameter / 20;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pipe.points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

/** The points moved by (dx, dy). */
export function translatedPipePoints(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Whether a pipe (without its id) is well formed: the same rules projectValidation applies on load. */
export function validPipeData(pipe: Omit<Pipe, 'id'>): boolean {
  return PIPE_KINDS.includes(pipe.kind)
    && finite(pipe.diameter) && pipe.diameter > 0
    && (['floor', 'wall', 'ceiling'] as PipeRun[]).includes(pipe.run)
    && (pipe.elevation === undefined || finite(pipe.elevation))
    && (pipe.riser === undefined || typeof pipe.riser === 'boolean')
    && Array.isArray(pipe.points) && pipe.points.length >= minPipePoints(pipe)
    && pipe.points.every(p => finite(p?.x) && finite(p?.y));
}

/** Drop consecutive duplicate points (a double tap on the same spot). */
export function dedupePipePoints(points: readonly Point[], tolerance = 0.01): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tolerance) out.push({ x: p.x, y: p.y });
  }
  return out;
}
