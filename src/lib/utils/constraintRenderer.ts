/**
 * Drawing and hit testing for parametric dimensions and constraint badges on the 2D plan.
 * Shapes are computed in world coordinates (shared with exports), then drawn in screen space.
 */
import type { Constraint, Point, Wall } from '$lib/models/types';
import type { CanvasState } from './canvasInteraction';
import { formatLength } from '$lib/stores/settings';
import { buildSketch, endpointKey, refKey, type Sketch } from './constraints/sketch';
import { wallNormal } from './constraints/faces';
import { faceEndpoints, lineIntersection, type DimensionPick } from './constraints/picking';
import { measureConstraint } from './constraints/rows';

export type ConstraintShape =
  | { kind: 'linear'; from: Point; to: Point; ext: [Point, Point][]; text: string }
  | { kind: 'arc'; center: Point; radius: number; from: number; to: number; text: string }
  | { kind: 'badge'; at: Point; normal: Point; clearance: number; glyph: 'H' | 'V' | '∥' | '⊥' | 'fix' };

export type ConstraintState = 'driving' | 'driven' | 'conflict' | 'preview';

const COLORS: Record<ConstraintState, string> = { driving: '#4f46e5', driven: '#94a3b8', conflict: '#dc2626', preview: '#0ea5e9' };
const SELECTED = '#0284c7';

const add = (a: Point, b: Point, k = 1): Point => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unit = (v: Point): Point => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };
const wallDir = (w: Wall) => unit(sub(w.end, w.start));
const mid = (w: Wall): Point => ({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 });
/** Badges sit off-centre so they don't cover the centred length labels. */
const along = (w: Wall, t: number): Point => ({ x: w.start.x + (w.end.x - w.start.x) * t, y: w.start.y + (w.end.y - w.start.y) * t });

/** "3.85 m" / "12'6"" for lengths, "90°" for angles; driven dimensions in parentheses like Fusion. */
export function constraintText(c: Constraint, value: number, units: 'metric' | 'imperial'): string {
  const text = c.kind === 'angle' ? `${+Math.abs(value).toFixed(1)}°` : formatLength(Math.abs(value), units);
  return c.driven ? `(${text})` : text;
}

function endpoint(sketch: Sketch, key: string): Point | null {
  const [wallId, end] = [key.slice(0, key.lastIndexOf(':')), key.slice(key.lastIndexOf(':') + 1) as 'start' | 'end'];
  const wall = sketch.wallById.get(wallId);
  return wall ? wall[end] : null;
}

/** World-space shapes for one constraint, given its current value. */
export function constraintShapes(c: Constraint, sketch: Sketch, value: number | null, units: 'metric' | 'imperial'): ConstraintShape[] {
  const wall = (id: string) => sketch.wallById.get(id);
  const text = value === null ? '' : constraintText(c, value, units);
  switch (c.kind) {
    case 'length': {
      const w = wall(c.wallId);
      if (!w) return [];
      const [fa, fb] = faceEndpoints(w, c.side, sketch), n = wallNormal(w);
      const offset = c.offset ?? (c.side || 1) * (w.thickness / 2 + 40), shift = offset - c.side * w.thickness / 2;
      const from = add(fa, n, shift), to = add(fb, n, shift);
      return [{ kind: 'linear', from, to, ext: [[fa, from], [fb, to]], text }];
    }
    case 'pointDistance': {
      const p = endpoint(sketch, refKey(c.a)), q = endpoint(sketch, refKey(c.b));
      if (!p || !q) return [];
      const u = c.axis === 'x' ? { x: 1, y: 0 } : c.axis === 'y' ? { x: 0, y: 1 } : unit(sub(q, p)), n = { x: -u.y, y: u.x };
      const base = add({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, n, c.offset ?? 40);
      const from = add(p, n, dot(sub(base, p), n)), to = add(q, n, dot(sub(base, q), n));
      return [{ kind: 'linear', from, to, ext: [[p, from], [q, to]], text }];
    }
    case 'pointLine': {
      const p = endpoint(sketch, refKey(c.point)), w = wall(c.wallId);
      if (!p || !w) return [];
      const n = wallNormal(w), u = wallDir(w), sd = dot(sub(p, w.start), n);
      const foot = add(p, n, -(sd - c.side * w.thickness / 2)), shift = c.offset ?? 0;
      const from = add(p, u, shift), to = add(foot, u, shift);
      return [{ kind: 'linear', from, to, ext: shift ? [[p, from], [foot, to]] : [], text }];
    }
    case 'lineDistance': {
      const a = wall(c.wallA), b = wall(c.wallB);
      if (!a || !b) return [];
      const na = wallNormal(a), nb = wallNormal(b), facing = dot(na, nb);
      if (Math.abs(facing) < 0.5) return [];
      const pa = add(add(mid(a), wallDir(a), c.offset ?? 0), na, c.sideA * a.thickness / 2);
      const bFace = add(b.start, nb, c.sideB * b.thickness / 2);
      const pb = add(pa, na, -dot(sub(pa, bFace), nb) / facing);
      return [{ kind: 'linear', from: pa, to: pb, ext: [], text }];
    }
    case 'angle': {
      const a = wall(c.wallA), b = wall(c.wallB);
      if (!a || !b) return [];
      const center = lineIntersection(a, b);
      if (!center) return [];
      const ua = wallDir(a), sa = dot(sub(mid(a), center), ua) < 0 ? -1 : 1;
      const ra = { x: ua.x * sa, y: ua.y * sa }, ub = wallDir(b), k = sa * (c.flipB ? -1 : 1), rb = { x: ub.x * k, y: ub.y * k };
      return [{ kind: 'arc', center, radius: c.offset ?? 50, from: Math.atan2(ra.y, ra.x), to: Math.atan2(rb.y, rb.x), text }];
    }
    case 'horizontal': case 'vertical': {
      const w = wall(c.wallId);
      return w ? [{ kind: 'badge', at: along(w, 0.25), normal: wallNormal(w), clearance: w.thickness / 2, glyph: c.kind === 'horizontal' ? 'H' : 'V' }] : [];
    }
    case 'parallel': case 'perpendicular': {
      const glyph = c.kind === 'parallel' ? '∥' : '⊥';
      return [c.wallA, c.wallB].map(wall).filter((w): w is Wall => !!w)
        .map(w => ({ kind: 'badge' as const, at: along(w, 0.75), normal: wallNormal(w), clearance: w.thickness / 2, glyph }));
    }
    case 'fix': {
      const keys = 'end' in c.target ? [refKey(c.target)] : [endpointKey(c.target.wallId, 'start'), endpointKey(c.target.wallId, 'end')];
      return keys.map(k => endpoint(sketch, k)).filter((p): p is Point => !!p)
        .map(at => ({ kind: 'badge' as const, at, normal: { x: 0.7071, y: -0.7071 }, clearance: 0, glyph: 'fix' as const }));
    }
  }
}

function wts(cs: CanvasState, p: Point): Point {
  return { x: (p.x - cs.camX) * cs.zoom + cs.width / 2, y: (p.y - cs.camY) * cs.zoom + cs.height / 2 };
}

function labelBox(ctx: CanvasRenderingContext2D, text: string, at: Point, color: string, fontSize: number, selected: boolean) {
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 8, h = fontSize + 6;
  ctx.fillStyle = selected ? '#e0f2fe' : 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = color; ctx.lineWidth = selected ? 1.5 : 1;
  ctx.beginPath();
  ctx.roundRect?.(at.x - w / 2, at.y - h / 2, w, h, 3) ?? ctx.rect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, at.x, at.y + 0.5);
}

