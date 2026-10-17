/** Plan geometry shared by the Assistant's tools and checks. Centimetres, y down. */
import type { FurnitureItem, Point, Wall } from '$lib/models/types';
import { getCatalogItem, getFurnitureSize } from '$lib/utils/furnitureCatalog';

export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function insidePolygon(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

export function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function segmentDistance(p: Point, a: Point, b: Point): number {
  const c = closestOnSegment(p, a, b);
  return Math.hypot(p.x - c.x, p.y - c.y);
}

export function nearPolygon(p: Point, poly: Point[], tolerance: number): boolean {
  return insidePolygon(p, poly) || poly.some((a, i) => segmentDistance(p, a, poly[(i + 1) % poly.length]) <= tolerance);
}

/** Corners of a rotated rectangle around its centre. */
export function rectCorners(center: Point, width: number, depth: number, rotationDeg: number): Point[] {
  const a = rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = sx * width / 2, y = sy * depth / 2;
    return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
  });
}

/** Convex polygons overlap by more than `margin` cm (separating axis test). */
export function convexOverlap(a: Point[], b: Point[], margin = 2): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
      const project = (pts: Point[]) => pts.map(pt => pt.x * nx + pt.y * ny);
      const pa = project(a), pb = project(b);
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= margin) return false;
    }
  }
  return true;
}

/** Shortest distance between two separate convex polygons, with the closest points. Zero when they overlap. */
export function polygonGap(a: Point[], b: Point[]): { distance: number; from: Point; to: Point } {
  if (convexOverlap(a, b, 0)) return { distance: 0, from: a[0], to: a[0] };
  let best = { distance: Infinity, from: a[0], to: b[0] };
  const consider = (points: Point[], edges: Point[], flip: boolean) => {
    for (const p of points) for (let i = 0; i < edges.length; i++) {
      const q = closestOnSegment(p, edges[i], edges[(i + 1) % edges.length]);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.distance) best = { distance: d, from: flip ? q : p, to: flip ? p : q };
    }
  };
  consider(a, b, false);
  consider(b, a, true);
  return best;
}

export function furnitureFootprint(item: FurnitureItem): Point[] {
  const size = getFurnitureSize(item);
  return rectCorners(item.position, Math.abs(size.width), Math.abs(size.depth), item.rotation || 0);
}

/** A straight wall as the rectangle it occupies. */
export function wallQuad(wall: Wall, inset = 0): Point[] {
  const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y) || 1;
  const half = Math.max(0, wall.thickness / 2 - inset);
  const nx = -(wall.end.y - wall.start.y) / len * half, ny = (wall.end.x - wall.start.x) / len * half;
  return [
    { x: wall.start.x + nx, y: wall.start.y + ny }, { x: wall.end.x + nx, y: wall.end.y + ny },
    { x: wall.end.x - nx, y: wall.end.y - ny }, { x: wall.start.x - nx, y: wall.start.y - ny },
  ];
}

/** Items that sit on top of others or overhead never block anything. */
export function isLayered(item: FurnitureItem): boolean {
  const def = getCatalogItem(item.catalogId);
  return !!(item.elevation ?? def?.elevation) || /rug|carpet|mat\b|ceiling|pendant|chandelier/i.test(item.catalogId) || !!def?.symbol;
}

export function catalogName(item: FurnitureItem): string {
  return getCatalogItem(item.catalogId)?.name ?? item.catalogId;
}
