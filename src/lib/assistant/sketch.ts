/**
 * Drawing on the plan for the Assistant: the person scribbles over the plan
 * (circles an area, draws an arrow or a wall), and the sketch goes with their
 * next message as a picture of that part of the plan plus the strokes in plan
 * cm, so "put a desk here" has a here.
 */
import { get, writable } from 'svelte/store';
import type { Point } from '$lib/models/types';
import { canvasCamX, canvasCamY, canvasZoom } from '$lib/stores/project';
import type { Attachment } from './session';

/** True while pointer input on the plan draws instead of editing. */
export const sketching = writable(false);
/** Finished strokes in plan cm. */
export const sketchStrokes = writable<Point[][]>([]);
/** The sketch, ready to send with the next message (made when drawing ends). */
export const sketchAttachment = writable<Attachment | null>(null);

const MAX_STROKES = 20;
const MAX_POINTS = 40;
const MAX_NOTE = 6000;
const PICTURE_EDGE = 1000;
const THUMB_EDGE = 160;

export function startSketch() {
  sketchAttachment.set(null);
  sketching.set(true);
}

export function addStroke(points: Point[]) {
  if (points.length < 2) return;
  sketchStrokes.update(strokes => [...strokes, points].slice(-MAX_STROKES));
}

export function undoStroke() {
  sketchStrokes.update(strokes => strokes.slice(0, -1));
}

export function clearSketch() {
  sketching.set(false);
  sketchStrokes.set([]);
  sketchAttachment.set(null);
}

/** Stop drawing and turn the strokes into an attachment (none when nothing was drawn). */
export function finishSketch() {
  sketching.set(false);
  sketchAttachment.set(get(sketchStrokes).length ? renderSketch(get(sketchStrokes)) : null);
}

/** Ramer–Douglas–Peucker: drop points closer than tolerance (cm) to the line through their neighbours. */
export function simplifyStroke(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const [a, b] = [points[0], points[points.length - 1]];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const d = length ? Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / length : Math.hypot(p.x - a.x, p.y - a.y);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplifyStroke(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplifyStroke(points.slice(at), tolerance)];
}

/** The strokes as the model reads them: numbered, in whole cm, at most MAX_POINTS points each. */
export function describeStrokes(strokes: Point[][], region?: { x0: number; y0: number; x1: number; y1: number }): string {
  const describe = (minTolerance: number) => strokes.map((stroke, i) => {
    let tolerance = minTolerance, points = simplifyStroke(stroke, tolerance);
    while (points.length > MAX_POINTS) points = simplifyStroke(stroke, tolerance *= 2);
    const start = stroke[0], end = stroke[stroke.length - 1];
    const extent = Math.max(...stroke.map(p => Math.hypot(p.x - start.x, p.y - start.y)));
    const closed = extent > 30 && Math.hypot(end.x - start.x, end.y - start.y) < extent * 0.25;
    return `${i + 1}${closed ? ' (closed: circles an area)' : ''}: ${points.map(p => `(${Math.round(p.x)},${Math.round(p.y)})`).join(' ')}`;
  });
  // Stay well inside the server's limit for one text block.
  let tolerance = 2, lines = describe(tolerance);
  while (lines.join('\n').length > MAX_NOTE && tolerance < 1000) lines = describe(tolerance *= 2);
  const shown = region ? ` The picture shows the plan from x ${Math.round(region.x0)} to ${Math.round(region.x1)} cm and y ${Math.round(region.y0)} to ${Math.round(region.y1)} cm, with the drawing in red and the strokes numbered.` : '';
  return `[The person drew on the plan to show what they mean.${shown} The strokes in plan cm:\n${lines.join('\n')}]`;
}

/** A picture of the plan around the strokes, as it is on screen, with the strokes drawn in. */
function renderSketch(strokes: Point[][]): Attachment {
  const note = describeStrokes(strokes);
  const plan = typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('canvas[data-plan-canvas]');
  if (!plan || !plan.width || !plan.height) return { mediaType: 'image/jpeg', data: '', thumb: '', name: 'sketch', note, sketch: true };

  const zoom = get(canvasZoom), camX = get(canvasCamX), camY = get(canvasCamY);
  const toCanvas = (p: Point) => ({ x: (p.x - camX) * zoom + plan.width / 2, y: (p.y - camY) * zoom + plan.height / 2 });
  const toPlan = (x: number, y: number) => ({ x: (x - plan.width / 2) / zoom + camX, y: (y - plan.height / 2) / zoom + camY });

  // The strokes' bounds with room around them for context, kept on the canvas.
  const all = strokes.flat().map(toCanvas);
  let x0 = Math.min(...all.map(p => p.x)), x1 = Math.max(...all.map(p => p.x));
  let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  const pad = Math.max(150 * zoom, (x1 - x0) * 0.4, (y1 - y0) * 0.4, 60);
  x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
  x1 = Math.min(plan.width, Math.ceil(x1 + pad)); y1 = Math.min(plan.height, Math.ceil(y1 + pad));
  if (x1 - x0 < 10 || y1 - y0 < 10) { x0 = 0; y0 = 0; x1 = plan.width; y1 = plan.height; }

  const scale = Math.min(1.5, PICTURE_EDGE / Math.max(x1 - x0, y1 - y0));
  const out = document.createElement('canvas');
  out.width = Math.round((x1 - x0) * scale);
  out.height = Math.round((y1 - y0) * scale);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(plan, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);

  const toOut = (p: Point) => { const c = toCanvas(p); return { x: (c.x - x0) * scale, y: (c.y - y0) * scale }; };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 4;
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.map(toOut).forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
  }
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  strokes.forEach((stroke, i) => {
    const p = toOut(stroke[0]);
    ctx.fillStyle = '#e11d48';
    ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(i + 1), p.x, p.y + 0.5);
  });

  const url = out.toDataURL('image/jpeg', 0.85);
  const thumbCanvas = document.createElement('canvas');
  const t = THUMB_EDGE / Math.max(out.width, out.height);
  thumbCanvas.width = Math.max(1, Math.round(out.width * t));
  thumbCanvas.height = Math.max(1, Math.round(out.height * t));
  thumbCanvas.getContext('2d')!.drawImage(out, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const a = toPlan(x0, y0), b = toPlan(x1, y1);
  return {
    mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1), thumb: thumbCanvas.toDataURL('image/jpeg', 0.7),
    name: 'sketch', sketch: true, note: describeStrokes(strokes, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }),
  };
}
