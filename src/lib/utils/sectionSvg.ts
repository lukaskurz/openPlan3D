import type { SectionDimension, SectionModel } from './sectionCut';
import { formatLength } from '$lib/stores/settings';
import { escapeXml } from './exportText';

/**
 * Drawing of a section (spec §5.4) as primitives shared by the SVG (viewer, SVG export)
 * and the PDF export, so both show the same thing.
 *
 * Drawing coordinates: x = u (cm, right), y = −z (cm, down). Annotations (text sizes,
 * dimension offsets, margins) are given in annotation units (au); `textScale` is the
 * number of drawing cm per au, so the viewer picks it to make 1 au one screen pixel and
 * the PDF to make it a fixed size on paper. Stroke widths are in px / points and do not
 * scale with the drawing (vector-effect: non-scaling-stroke).
 */

export type SectionTheme = 'light' | 'dark';
export type SectionRole =
  | 'bg' | 'cut' | 'cut-opening' | 'glass' | 'beyond-wall' | 'beyond-opening' | 'item' | 'hang' | 'ceiling'
  | 'ground' | 'pipe' | 'dim' | 'dim-text' | 'title' | 'floor-name' | 'floor-level' | 'room-name' | 'empty';

export type SectionPrimitive =
  | { shape: 'rect'; role: SectionRole; x: number; y: number; w: number; h: number; id?: string }
  | { shape: 'polygon'; role: SectionRole; points: [number, number][]; id?: string }
  | { shape: 'line'; role: SectionRole; x1: number; y1: number; x2: number; y2: number }
  | { shape: 'circle'; role: SectionRole; cx: number; cy: number; r: number; color?: string }
  | { shape: 'text'; role: SectionRole; x: number; y: number; text: string; size: number; anchor: 'start' | 'middle' | 'end'; rotate?: boolean; bold?: boolean };

export interface SectionStyle { fill?: string; stroke?: string; width?: number; dash?: number[] }

const PALETTES: Record<SectionTheme, Record<'bg' | 'poche' | 'line' | 'beyond' | 'paper' | 'opening' | 'dim' | 'text' | 'muted', string>> = {
  light: { bg: '#ffffff', poche: '#1f2937', line: '#0f172a', beyond: '#475569', paper: '#ffffff', opening: '#94a3b8', dim: '#334155', text: '#0f172a', muted: '#64748b' },
  dark: { bg: '#111827', poche: '#e5e7eb', line: '#f8fafc', beyond: '#94a3b8', paper: '#111827', opening: '#64748b', dim: '#cbd5e1', text: '#f1f5f9', muted: '#9ca3af' },
};

/** Fill, stroke and stroke width (px) of each role. */
export function sectionStyle(role: SectionRole, theme: SectionTheme = 'light'): SectionStyle {
  const c = PALETTES[theme];
  switch (role) {
    case 'bg': return { fill: c.bg };
    case 'cut': return { fill: c.poche, stroke: c.poche, width: 0.75 };
    case 'cut-opening': return { fill: c.paper, stroke: c.poche, width: 0.75 };
    case 'glass': return { stroke: c.opening, width: 1 };
    case 'beyond-wall': return { fill: c.paper, stroke: c.beyond, width: 1 };
    case 'beyond-opening': return { fill: c.paper, stroke: c.opening, width: 0.75 };
    case 'item': return { fill: c.paper, stroke: c.beyond, width: 1 };
    case 'hang': return { stroke: c.beyond, width: 0.75 };
    case 'ceiling': return { stroke: c.muted, width: 1, dash: [6, 4] };
    case 'ground': return { stroke: c.line, width: 2 };
    case 'pipe': return { stroke: c.line, width: 0.75 };
    case 'dim': return { stroke: c.dim, width: 0.75 };
    case 'dim-text': case 'floor-level': case 'empty': return { fill: c.muted };
    case 'title': case 'floor-name': case 'room-name': return { fill: c.text };
  }
}