function badgeCenter(cs: CanvasState, shape: Extract<ConstraintShape, { kind: 'badge' }>): Point {
  const s = wts(cs, shape.at), px = shape.clearance * cs.zoom + 13;
  return { x: s.x + shape.normal.x * px, y: s.y + shape.normal.y * px };
}

/** Screen-space label position of a dimension shape. */
export function shapeLabel(cs: CanvasState, shape: ConstraintShape): Point {
  if (shape.kind === 'linear') { const a = wts(cs, shape.from), b = wts(cs, shape.to); return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  if (shape.kind === 'arc') {
    const c = wts(cs, shape.center), m = shape.from + sweep(shape) / 2, r = shape.radius * cs.zoom + 14;
    return { x: c.x + Math.cos(m) * r, y: c.y + Math.sin(m) * r };
  }
  return badgeCenter(cs, shape);
}

/** Signed sweep from `from` to `to` taking the shorter way round. */
function sweep(shape: Extract<ConstraintShape, { kind: 'arc' }>): number {
  let d = shape.to - shape.from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function drawConstraintShape(cs: CanvasState, shape: ConstraintShape, state: ConstraintState, selected: boolean) {
  const { ctx } = cs, color = selected ? SELECTED : COLORS[state];
  const fontSize = Math.max(10, Math.min(13, 11 * cs.zoom));
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (state === 'preview' || state === 'driven') ctx.setLineDash([5, 3]);
  if (shape.kind === 'linear') {
    const a = wts(cs, shape.from), b = wts(cs, shape.to), len = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (const [p, q] of shape.ext) {
      const sp = wts(cs, p), sq = wts(cs, q), l = Math.hypot(sq.x - sp.x, sq.y - sp.y);
      if (l < 1) continue;
      const ux = (sq.x - sp.x) / l, uy = (sq.y - sp.y) / l;
      ctx.moveTo(sp.x + ux * 2, sp.y + uy * 2); ctx.lineTo(sq.x + ux * 5, sq.y + uy * 5);
    }
    ctx.stroke();
    ctx.lineWidth = selected ? 1.75 : 1.25;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    if (len > 1) {
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, arrow = Math.min(8, len / 3), w = arrow * 0.4;
      for (const [p, dir] of [[a, 1], [b, -1]] as const) {
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + ux * arrow * dir - uy * w, p.y + uy * arrow * dir + ux * w);
        ctx.lineTo(p.x + ux * arrow * dir + uy * w, p.y + uy * arrow * dir - ux * w);
        ctx.closePath(); ctx.fill();
      }
    }
    if (shape.text) labelBox(ctx, shape.text, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, color, fontSize, selected);
  } else if (shape.kind === 'arc') {
    const c = wts(cs, shape.center), r = shape.radius * cs.zoom, d = sweep(shape);
    ctx.lineWidth = selected ? 1.75 : 1.25;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, shape.from, shape.from + d, d < 0); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (const angle of [shape.from, shape.to]) { ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(angle) * (r + 6), c.y + Math.sin(angle) * (r + 6)); }
    ctx.stroke();
    if (shape.text) labelBox(ctx, shape.text, shapeLabel(cs, shape), color, fontSize, selected);
  } else {
    ctx.setLineDash([]);
    const p = badgeCenter(cs, shape);
    ctx.fillStyle = selected ? '#e0f2fe' : '#ffffff'; ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    if (shape.glyph === 'fix') {
      // A pushpin: round head and a short needle.
      ctx.beginPath(); ctx.arc(p.x, p.y - 1.5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y + 1); ctx.lineTo(p.x, p.y + 5); ctx.stroke();
    } else {
      ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(shape.glyph, p.x, p.y + 0.5);
    }
  }
  ctx.restore();
}

