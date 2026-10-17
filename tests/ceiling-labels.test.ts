import { describe, expect, it } from 'vitest';
import type { Wall } from '$lib/models/types';
import { createDefaultProject } from '$lib/stores/project';
import { resolveRooms } from '$lib/utils/roomDetection';
import { ceilingSummary } from '$lib/utils/ceilingHeights';
import { ceilingSummaryOfRooms, formatCeilingHeight, formatCeilingRange } from '$lib/utils/ceilingLabels';

describe('ceiling height text', () => {
  it('shows metric heights with two decimals', () => {
    expect(formatCeilingHeight(260, 'metric')).toBe('2.60 m');
    expect(formatCeilingHeight(245.5, 'metric')).toBe('2.46 m');
    expect(formatCeilingHeight(300, 'metric')).toBe('3.00 m');
  });

  it('shows imperial heights in feet and inches', () => {
    expect(formatCeilingHeight(243.84, 'imperial')).toBe('8\'');
  });

  it('shows a range, or one value when every room is the same', () => {
    expect(formatCeilingRange(240, 260, 'metric')).toBe('2.40–2.60 m');
    expect(formatCeilingRange(260, 260, 'metric')).toBe('2.60 m');
    expect(formatCeilingRange(243.84, 259.08, 'imperial')).toBe('8\'–8\'6"');
  });
});

describe('ceiling summary of resolved rooms', () => {
  function rect(prefix: string, x0: number, x1: number, height: number): Wall[] {
    const points = [{ x: x0, y: 0 }, { x: x1, y: 0 }, { x: x1, y: 300 }, { x: x0, y: 300 }];
    return points.map((start, i) => ({ id: `${prefix}${i}`, start, end: points[(i + 1) % 4], thickness: 10, height, color: '#eee' }));
  }

  it('agrees with ceilingSummary', () => {
    const project = createDefaultProject('Ceilings');
    const floor = project.floors[0];
    floor.walls = [...rect('a', 0, 400, 280), ...rect('b', 500, 700, 250)];
    floor.furniture = [
      { id: 'l1', catalogId: 'pendant_light', position: { x: 100, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      { id: 'l2', catalogId: 'smoke_detector', position: { x: 600, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      { id: 'p', catalogId: 'ceiling_projector', position: { x: 200, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
      { id: 's', catalogId: 'sofa', position: { x: 200, y: 200 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } },
    ];
    const rooms = resolveRooms(floor);
    const summary = ceilingSummaryOfRooms(project, floor, rooms);
    expect(summary).toEqual(ceilingSummary(project, floor));
    expect(summary).toEqual({ lights: 2, min: 250, max: 280 });
  });

  it('falls back to the floor default without rooms', () => {
    const project = createDefaultProject('Empty');
    const summary = ceilingSummaryOfRooms(project, project.floors[0], []);
    expect(summary.lights).toBe(0);
    expect(summary.min).toBe(summary.max);
    expect(summary.min).toBeGreaterThan(0);
  });
});