/** Annotation sizes, au. */
const FONT = { title: 16, floor: 12, level: 10, room: 11, dim: 10, empty: 12 } as const;
const TICK = 4;
const NAME_GAP = 52;

/** Rough text width for layout, au (average glyph ≈ 0.56 em). */
const textWidth = (text: string, size: number) => text.length * size * 0.56;

export interface SectionDrawingOptions {
  units: 'metric' | 'imperial';
  labels: { title: string; empty?: string };
}

/** Space the annotations need around the model, au. */
export function sectionMargins(model: SectionModel, options: SectionDrawingOptions) {
  const names = Math.max(0, ...model.storeys.map(s => textWidth(s.name, FONT.floor)), textWidth(options.labels.title, FONT.title) - 60);
  return { left: NAME_GAP + names + 16, right: 24, top: 44, bottom: 60 };
}

/** The drawing's extent in drawing coordinates for a text scale. */
export function sectionViewBox(model: SectionModel, options: SectionDrawingOptions, textScale: number) {
  const m = sectionMargins(model, options);
  const { minU, maxU, minZ, maxZ } = model.bounds;
  const x = minU - m.left * textScale, y = -maxZ - m.top * textScale;
  return { x, y, w: maxU - minU + (m.left + m.right) * textScale, h: maxZ - minZ + (m.top + m.bottom) * textScale };
}

/** Text scale (cm per au) that makes 1 au one pixel when the drawing is fitted into a box of px. */
export function fittedTextScale(model: SectionModel, options: SectionDrawingOptions, width: number, height: number): number {
  const m = sectionMargins(model, options);
  const w = Math.max(1, model.bounds.maxU - model.bounds.minU), h = Math.max(1, model.bounds.maxZ - model.bounds.minZ);
  const scale = Math.min((width - m.left - m.right) / w, (height - m.top - m.bottom) / h);
  return 1 / Math.max(scale, 1e-3);
}

/** A default text scale for files: the larger extent spans about 900 au. */
export function defaultTextScale(model: SectionModel): number {
  const { minU, maxU, minZ, maxZ } = model.bounds;
  return Math.max(0.2, Math.max(maxU - minU, maxZ - minZ, 100) / 900);
}