export interface ConstraintRenderInput {
  walls: Wall[];
  constraints: Constraint[];
  measures: Map<string, number>;
  conflicts: Set<string>;
  units: 'metric' | 'imperial';
  selectedId: string | null;
  hoverId?: string | null;
  /** Hide the H/V/∥/⊥/fix badges (exports). */
  badges?: boolean;
}

export function constraintState(c: Constraint, conflicts: Set<string>): ConstraintState {
  return conflicts.has(c.id) ? 'conflict' : c.driven ? 'driven' : 'driving';
}

export function drawConstraints(cs: CanvasState, input: ConstraintRenderInput, sketch = buildSketch(input.walls)) {
  for (const c of input.constraints) {
    const shapes = constraintShapes(c, sketch, input.measures.get(c.id) ?? null, input.units);
    const selected = c.id === input.selectedId || c.id === input.hoverId;
    for (const shape of shapes) {
      if (shape.kind === 'badge' && input.badges === false) continue;
      drawConstraintShape(cs, shape, constraintState(c, input.conflicts), selected);
    }
  }
}

/** A dimension being placed, measured live. */
export function drawConstraintPreview(cs: CanvasState, c: Constraint, walls: Wall[], units: 'metric' | 'imperial') {
  const sketch = buildSketch(walls);
  const value = measureConstraint(c, sketch);
  for (const shape of constraintShapes(c, sketch, value, units)) drawConstraintShape(cs, shape, 'preview', false);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** The constraint whose dimension line, label or badge is under a screen point. */
export function hitTestConstraint(cs: CanvasState, screen: Point, input: Pick<ConstraintRenderInput, 'walls' | 'constraints' | 'measures' | 'units'>, sketch = buildSketch(input.walls)): string | null {
  for (let i = input.constraints.length - 1; i >= 0; i--) {
    const c = input.constraints[i];
    for (const shape of constraintShapes(c, sketch, input.measures.get(c.id) ?? null, input.units)) {
      const label = shapeLabel(cs, shape);
      if (Math.abs(screen.x - label.x) < 22 && Math.abs(screen.y - label.y) < 10) return c.id;
      if (shape.kind === 'linear' && distanceToSegment(screen, wts(cs, shape.from), wts(cs, shape.to)) < 6) return c.id;
      if (shape.kind === 'arc') {
        const center = wts(cs, shape.center), r = Math.hypot(screen.x - center.x, screen.y - center.y);
        const angle = Math.atan2(screen.y - center.y, screen.x - center.x), d = sweep(shape);
        let rel = (angle - shape.from) * Math.sign(d || 1);
        while (rel < 0) rel += 2 * Math.PI;
        if (Math.abs(r - shape.radius * cs.zoom) < 6 && rel <= Math.abs(d)) return c.id;
      }
      if (shape.kind === 'badge' && Math.hypot(screen.x - label.x, screen.y - label.y) < 10) return c.id;
    }
  }
  return null;
}

/** Highlight what the dimension tool would pick. */
export function drawPickHighlight(cs: CanvasState, pick: DimensionPick, walls: Wall[], color = COLORS.preview) {
  const { ctx } = cs;
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  if (pick.kind === 'corner') {
    const p = wts(cs, pick.point);
    ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fill();
  } else {
    const w = walls.find(w => w.id === pick.wallId);
    if (w) {
      const a = wts(cs, w.start), b = wts(cs, w.end);
      ctx.globalAlpha = 0.35; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(4, w.thickness * cs.zoom + 4);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
  }
  ctx.restore();
}

/** Screen label anchor of a constraint, for placing the inline editor. */
export function constraintLabelPosition(cs: CanvasState, c: Constraint, walls: Wall[], units: 'metric' | 'imperial', sketch = buildSketch(walls)): Point | null {
  const shape = constraintShapes(c, sketch, 0, units).find(s => s.kind !== 'badge');
  return shape ? shapeLabel(cs, shape) : null;
}
