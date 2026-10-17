/**
 * The Assistant's eyes for attached floor plans: zoom into a drawing, lay it
 * under the plan at its real scale, and look at a part of the plan over it.
 * Drawings are kept in memory for the conversation (not saved), so after a
 * reload the person attaches them again.
 */
import { get } from 'svelte/store';
import type { BackgroundImage, Point, Wall } from '$lib/models/types';
import { activeFloor, setBackgroundImage } from '$lib/stores/project';
import { wallLength, wallPointAt } from '$lib/utils/canvasRenderer';
import type { ToolOutcome } from './planTools';

/** Long edge of the images the model gets back. */
const VIEW_EDGE = 1200;
/** Long edge of a page laid under the plan. */
const TRACE_EDGE = 2400;

interface Drawing { name: string; file: Blob; pdf?: Promise<PdfDocument> }
type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;

let drawings: Drawing[] = [];

export function rememberDrawing(name: string, file: Blob) {
  drawings.push({ name, file });
}

export function forgetDrawings() {
  for (const drawing of drawings) void drawing.pdf?.then(pdf => pdf.loadingTask.destroy()).catch(() => {});
  drawings = [];
}

class DrawingError extends Error {}
const fail = (message: string): never => { throw new DrawingError(message); };

function latest(): Drawing {
  return drawings[drawings.length - 1] ?? fail('No drawing is attached in this conversation. Ask the person to attach it again.');
}

const isPdf = (drawing: Drawing) => drawing.file.type === 'application/pdf';

async function pdfOf(drawing: Drawing): Promise<PdfDocument> {
  drawing.pdf ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc ||= (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    return pdfjs.getDocument({ data: new Uint8Array(await drawing.file.arrayBuffer()) }).promise;
  })();
  return drawing.pdf;
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Page count and the page's aspect (width / height). */
async function pageInfo(drawing: Drawing, page: number): Promise<{ pages: number; aspect: number }> {
  if (!isPdf(drawing)) {
    if (page !== 1) fail('This drawing is a picture with one page.');
    const bitmap = await createImageBitmap(drawing.file);
    const aspect = bitmap.width / bitmap.height;
    bitmap.close();
    return { pages: 1, aspect };
  }
  const pdf = await pdfOf(drawing);
  if (page < 1 || page > pdf.numPages) fail(`The drawing has ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}.`);
  const viewport = (await pdf.getPage(page)).getViewport({ scale: 1 });
  return { pages: pdf.numPages, aspect: viewport.width / viewport.height };
}

/**
 * Render part of a page. region is [x0, y0, x1, y1] in fractions of the page;
 * fullWidth is the width in px the whole page would have.
 */
async function renderRegion(drawing: Drawing, page: number, region: number[], fullWidth: number) {
  const [x0, y0, x1, y1] = region;
  if (isPdf(drawing)) {
    const pdfPage = await (await pdfOf(drawing)).getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const scale = fullWidth / base.width;
    const viewport = pdfPage.getViewport({ scale, offsetX: -x0 * base.width * scale, offsetY: -y0 * base.height * scale });
    const { canvas, ctx } = canvasOf((x1 - x0) * base.width * scale, (y1 - y0) * base.height * scale);
    // The print intent renders without requestAnimationFrame, which stalls while the tab is in the background.
    await pdfPage.render({ canvas, canvasContext: ctx, viewport, background: '#ffffff', intent: 'print' }).promise;
    return { canvas, ctx };
  }
  const bitmap = await createImageBitmap(drawing.file);
  try {
    const scale = fullWidth / bitmap.width;
    const { canvas, ctx } = canvasOf((x1 - x0) * bitmap.width * scale, (y1 - y0) * bitmap.height * scale);
    ctx.drawImage(bitmap, x0 * bitmap.width, y0 * bitmap.height, (x1 - x0) * bitmap.width, (y1 - y0) * bitmap.height, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx };
  } finally {
    bitmap.close();
  }
}

/** A step from 1-2-2.5-5 × 10ⁿ that puts roughly 6–12 grid lines across span. */
export function gridStep(span: number, candidates = [1, 2, 2.5, 5]): number {
  const target = span / 8;
  const power = 10 ** Math.floor(Math.log10(target));
  let best = candidates[0] * power;
  for (const scale of [power, power * 10]) for (const c of candidates) if (Math.abs(c * scale - target) < Math.abs(best - target)) best = c * scale;
  return best;
}

