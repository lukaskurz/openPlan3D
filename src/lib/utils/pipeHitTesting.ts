import type { Pipe, Point } from '$lib/models/types';
import { pointToSegmentDist } from './hitTesting';
import { pipeLineWidth, riserRadius } from './pipeRenderer';

/**
 * The topmost pipe under a plan point: within `tolerancePx` screen pixels of its
 * polyline (plus half its drawn width), or inside a riser's ring. Later pipes are
 * drawn over earlier ones, so they win. Pass only the pipes that may be edited.
 */
export function hitTestPipe(p: Point, pipes: readonly Pipe[] | undefined, zoom: number, tolerancePx = 8): Pipe | null {
  const list = pipes ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const pipe = list[i];
    const reach = (tolerancePx + pipeLineWidth(pipe, zoom) / 2) / zoom;
    if (pipe.riser && pipe.points.length && Math.hypot(p.x - pipe.points[0].x, p.y - pipe.points[0].y) <= Math.max(reach, riserRadius(pipe, zoom) / zoom)) return pipe;
    for (let j = 1; j < pipe.points.length; j++) {
      if (pointToSegmentDist(p, pipe.points[j - 1], pipe.points[j]) <= reach) return pipe;
    }
  }
  return null;
}

/** The index of the selected pipe's vertex handle under a plan point, or null. */
export function hitTestPipeVertex(p: Point, pipe: Pipe | null | undefined, zoom: number, tolerancePx = 10): number | null {
  if (!pipe) return null;
  let best: number | null = null, bestDist = tolerancePx / zoom;
  pipe.points.forEach((q, i) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d <= bestDist) { best = i; bestDist = d; }
  });
  return best;
}
