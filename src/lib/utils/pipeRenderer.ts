import type { Pipe, Point } from '$lib/models/types';
import type { CanvasState } from './canvasInteraction';
import { PIPE_COLORS } from './pipes';

/**
 * Plan drawing of pipes (spec §4.5): a coloured polyline per pipe, cold blue, hot red,
 * waste grey thick and dashed; a riser is a ring with a dot. Widths follow the diameter
 * but never get thinner than a few pixels, so a 16 mm pipe stays visible zoomed out.
 */

/** Thinnest line on screen, px: supply pipes, and the thicker waste pipes. */
export const PIPE_MIN_PX = { supply: 2.5, waste: 4 } as const;
/** Screen radius of a selected pipe's vertex handles, px. */
export const PIPE_HANDLE_PX = 6;

const SELECTION = '#3b82f6';

function toScreen(cs: CanvasState, p: Point): Point {
  return { x: (p.x - cs.camX) * cs.zoom + cs.width / 2, y: (p.y - cs.camY) * cs.zoom + cs.height / 2 };
}

/** Screen line width of a pipe at this zoom. */
export function pipeLineWidth(pipe: Pick<Pipe, 'kind' | 'diameter'>, zoom: number): number {
  const min = pipe.kind === 'waste' ? PIPE_MIN_PX.waste : PIPE_MIN_PX.supply;
  return Math.max(min, (pipe.diameter / 10) * zoom);
}

/** Screen radius of a riser's ring. */
export function riserRadius(pipe: Pick<Pipe, 'kind' | 'diameter'>, zoom: number): number {
  return Math.max(7, (pipe.diameter / 20) * zoom + 3);
}

function strokePolyline(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

function dashFor(pipe: Pick<Pipe, 'kind'>, width: number): number[] {
  return pipe.kind === 'waste' ? [width * 2.5, width * 1.5] : [];
}

/** Draw one pipe. `selected` adds a highlight and its vertex handles. */
export function drawPipe(cs: CanvasState, pipe: Pipe, selected: boolean, opacity = 1): void {
  const { ctx } = cs;
  const points = pipe.points.map(p => toScreen(cs, p));
  if (!points.length) return;
  const width = pipeLineWidth(pipe, cs.zoom);
  const color = PIPE_COLORS[pipe.kind] ?? PIPE_COLORS.cold;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (points.length >= 2) {
    if (selected) {
      ctx.strokeStyle = SELECTION;
      ctx.globalAlpha *= 0.35;
      ctx.lineWidth = width + 8;
      strokePolyline(ctx, points);
      ctx.globalAlpha /= 0.35;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashFor(pipe, width));
    strokePolyline(ctx, points);
    ctx.setLineDash([]);
  }
  if (pipe.riser) {
    const c = points[0], r = riserRadius(pipe, cs.zoom);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
    ctx.lineWidth = selected ? 3 : 2;
    ctx.strokeStyle = selected ? SELECTION : color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, Math.max(2, r / 3.5), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (selected) {
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, PIPE_HANDLE_PX, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = SELECTION;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw a floor's pipes; `opacityOf` dims the ones not editable in the current trade and surface. */
export function drawPipes(cs: CanvasState, pipes: readonly Pipe[] | undefined, isSelected: (id: string) => boolean, opacityOf: (pipe: Pipe) => number = () => 1): void {
  // Dimmed pipes first, so the editable ones are drawn over them.
  const sorted = [...pipes ?? []].map(pipe => ({ pipe, opacity: opacityOf(pipe) })).sort((a, b) => a.opacity - b.opacity);
  for (const { pipe, opacity } of sorted) drawPipe(cs, pipe, isSelected(pipe.id), opacity);
}

/** The run being drawn: placed points, and a rubber band to the pointer when there is one. */
export function drawPipeDraft(cs: CanvasState, pipe: Pick<Pipe, 'kind' | 'diameter'>, points: readonly Point[], cursor: Point | null): void {
  if (!points.length) return;
  const { ctx } = cs;
  const screen = points.map(p => toScreen(cs, p));
  const width = pipeLineWidth(pipe, cs.zoom);
  const color = PIPE_COLORS[pipe.kind] ?? PIPE_COLORS.cold;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dashFor(pipe, width));
  if (screen.length >= 2) strokePolyline(ctx, screen);
  if (cursor) {
    const end = toScreen(cs, cursor);
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([6, 4]);
    strokePolyline(ctx, [screen[screen.length - 1], end]);
    ctx.globalAlpha = 1;
  }
  ctx.setLineDash([]);
  screen.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === screen.length - 1 ? PIPE_HANDLE_PX + 2 : PIPE_HANDLE_PX - 1, 0, Math.PI * 2);
    ctx.fillStyle = i === screen.length - 1 ? color : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  });
  ctx.restore();
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/**
 * SVG markup for pipes in plan units (1 unit = 1 cm, drawn as at zoom 1 on the canvas),
 * with `tx`/`ty` mapping plan coordinates into the drawing.
 */
export function pipesSvg(pipes: readonly Pipe[] | undefined, tx: (x: number) => number, ty: (y: number) => number): string {
  let out = '';
  for (const pipe of pipes ?? []) {
    if (!pipe.points.length) continue;
    const color = PIPE_COLORS[pipe.kind] ?? PIPE_COLORS.cold;
    const width = pipeLineWidth(pipe, 1);
    const dash = dashFor(pipe, width);
    out += `  <g data-pipe="${pipe.id.replace(/[^\w-]/g, '')}" data-pipe-kind="${pipe.kind}">`;
    if (pipe.points.length >= 2) {
      const points = pipe.points.map(p => `${fmt(tx(p.x))},${fmt(ty(p.y))}`).join(' ');
      out += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round"${dash.length ? ` stroke-dasharray="${dash.map(fmt).join(',')}"` : ''}/>`;
    }
    if (pipe.riser) {
      const c = pipe.points[0], r = riserRadius(pipe, 1);
      out += `<circle cx="${fmt(tx(c.x))}" cy="${fmt(ty(c.y))}" r="${fmt(r)}" fill="white" stroke="${color}" stroke-width="2"/>`;
      out += `<circle cx="${fmt(tx(c.x))}" cy="${fmt(ty(c.y))}" r="${fmt(Math.max(2, r / 3.5))}" fill="${color}"/>`;
    }
    out += '</g>\n';
  }
  return out;
}
