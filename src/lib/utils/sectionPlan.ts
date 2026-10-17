import type { Floor, PlanSection, Point, Project } from '$lib/models/types';
import { angleSnapWithin } from './canvasInteraction';

/**
 * Section cut lines on the plan (spec §4.8, §5.4): their codes, the snapping of the
 * Section tool, which storeys show their markers, and the markers' geometry and hit
 * testing. Pure: no stores, no canvas.
 *
 * Convention (see `PlanSection`): dir = (end − start) / |end − start|, leftNormal =
 * (−dir.y, dir.x), and the section looks along `look * leftNormal`.
 */

/** Shorter cuts are ignored by the Section tool (cm). */
export const MIN_SECTION_LENGTH = 20;
/** Radius of the end bubbles that carry the code, in screen pixels. */
export const SECTION_BUBBLE_PX = 12;
/** Length of the arrowheads beside the bubbles, in screen pixels. */
export const SECTION_ARROW_PX = 10;
/** Hit radius of a bubble, in screen pixels: Apple's 44 pt minimum touch target, halved. */
export const SECTION_BUBBLE_HIT_PX = 22;
/** Hit distance of the cut line, in screen pixels. */
export const SECTION_LINE_HIT_PX = 8;
/** Plan content within this distance of a cut still counts as crossed (cm). */
const FLOOR_MARGIN = 100;

/** The n-th section code: A … Z, then AA, AB … AZ, BA … ZZ, AAA … */
export function sectionCode(index: number): string {
  let code = '';
  for (let n = Math.max(0, Math.floor(index)) + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    code = String.fromCharCode(65 + ((n - 1) % 26)) + code;
  }
  return code;
}

/** The first code no existing section uses: 'A' for the first section, then 'B', … 'Z', 'AA'. */
export function nextSectionCode(existing: Iterable<string | undefined | null>): string {
  const used = new Set(existing);
  for (let i = 0; ; i++) if (!used.has(sectionCode(i))) return sectionCode(i);
}

/** The Section tool's end point: on the nearest 0/45/90° ray from `start`, unless snapping is bypassed. */
export function snapSectionEnd(start: Point, end: Point, bypass = false): Point {
  const snapped = bypass ? end : angleSnapWithin(start, end, Infinity);
  return { x: snapped.x, y: snapped.y };
}

/** Direction along the cut, the viewing direction and the length; null for a zero-length cut. */
export function sectionAxes(section: Pick<PlanSection, 'start' | 'end' | 'look'>): { dir: Point; view: Point; length: number } | null {
  const dx = section.end.x - section.start.x, dy = section.end.y - section.start.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  const dir = { x: dx / length, y: dy / length };
  const look = section.look === -1 ? -1 : 1;
  return { dir, view: { x: -dir.y * look, y: dir.x * look }, length };
}

/** Bounding box of what is drawn on a floor (walls, items, stairs, columns, pipes…), or null for an empty floor. */
function floorContentBox(floor: Floor): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = [];
  for (const wall of floor.walls) {
    points.push(wall.start, wall.end);
    if (wall.curvePoint) points.push(wall.curvePoint);
  }
  for (const item of [...floor.furniture, ...(floor.stairs ?? []), ...(floor.columns ?? []), ...(floor.entourage ?? [])]) points.push(item.position);
  for (const pipe of floor.pipes ?? []) points.push(...pipe.points);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** Whether segment a–b meets the box (Liang–Barsky clipping). */