/** Grid lines with labels. toPx maps a value on each axis to canvas px. */
function drawGrid(
  ctx: CanvasRenderingContext2D, x: [number, number], y: [number, number], step: number,
  toPx: (axis: 'x' | 'y', value: number) => number, label: (value: number) => string,
) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.font = '12px sans-serif';
  ctx.lineWidth = 1;
  for (const axis of ['x', 'y'] as const) {
    const [from, to] = axis === 'x' ? x : y;
    for (let v = Math.ceil(from / step - 1e-9) * step; v <= to + 1e-9; v += step) {
      const p = Math.round(toPx(axis, v)) + 0.5;
      ctx.strokeStyle = 'rgba(0, 150, 255, 0.55)';
      ctx.beginPath();
      if (axis === 'x') { ctx.moveTo(p, 0); ctx.lineTo(p, height); } else { ctx.moveTo(0, p); ctx.lineTo(width, p); }
      ctx.stroke();
      const text = label(v);
      const w = ctx.measureText(text).width + 6;
      const [tx, ty] = axis === 'x' ? [p + 2, 2] : [2, p + 2];
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(tx, ty, w, 15);
      ctx.fillStyle = '#0068c9';
      ctx.fillText(text, tx + 3, ty + 12);
    }
  }
  ctx.restore();
}

function toImage(canvas: HTMLCanvasElement): ToolOutcome['image'] {
  const url = canvas.toDataURL('image/jpeg', 0.8);
  return { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) };
}

function fractions(value: unknown, label: string, count: number): number[] {
  if (!Array.isArray(value) || value.length !== count || value.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
    fail(`${label} needs ${count} numbers from 0 to 1 (fractions of the page width and height).`);
  }
  return value as number[];
}

const pageNumber = (value: unknown) => value === undefined ? 1 : Number.isInteger(value) ? value as number : fail('page must be a whole number.');
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

async function viewDrawing(input: Record<string, unknown>): Promise<ToolOutcome> {
  const drawing = latest();
  const page = pageNumber(input.page);
  const { pages, aspect } = await pageInfo(drawing, page);
  const region = input.region === undefined ? [0, 0, 1, 1] : fractions(input.region, 'region', 4);
  const [x0, y0, x1, y1] = region;
  if (x1 - x0 < 0.005 || y1 - y0 < 0.005) fail('region must run from its top-left to its bottom-right corner and be at least 0.005 across.');
  // Size the whole page so the region's long edge comes out at VIEW_EDGE px.
  const regionW = x1 - x0, regionH = (y1 - y0) / aspect;
  const fullWidth = VIEW_EDGE / Math.max(regionW, regionH);
  const { canvas, ctx } = await renderRegion(drawing, page, region, fullWidth);
  const step = gridStep(Math.max(x1 - x0, y1 - y0), [1, 2, 5]);
  drawGrid(ctx, [x0, x1], [y0, y1], step,
    (axis, v) => axis === 'x' ? (v - x0) / (x1 - x0) * canvas.width : (v - y0) / (y1 - y0) * canvas.height, fmt);
  return {
    text: `"${drawing.name}" page ${page} of ${pages}, region x ${fmt(x0)}–${fmt(x1)}, y ${fmt(y0)}–${fmt(y1)} in fractions of the page (x of its width, y of its height). Blue grid lines every ${fmt(step)}.`,
    image: toImage(canvas),
  };
}

async function traceDrawing(input: Record<string, unknown>): Promise<ToolOutcome> {
  const drawing = latest();
  const page = pageNumber(input.page);
  const { aspect } = await pageInfo(drawing, page);
  const [ax, ay] = fractions(input.a, 'a', 2), [bx, by] = fractions(input.b, 'b', 2);
  const [ox, oy] = input.origin === undefined ? [ax, ay] : fractions(input.origin, 'origin', 2);
  const distance = Number(input.distance);
  if (!Number.isFinite(distance) || distance < 10 || distance > 100_000) fail('distance must be the real distance between a and b in cm.');
  const width = aspect >= 1 ? TRACE_EDGE : TRACE_EDGE * aspect, height = width / aspect;
  const px = Math.hypot((bx - ax) * width, (by - ay) * height);
  if (px < 20) fail('a and b are too close together. Pick two points far apart, such as the ends of the longest dimension line.');
  const { canvas } = await renderRegion(drawing, page, [0, 0, 1, 1], width);
  const scale = distance / px;
  const background: BackgroundImage = {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    position: { x: (width / 2 - ox * width) * scale, y: (height / 2 - oy * height) * scale },
    scale, opacity: 0.5, rotation: 0, locked: true,
  };
  setBackgroundImage(background);
  const left = -ox * width * scale, top = -oy * height * scale;
  return {
    text: `Laid page ${page} of "${drawing.name}" under the plan at ${fmt(1 / scale)} px per cm. The page spans x ${Math.round(left)} to ${Math.round(left + width * scale)} cm and y ${Math.round(top)} to ${Math.round(top + height * scale)} cm; the origin point you gave is plan (0, 0). Use view_plan to read positions off it in cm.`,
    changed: [],
  };
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let promise = imageCache.get(url);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The traced drawing could not be loaded.'));
      image.src = url;
    });
    imageCache.clear();
    imageCache.set(url, promise);
  }
  return promise;
}