/** Every primitive of the drawing, painted in order. */
export function sectionPrimitives(model: SectionModel, options: SectionDrawingOptions, textScale: number): SectionPrimitive[] {
  const ts = textScale;
  const out: SectionPrimitive[] = [];
  const box = sectionViewBox(model, options, ts);
  const fmt = (cm: number) => formatLength(Math.abs(cm), options.units);
  const y = (z: number) => -z;
  out.push({ shape: 'rect', role: 'bg', x: box.x, y: box.y, w: box.w, h: box.h });

  // Beyond, far to near, each painted over what is behind it.
  for (const shape of model.beyond) {
    if (shape.kind === 'wall') {
      out.push({ shape: 'polygon', role: 'beyond-wall', id: shape.wallId, points: shape.points.map(p => [p.u, y(p.z)]) });
      for (const o of shape.openings) {
        out.push({ shape: 'rect', role: 'beyond-opening', id: o.id, x: o.u0, y: y(o.z1), w: o.u1 - o.u0, h: o.z1 - o.z0 });
        if (o.kind === 'window') out.push({ shape: 'line', role: 'glass', x1: o.u0, y1: y((o.z0 + o.z1) / 2), x2: o.u1, y2: y((o.z0 + o.z1) / 2) });
      }
    } else {
      if (shape.hang) out.push({ shape: 'line', role: 'hang', x1: shape.hang.u, y1: y(shape.hang.z0), x2: shape.hang.u, y2: y(shape.hang.z1) });
      out.push({ shape: 'rect', role: 'item', id: shape.itemId, x: shape.u0, y: y(shape.z1), w: Math.max(0.5, shape.u1 - shape.u0), h: shape.z1 - shape.z0 });
    }
  }

  // Ceilings (dashed) over each room's clear span.
  for (const room of model.rooms) {
    out.push({ shape: 'line', role: 'ceiling', x1: room.u0, y1: y(room.base + room.ceiling), x2: room.u1, y2: y(room.base + room.ceiling) });
  }

  // Cut: slabs, then walls with their openings.
  for (const slab of model.slabs) out.push({ shape: 'rect', role: 'cut', x: slab.u0, y: y(slab.z1), w: slab.u1 - slab.u0, h: slab.z1 - slab.z0 });
  for (const wall of model.walls) {
    for (const piece of wall.pieces) out.push({ shape: 'rect', role: 'cut', id: wall.wallId, x: wall.u0, y: y(piece.z1), w: wall.u1 - wall.u0, h: piece.z1 - piece.z0 });
    for (const o of wall.openings) {
      out.push({ shape: 'rect', role: 'cut-opening', id: o.id, x: o.u0, y: y(o.z1), w: o.u1 - o.u0, h: o.z1 - o.z0 });
      if (o.kind === 'window') out.push({ shape: 'line', role: 'glass', x1: (o.u0 + o.u1) / 2, y1: y(o.z0), x2: (o.u0 + o.u1) / 2, y2: y(o.z1) });
    }
  }
  for (const pipe of model.pipes) out.push({ shape: 'circle', role: 'pipe', cx: pipe.u, cy: y(pipe.z), r: Math.max(pipe.r, 1.5 * ts), color: pipe.color });

  // Ground line under the lowest storey.
  const lowest = model.storeys[0];
  if (lowest) {
    const z = lowest.base - lowest.slabThickness;
    out.push({ shape: 'line', role: 'ground', x1: model.bounds.minU - 12 * ts, y1: y(z), x2: model.bounds.maxU + 12 * ts, y2: y(z) });
  }

  // Storey names and levels at the left.
  for (const storey of model.storeys) {
    const x = model.bounds.minU - NAME_GAP * ts;
    out.push({ shape: 'text', role: 'floor-name', x, y: y(storey.base) - 18 * ts, text: storey.name, size: FONT.floor, anchor: 'end', bold: true });
    out.push({ shape: 'text', role: 'floor-level', x, y: y(storey.base) - 5 * ts, text: `${storey.base < 0 ? '−' : storey.base > 0 ? '+' : '±'}${fmt(storey.base)}`, size: FONT.level, anchor: 'end' });
  }

  // Room names, centred in the room under its ceiling.
  for (const room of model.rooms) {
    const width = room.u1 - room.u0;
    if (!room.name || textWidth(room.name, FONT.room) * ts > width - 8 * ts) continue;
    out.push({ shape: 'text', role: 'room-name', x: (room.u0 + room.u1) / 2, y: y(room.base + room.ceiling) + 22 * ts, text: room.name, size: FONT.room, anchor: 'middle' });
  }

  for (const dim of model.dimensions) out.push(...dimension(dim, ts, fmt));

  out.push({ shape: 'text', role: 'title', x: box.x + 8 * ts, y: box.y + 22 * ts, text: options.labels.title, size: FONT.title, anchor: 'start', bold: true });
  if (!model.storeys.length && options.labels.empty) {
    out.push({ shape: 'text', role: 'empty', x: (model.bounds.minU + model.bounds.maxU) / 2, y: box.y + box.h / 2, text: options.labels.empty, size: FONT.empty, anchor: 'middle' });
  }
  return out;
}

