import { describe, expect, it } from 'vitest';
import type { Floor, PlanSection, Wall } from '$lib/models/types';
import { computeSection } from '$lib/utils/sectionCut';
import { fittedTextScale, sectionPrimitives, sectionSvg, sectionViewBox } from '$lib/utils/sectionSvg';

const wall = (id: string, x0: number, y0: number, x1: number, y1: number): Wall =>
  ({ id, start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 10, height: 280, color: '#eee' });

/** Two rooms (x 0..400 and 400..600), a door in the partition and a table in the living room. */
function twoRooms(): { floors: Floor[] } {
  const floor: Floor = {
    id: 'g', name: 'Ground <floor>', level: 0, walls: [
      wall('north', 0, 0, 600, 0), wall('east', 600, 0, 600, 300), wall('south', 600, 300, 0, 300), wall('west', 0, 300, 0, 0),
      wall('partition', 400, 0, 400, 300),
    ],
    rooms: [], doors: [{ id: 'door', wallId: 'partition', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left', flipSide: false }],
    windows: [{ id: 'win', wallId: 'north', position: 1 / 3, width: 120, height: 120, sillHeight: 90, type: 'standard' }],
    furniture: [{ id: 'table', catalogId: 'table', position: { x: 200, y: 100 }, rotation: 0, scale: { x: 1, y: 1, z: 1 } }],
    stairs: [], columns: [], guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [],
  };
  return { floors: [floor] };
}
const section: PlanSection = { id: 's', code: 'A', start: { x: -50, y: 150 }, end: { x: 650, y: 150 }, look: -1 };
const options = { units: 'metric' as const, labels: { title: 'Section A–A' } };

describe('section SVG', () => {
  it('draws cut walls and slabs filled, beyond outlined, dashed ceilings, names and dimensions', () => {
    const model = computeSection(twoRooms(), section);
    const svg = sectionSvg(model, options);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<title>Section A–A</title>');
    expect(svg).toContain('>Section A–A</text>');
    // Three cut walls (the partition only above the door) and one slab, all poché.
    expect(svg.match(/<rect class="cut"/g)).toHaveLength(4);
    expect(svg).toMatch(/<rect class="cut" data-id="partition" x="445" y="-280" width="10" height="70" fill="#1f2937"/);
    expect(svg).toContain('class="cut-opening" data-id="door"');
    // The north wall beyond with its window, and the table in front of it, outlined on white.
    expect(svg).toMatch(/<polygon class="beyond-wall" data-id="north"[^>]*fill="#ffffff" stroke="#475569"/);
    expect(svg).toContain('class="beyond-opening" data-id="win"');
    expect(svg).toMatch(/<rect class="item" data-id="table" x="200" y="-75" width="100" height="75"/);
    expect(svg.indexOf('beyond-wall')).toBeLessThan(svg.indexOf('class="item"'));
    expect(svg.indexOf('class="item"')).toBeLessThan(svg.indexOf('class="cut"'));
    expect(svg.match(/class="ceiling"[^>]*stroke-dasharray/g)).toHaveLength(2);
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
    // Storey name escaped, at the left; dimensions with their values.
    expect(svg).toContain('>Ground &lt;floor&gt;</text>');
    expect(svg).toContain('>3.9 m</text>'); // living room clear width
    expect(svg).toContain('>1.9 m</text>'); // bathroom clear width
    expect(svg).toContain('>2.8 m</text>'); // ceiling height
    expect(svg).toContain('>6.1 m</text>'); // overall length, outer faces
    expect(svg.match(/class="dim"/g)!.length).toBeGreaterThanOrEqual(12);
  });

  it('formats imperial units and switches palettes for the dark theme', () => {
    const model = computeSection(twoRooms(), section);
    const svg = sectionSvg(model, { ...options, units: 'imperial', theme: 'dark' });
    expect(svg).toContain('>9&apos;2&quot;</text>'); // 280 cm
    expect(svg).toContain('fill="#111827"');
    expect(svg).toMatch(/<rect class="cut"[^>]*fill="#e5e7eb"/);
  });

  it('fits: one annotation unit becomes one pixel in the box', () => {
    const model = computeSection(twoRooms(), section);
    const ts = fittedTextScale(model, options, 1000, 600);
    const box = sectionViewBox(model, options, ts);
    expect(Math.max(box.w / 1000, box.h / 600)).toBeCloseTo(ts, 5);
    expect(sectionPrimitives(model, options, ts).find(p => p.shape === 'text' && p.role === 'title')).toBeTruthy();
  });

  it('shows the empty label when the line crosses nothing', () => {
    const model = computeSection(twoRooms(), { ...section, start: { x: 2000, y: 0 }, end: { x: 2100, y: 0 } });
    expect(model.storeys).toEqual([]);
    const svg = sectionSvg(model, { ...options, labels: { title: 'Section A–A', empty: 'Nothing is cut here' } });
    expect(svg).toContain('>Nothing is cut here</text>');
  });
});