function wallPath(wall: Wall): Point[] {
  if (!wall.curvePoint) return [wall.start, wall.end];
  return Array.from({ length: 17 }, (_, i) => wallPointAt(wall, i / 16));
}

async function viewPlan(input: Record<string, unknown>): Promise<ToolOutcome> {
  const floor = get(activeFloor) ?? fail('No plan is open.');
  const bg = floor.backgroundImage;
  let x: number, y: number, w: number, d: number;
  if (input.x !== undefined || input.y !== undefined || input.width !== undefined || input.depth !== undefined) {
    [x, y, w, d] = [input.x, input.y, input.width, input.depth].map(Number);
    if (![x, y, w, d].every(Number.isFinite) || w < 20 || d < 20 || w > 20000 || d > 20000) fail('x, y, width and depth must give an area at least 20 cm across, in cm.');
  } else {
    const points = floor.walls.flatMap(wall => [wall.start, wall.end]);
    if (!points.length) fail('The plan is empty. Give x, y, width and depth to look at part of the traced drawing.');
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    x = Math.min(...xs) - 60; y = Math.min(...ys) - 60;
    w = Math.max(...xs) - x + 60; d = Math.max(...ys) - y + 60;
  }
  const k = VIEW_EDGE / Math.max(w, d);
  const { canvas, ctx } = canvasOf(w * k, d * k);
  const toPx = (p: Point) => ({ x: (p.x - x) * k, y: (p.y - y) * k });

  if (bg) {
    const image = await loadImage(bg.dataUrl);
    const c = toPx(bg.position);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.translate(c.x, c.y);
    ctx.rotate(bg.rotation * Math.PI / 180);
    const iw = image.width * bg.scale * k, ih = image.height * bg.scale * k;
    ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }
  drawGrid(ctx, [x, x + w], [y, y + d], gridStep(Math.max(w, d), [1, 2, 2.5, 5]),
    (axis, v) => axis === 'x' ? (v - x) * k : (v - y) * k, v => `${Math.round(v)}`);

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const wall of floor.walls) {
    const path = wallPath(wall).map(toPx);
    ctx.beginPath();
    path.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = 'rgba(230, 0, 120, 0.35)';
    ctx.lineWidth = Math.max(2, wall.thickness * k);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200, 0, 100, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const opening = (wallId: string, position: number, width: number, color: string) => {
    const wall = floor.walls.find(w => w.id === wallId);
    if (!wall) return;
    const length = wallLength(wall), t = width / 2 / length;
    const a = toPx(wallPointAt(wall, Math.max(0, position - t))), b = toPx(wallPointAt(wall, Math.min(1, position + t)));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, wall.thickness * k * 0.6);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  for (const door of floor.doors) opening(door.wallId, door.position, door.width, 'rgba(0, 160, 60, 0.9)');
  for (const win of floor.windows) opening(win.wallId, win.position, win.width, 'rgba(0, 90, 255, 0.9)');
  ctx.restore();

  return {
    text: `Plan from x ${Math.round(x)} to ${Math.round(x + w)} cm and y ${Math.round(y)} to ${Math.round(y + d)} cm, grid labelled in cm. Walls are pink (their full thickness, with the centre line darker), doors green, windows blue${bg ? ', over the traced drawing' : ''}.`,
    image: toImage(canvas),
  };
}

const HANDLERS: Record<string, (input: Record<string, unknown>) => Promise<ToolOutcome>> = {
  view_drawing: viewDrawing,
  trace_drawing: traceDrawing,
  view_plan: viewPlan,
};

export const isDrawingTool = (name: string) => name in HANDLERS;

export async function runDrawingTool(name: string, input: unknown): Promise<ToolOutcome> {
  try {
    return await HANDLERS[name](input && typeof input === 'object' ? input as Record<string, unknown> : {});
  } catch (error) {
    if (error instanceof DrawingError) return { text: `error: ${error.message}`, isError: true };
    console.error('assistant drawing tool failed', name, error);
    return { text: `error: the tool failed (${(error as Error)?.message ?? 'unknown'}).`, isError: true };
  }
}