function dimension(dim: SectionDimension, ts: number, fmt: (cm: number) => string): SectionPrimitive[] {
  const label = fmt(dim.to - dim.from);
  const tick = TICK * ts;
  if (dim.axis === 'h') {
    const yy = -dim.at + dim.offset * ts;
    const ticks: SectionPrimitive[] = [dim.from, dim.to].map(x => ({ shape: 'line', role: 'dim', x1: x - tick, y1: yy + tick, x2: x + tick, y2: yy - tick }));
    return [
      { shape: 'line', role: 'dim', x1: dim.from, y1: yy, x2: dim.to, y2: yy }, ...ticks,
      { shape: 'text', role: 'dim-text', x: (dim.from + dim.to) / 2, y: yy - 4 * ts, text: label, size: FONT.dim, anchor: 'middle' },
    ];
  }
  const xx = dim.at + dim.offset * ts;
  const ticks: SectionPrimitive[] = [dim.from, dim.to].map(z => ({ shape: 'line', role: 'dim', x1: xx - tick, y1: -z + tick, x2: xx + tick, y2: -z - tick }));
  return [
    { shape: 'line', role: 'dim', x1: xx, y1: -dim.from, x2: xx, y2: -dim.to }, ...ticks,
    { shape: 'text', role: 'dim-text', x: xx - 4 * ts, y: -(dim.from + dim.to) / 2, text: label, size: FONT.dim, anchor: 'middle', rotate: true },
  ];
}

export interface SectionSvgOptions extends SectionDrawingOptions {
  theme?: SectionTheme;
  /** Drawing cm per annotation unit; default `defaultTextScale`. */
  textScale?: number;
  /** The svg element's width and height attributes; default the viewBox size in px. */
  width?: string;
  height?: string;
}

const num = (value: number) => String(Math.round(value * 100) / 100);

/** The section as a standalone SVG document string. */
export function sectionSvg(model: SectionModel, options: SectionSvgOptions): string {
  const theme = options.theme ?? 'light';
  const ts = options.textScale ?? defaultTextScale(model);
  const box = sectionViewBox(model, options, ts);
  const body = sectionPrimitives(model, options, ts).map(p => primitiveSvg(p, theme, ts)).join('\n');
  const width = options.width ?? num(box.w), height = options.height ?? num(box.h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(box.x)} ${num(box.y)} ${num(box.w)} ${num(box.h)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" data-section="${escapeXml(model.code)}">
<title>${escapeXml(options.labels.title)}</title>
${body}
</svg>`;
}

function paint(style: SectionStyle, color?: string): string {
  const fill = style.fill ?? 'none';
  const stroke = color ?? style.stroke;
  let attrs = ` fill="${fill}"`;
  if (stroke) {
    attrs += ` stroke="${stroke}" stroke-width="${style.width ?? 1}" vector-effect="non-scaling-stroke"`;
    if (style.dash) attrs += ` stroke-dasharray="${style.dash.join(' ')}"`;
  }
  return attrs;
}

function primitiveSvg(p: SectionPrimitive, theme: SectionTheme, ts: number): string {
  const style = sectionStyle(p.role, theme);
  const cls = ` class="${p.role}"`;
  const id = 'id' in p && p.id ? ` data-id="${escapeXml(p.id)}"` : '';
  switch (p.shape) {
    case 'rect': return `<rect${cls}${id} x="${num(p.x)}" y="${num(p.y)}" width="${num(Math.max(0, p.w))}" height="${num(Math.max(0, p.h))}"${paint(style)}${p.role === 'cut' ? ' stroke-linejoin="miter"' : ''}/>`;
    case 'polygon': return `<polygon${cls}${id} points="${p.points.map(([x, y]) => `${num(x)},${num(y)}`).join(' ')}"${paint(style)}/>`;
    case 'line': return `<line${cls} x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}"${paint(style)}/>`;
    case 'circle': return `<circle${cls} cx="${num(p.cx)}" cy="${num(p.cy)}" r="${num(p.r)}" fill="${p.color ?? style.fill ?? 'none'}" stroke="${style.stroke}" stroke-width="${style.width ?? 1}" vector-effect="non-scaling-stroke"/>`;
    case 'text': {
      const rotate = p.rotate ? ` transform="rotate(-90 ${num(p.x)} ${num(p.y)})"` : '';
      return `<text${cls} x="${num(p.x)}" y="${num(p.y)}" font-size="${num(p.size * ts)}" text-anchor="${p.anchor}"${p.bold ? ' font-weight="600"' : ''} fill="${style.fill}"${rotate}>${escapeXml(p.text)}</text>`;
    }
  }
}
