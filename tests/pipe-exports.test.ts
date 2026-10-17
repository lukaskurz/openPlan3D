import { beforeEach, expect, it, vi } from 'vitest';
import { exportAsSVG } from '$lib/utils/export';
import { exportDXF } from '$lib/utils/cadExport';
import { planExportVisibility, visiblePlanFloor, planContentHidden } from '$lib/utils/exportVisibility';
import { hasPlanExportContent } from '$lib/utils/planExportContent';
import { pipesSvg } from '$lib/utils/pipeRenderer';
import { createDefaultProject } from '$lib/stores/project';
import type { Pipe } from '$lib/models/types';
import { roomProject } from './fixtures/project';

let downloaded: Blob[];

beforeEach(() => {
  downloaded = [];
  const ctx = new Proxy({ measureText: () => ({ width: 30 }) }, { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) });
  vi.stubGlobal('document', {
    createElement: (tag: string) => tag === 'canvas' ? { width: 400, height: 300, getContext: () => ctx } : { click: vi.fn() },
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded.push(blob as Blob); return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

const layers = { walls: true, doors: true, windows: true, furniture: false, stairs: true, columns: true, entourage: true, measurements: true, annotations: true, textAnnotations: true, roomLabels: true };
const visibility = planExportVisibility(layers, { showDimensions: true, showExternalDimensions: true, showInternalDimensions: true });
const pipes: Pipe[] = [
  { id: 'cold-1', kind: 'cold', diameter: 20, run: 'floor', points: [{ x: 20, y: 20 }, { x: 380, y: 20 }] },
  { id: 'waste-1', kind: 'waste', diameter: 110, run: 'floor', points: [{ x: 50, y: 250 }], riser: true },
];

it('keeps pipes in the exported floor whatever the layer switches', () => {
  const floor = { ...roomProject().floors[0], pipes };
  expect(visiblePlanFloor(floor, visibility).pipes).toEqual(pipes);
  const onlyPipes = { ...createDefaultProject('Pipes').floors[0], pipes };
  expect(hasPlanExportContent(onlyPipes)).toBe(true);
  expect(planContentHidden(onlyPipes, visibility)).toBe(false);
});

it('draws pipes in the SVG export in their colours, waste dashed, risers as rings', async () => {
  const project = roomProject();
  project.floors[0].pipes = pipes;
  expect(exportAsSVG(project, 'en', visibility)).toBe(true);
  const svg = await downloaded.at(-1)!.text();
  expect(svg).toContain('data-pipe="cold-1"');
  expect(svg).toMatch(/<polyline points="[^"]+" fill="none" stroke="#38bdf8"/);
  expect(svg).toContain('data-pipe="waste-1"');
  expect(svg).toMatch(/<circle [^>]*stroke="#a8a29e"/);
});

it('exports a floor with only pipes', async () => {
  const project = createDefaultProject('Only pipes');
  project.floors[0].pipes = [pipes[0]];
  expect(exportAsSVG(project, 'en', visibility)).toBe(true);
  expect(await downloaded.at(-1)!.text()).toContain('stroke="#38bdf8"');
});

it('dashes waste runs in SVG', () => {
  const svg = pipesSvg([{ id: 'w', kind: 'waste', diameter: 50, run: 'floor', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }], x => x, y => y);
  expect(svg).toContain('stroke-dasharray');
  expect(svg).toContain('stroke="#a8a29e"');
});

it('writes pipes to the DXF on per-kind PIPES layers', async () => {
  const project = roomProject();
  project.floors[0].pipes = pipes;
  expect(exportDXF(project, 'en', visibility)).toBe(true);
  const dxf = await downloaded.at(-1)!.text();
  expect(dxf).toContain('PIPES_COLD');
  expect(dxf).toContain('PIPES_WASTE');
  // The cold run's centreline, Y flipped like the rest of the drawing.
  expect(dxf).toMatch(/LWPOLYLINE[\s\S]*PIPES_COLD/);
  expect(dxf).toContain(String(0x38bdf8));
});