function segmentMeetsBox(a: Point, b: Point, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.minX], [dx, box.maxX - a.x], [-dy, a.y - box.minY], [dy, box.maxY - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

/**
 * Whether the section's markers show on this storey. A section that names storeys
 * (`floorIds`) shows on those only; ids the project does not know are ignored (pass the
 * project so they can be told apart; without it every listed id counts). Otherwise it
 * shows on every storey the cut crosses: one whose content (with a 1 m margin) the line
 * meets, and every empty storey (there is nothing to miss there).
 */
export function sectionOnFloor(section: PlanSection, floor: Floor, project?: Pick<Project, 'floors' | 'alternatives'>): boolean {
  if (section.floorIds?.length) {
    const known = project ? knownFloorIds(project) : null;
    const listed = known ? section.floorIds.filter(id => known.has(id)) : section.floorIds;
    if (listed.length) return listed.includes(floor.id);
  }
  const box = floorContentBox(floor);
  if (!box) return true;
  return segmentMeetsBox(section.start, section.end, {
    minX: box.minX - FLOOR_MARGIN, minY: box.minY - FLOOR_MARGIN, maxX: box.maxX + FLOOR_MARGIN, maxY: box.maxY + FLOOR_MARGIN,
  });
}

/** Floor ids of every plan alternative (they share ids, see planAlternatives). */
export function knownFloorIds(project: Pick<Project, 'floors' | 'alternatives'>): Set<string> {
  const ids = new Set(project.floors.map(floor => floor.id));
  for (const alt of project.alternatives ?? []) for (const floor of alt.floors ?? []) ids.add(floor.id);
  return ids;
}

export interface SectionBubble { end: 'start' | 'end'; center: Point; radius: number }

/** A section marker in plan coordinates (cm) at a zoom, with zoom-independent screen sizes. */
export interface SectionMarkerGeometry {
  code: string;
  start: Point;
  end: Point;
  dir: Point;
  /** The viewing direction (unit). */
  view: Point;
  length: number;
  /** End bubbles, centred on the cut's ends; they carry the code. */
  bubbles: [SectionBubble, SectionBubble];
  /** Arrowheads beside each bubble pointing the way the section looks: [tip, base corner, base corner]. */
  arrows: [Point, Point, Point][];
}

export function sectionMarkerGeometry(section: PlanSection, zoom: number): SectionMarkerGeometry | null {
  const axes = sectionAxes(section);
  if (!axes || !(zoom > 0)) return null;
  const { dir, view, length } = axes;
  const radius = SECTION_BUBBLE_PX / zoom, arrow = SECTION_ARROW_PX / zoom;
  const at = (p: Point, along: number, out: number): Point => ({ x: p.x + dir.x * along + view.x * out, y: p.y + dir.y * along + view.y * out });
  const arrowAt = (c: Point): [Point, Point, Point] => [at(c, 0, radius + arrow), at(c, -arrow * 0.75, radius * 0.6), at(c, arrow * 0.75, radius * 0.6)];
  return {
    code: section.code,
    start: { ...section.start },
    end: { ...section.end },
    dir, view, length,
    bubbles: [{ end: 'start', center: { ...section.start }, radius }, { end: 'end', center: { ...section.end }, radius }],
    arrows: [arrowAt(section.start), arrowAt(section.end)],
  };
}

export interface SectionHit { id: string; part: 'start' | 'end' | 'line' }

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * The section marker under a plan point: an end bubble (with its arrowhead, at least a
 * 44 px target) before any cut line; later sections (drawn on top) first. Pass only the
 * sections shown on the floor.
 */
export function hitTestSectionMarker(wp: Point, sections: readonly PlanSection[], zoom: number,
  options: { bubblePx?: number; linePx?: number } = {}): SectionHit | null {
  if (!(zoom > 0)) return null;
  const bubble = Math.max(options.bubblePx ?? SECTION_BUBBLE_HIT_PX, SECTION_BUBBLE_PX + SECTION_ARROW_PX) / zoom;
  const line = (options.linePx ?? SECTION_LINE_HIT_PX) / zoom;
  let best: SectionHit | null = null, bestDist = Infinity;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (!sectionAxes(section)) continue;
    for (const end of ['start', 'end'] as const) {
      const d = Math.hypot(wp.x - section[end].x, wp.y - section[end].y);
      if (d <= bubble && d < bestDist) { best = { id: section.id, part: end }; bestDist = d; }
    }
  }
  if (best) return best;
  for (let i = sections.length - 1; i >= 0; i--) {
    const section = sections[i];
    if (!sectionAxes(section)) continue;
    if (segmentDistance(wp, section.start, section.end) <= line) return { id: section.id, part: 'line' };
  }
  return null;
}
