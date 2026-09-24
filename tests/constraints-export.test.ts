import { describe, expect, it } from 'vitest';
import type { Constraint, Floor, Wall } from '$lib/models/types';
import { dimensionShapePoints, dimensionsSvg, dxfArcAngles, floorDimensionShapes } from '$lib/utils/constraintRenderer';
import { createDefaultFloor } from '$lib/stores/project';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444444' });

function floor(constraints: Constraint[]): Floor {
  return { ...createDefaultFloor(), walls: [wall('b', 0, 0, 400, 0), wall('r', 400, 0, 400, 300)], constraints };
}

describe('dimension exports', () => {
  it('exports driving and reference dimensions but not constraint badges', () => {
    const f = floor([
      { id: 'len', kind: 'length', wallId: 'b', side: 0, value: 400 },
      { id: 'ang', kind: 'angle', wallA: 'b', wallB: 'r', flipB: true, value: -90, driven: true },
      { id: 'h', kind: 'horizontal', wallId: 'b' },
    ]);
    const shapes = floorDimensionShapes(f, 'metric');
    expect(shapes.map(s => s.shape.kind)).toEqual(['linear', 'arc']);
    expect(shapes[0].shape).toMatchObject({ text: '4 m' });
    expect(shapes[1].shape).toMatchObject({ text: '(90°)' });
    const svg = dimensionsSvg(f, 'metric', x => x, y => y, text => text);
    expect(svg).toContain('4 m');
    expect(svg).toContain('stroke-dasharray'); // the reference angle
    expect(svg).toContain('<path d="M');
    expect(dimensionShapePoints(shapes[0].shape).length).toBeGreaterThanOrEqual(2);
    expect(floorDimensionShapes(floor([]), 'metric')).toEqual([]);
  });

  it('turns screen arcs (Y down) into counter-clockwise DXF arcs', () => {
    // From +x to -y on screen is a quarter turn counter-clockwise with Y up.
    const angles = dxfArcAngles({ kind: 'arc', center: { x: 0, y: 0 }, radius: 50, from: 0, to: -Math.PI / 2, text: '' });
    expect(angles.start).toBeCloseTo(0); expect(angles.end).toBeCloseTo(90);
  });
});
