import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Floor, PlanSection, Project, Wall } from '$lib/models/types';
import {
  addSection, createAlternative, createDefaultProject, currentProject, flipSection, loadProject, openSectionId, redo,
  removeElement, removeSection, selectedElementId, selectedElementIds, sideViewOpen, elevationWallId, undo, updateSection,
  undoHistoryStore, addWall, selectedTool,
} from '$lib/stores/project';
import {
  MIN_SECTION_LENGTH, hitTestSectionMarker, knownFloorIds, nextSectionCode, sectionAxes, sectionCode, sectionMarkerGeometry,
  sectionOnFloor, snapSectionEnd,
} from '$lib/utils/sectionPlan';
import { readProject } from '$lib/utils/projectValidation';
import { chooseGroup, toolGroup } from '$lib/components/chrome/tools';
import { activeTrade, activeSurface } from '$lib/stores/workContext';
import { undoMessage } from '$lib/i18n/undoMessages';
import { projectValidationMessage } from '$lib/i18n/projectValidationMessages';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall =>
  ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 15, height: 280, color: '#444444' });
const section = (over: Partial<PlanSection> = {}): PlanSection =>
  ({ id: 's1', code: 'A', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, look: 1, ...over });

describe('section codes', () => {
  it('counts A … Z, then AA, AB … ZZ, then AAA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(sectionCode)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('takes the first unused code, filling gaps', () => {
    expect(nextSectionCode([])).toBe('A');
    expect(nextSectionCode(['A', 'B'])).toBe('C');
    expect(nextSectionCode(['B', 'C'])).toBe('A');
    expect(nextSectionCode(['A', undefined, null])).toBe('B');
  });
});

describe('section tool snapping', () => {
  it('puts the end on the nearest 0/45/90° ray, keeping the length along it', () => {
    expect(snapSectionEnd({ x: 0, y: 0 }, { x: 300, y: 20 })).toEqual({ x: 300, y: 0 });
    expect(snapSectionEnd({ x: 0, y: 0 }, { x: 15, y: 300 })).toEqual({ x: 0, y: 300 });
    const diagonal = snapSectionEnd({ x: 0, y: 0 }, { x: 200, y: 180 });
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });

  it('leaves the end alone when snapping is bypassed', () => {
    expect(snapSectionEnd({ x: 0, y: 0 }, { x: 300, y: 20 }, true)).toEqual({ x: 300, y: 20 });
  });
});

describe('section geometry', () => {
  it('looks along look × the left normal of the cut', () => {
    expect(sectionAxes(section())!.view).toEqual({ x: -0, y: 1 });
    expect(sectionAxes(section({ look: -1 }))!.view).toEqual({ x: 0, y: -1 });
    expect(sectionAxes(section({ end: { x: 0, y: 0 } }))).toBeNull();
  });

  it('draws bubbles on the ends and arrowheads that point the way it looks, at screen sizes', () => {
    const near = sectionMarkerGeometry(section(), 1)!, far = sectionMarkerGeometry(section(), 0.5)!;
    expect(near.bubbles.map(b => b.center)).toEqual([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    expect(far.bubbles[0].radius).toBeCloseTo(near.bubbles[0].radius * 2);
    for (const [tip, a, b] of near.arrows) {
      expect(tip.y).toBeGreaterThan(Math.max(a.y, b.y));
    }
    const flipped = sectionMarkerGeometry(section({ look: -1 }), 1)!;
    for (const [tip, a] of flipped.arrows) expect(tip.y).toBeLessThan(a.y);
  });

  it('hits a bubble (a 44 px target) before the line, and misses beside it', () => {
    const sections = [section()];
    expect(hitTestSectionMarker({ x: 3, y: 20 }, sections, 1)).toEqual({ id: 's1', part: 'start' });
    expect(hitTestSectionMarker({ x: 395, y: -21 }, sections, 1)).toEqual({ id: 's1', part: 'end' });
    expect(hitTestSectionMarker({ x: 200, y: 5 }, sections, 1)).toEqual({ id: 's1', part: 'line' });
    expect(hitTestSectionMarker({ x: 200, y: 30 }, sections, 1)).toBeNull();
    // Zoomed out, the same screen distance covers more of the plan.
    expect(hitTestSectionMarker({ x: 200, y: 30 }, sections, 0.25)).toEqual({ id: 's1', part: 'line' });
  });

  it('prefers the later (topmost) of two overlapping sections', () => {
    const sections = [section(), section({ id: 's2', code: 'B' })];
    expect(hitTestSectionMarker({ x: 0, y: 0 }, sections, 1)?.id).toBe('s2');
  });
});

describe('sections on storeys', () => {
  const floorWith = (walls: Wall[], id = 'f1'): Floor => ({ ...createDefaultProject().floors[0], id, walls });

  it('shows on every storey whose content the cut crosses, and on empty ones', () => {
    const house = floorWith([wall('w', 0, 0, 500, 0), wall('w2', 500, 0, 500, 400)]);
    expect(sectionOnFloor(section({ start: { x: 250, y: -100 }, end: { x: 250, y: 500 } }), house)).toBe(true);
    expect(sectionOnFloor(section({ start: { x: 2000, y: -100 }, end: { x: 2000, y: 500 } }), house)).toBe(false);
    // Within the 1 m margin still counts.
    expect(sectionOnFloor(section({ start: { x: 550, y: -100 }, end: { x: 550, y: 500 } }), house)).toBe(true);
    expect(sectionOnFloor(section({ start: { x: 2000, y: 0 }, end: { x: 3000, y: 0 } }), floorWith([]))).toBe(true);
  });

  it('shows only on the storeys it names, ignoring ids the project does not know', () => {
    const project = createDefaultProject();
    const floor = project.floors[0];
    expect(sectionOnFloor(section({ floorIds: ['other'] }), floor)).toBe(false);
    expect(sectionOnFloor(section({ floorIds: [floor.id] }), floor, project)).toBe(true);
    expect(sectionOnFloor(section({ floorIds: ['gone'] }), floor, project)).toBe(true);
    expect([...knownFloorIds(project)]).toEqual([floor.id]);
  });
});

describe('section store', () => {
  let project: Project;
  beforeEach(() => {
    project = createDefaultProject();
    loadProject(project);
    selectedElementId.set(null);
    selectedElementIds.set(new Set());
  });
  const sections = () => get(currentProject)!.sections ?? [];

  it('adds sections with the next code, each one undoable', () => {
    const a = addSection({ x: 0, y: 0 }, { x: 400, y: 0 });
    const b = addSection({ x: 0, y: 100 }, { x: 0, y: 500 }, -1);
    expect(sections().map(s => [s.id, s.code, s.look])).toEqual([[a, 'A', 1], [b, 'B', -1]]);
    expect(get(undoHistoryStore).entries.at(-1)?.description).toBe('Added section');
    undo();
    expect(sections().map(s => s.code)).toEqual(['A']);
    redo();
    expect(sections().map(s => s.code)).toEqual(['A', 'B']);
  });

  it('refuses a cut that is not a line', () => {
    expect(addSection({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe('');
    expect(addSection({ x: NaN, y: 0 }, { x: 10, y: 10 })).toBe('');
    expect(get(currentProject)!.sections).toBeUndefined();
  });

  it('moves, flips and deletes, with undo', () => {
    const id = addSection({ x: 0, y: 0 }, { x: 400, y: 0 });
    updateSection(id, { end: { x: 400, y: 300 } });
    expect(sections()[0].end).toEqual({ x: 400, y: 300 });
    updateSection(id, { end: { x: 0, y: 0 } });
    expect(sections()[0].end).toEqual({ x: 400, y: 300 });
    flipSection(id);
    expect(sections()[0].look).toBe(-1);
    expect(get(undoHistoryStore).entries.at(-1)?.description).toBe('Reversed section');
    undo();
    expect(sections()[0].look).toBe(1);
    removeSection(id);
    expect(get(currentProject)!.sections).toBeUndefined();
    undo();
    expect(sections().map(s => s.id)).toEqual([id]);
  });

  it('is deleted through removeElement (Delete key, action slot), closing it when open', () => {
    const id = addSection({ x: 0, y: 0 }, { x: 400, y: 0 });
    selectedElementId.set(id);
    openSectionId.set(id);
    expect(get(sideViewOpen)).toBe(true);
    removeElement(id);
    expect(sections()).toEqual([]);
    expect(get(openSectionId)).toBeNull();
    expect(get(selectedElementId)).toBeNull();
    expect(get(sideViewOpen)).toBe(false);
  });

  it('keeps a selected section across undo of another edit, and prunes it when it is undone away', () => {
    const id = addSection({ x: 0, y: 0 }, { x: 400, y: 0 });
    selectedElementId.set(id);
    addWall({ x: 0, y: 200 }, { x: 300, y: 200 });
    undo();
    expect(get(selectedElementId)).toBe(id);
    openSectionId.set(id);
    selectedElementId.set(null);
    undo();
    expect(sections()).toEqual([]);
    expect(get(openSectionId)).toBeNull();
  });

  it('is shared by every alternative', () => {
    addSection({ x: 0, y: 0 }, { x: 400, y: 0 });
    createAlternative();
    expect(sections().map(s => s.code)).toEqual(['A']);
  });

  it('opens either side view', () => {
    expect(get(sideViewOpen)).toBe(false);
    elevationWallId.set('w');
    expect(get(sideViewOpen)).toBe(true);
    elevationWallId.set(null);
  });

  it('describes its undo steps in Portuguese', () => {
    expect(undoMessage('Added section', 'pt')).toBe('Corte adicionado');
    expect(undoMessage('Deleted section', 'pt')).toBe('Corte excluído');
  });
});

describe('reading sections', () => {
  const base = () => {
    const project = createDefaultProject();
    return JSON.parse(JSON.stringify(project));
  };

  it('round-trips sections', () => {
    const doc = base();
    doc.sections = [{ id: 's1', code: 'A', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, look: -1, floorIds: [doc.floors[0].id] }];
    const read = readProject(doc);
    expect(read.sections).toEqual(doc.sections);
    expect(readProject(JSON.parse(JSON.stringify(read))).sections).toEqual(doc.sections);
  });

  it('defaults the direction, drops zero-length cuts and unknown storeys, and repairs codes', () => {
    const doc = base();
    doc.sections = [
      { id: 'a', code: 'A', start: { x: 0, y: 0 }, end: { x: 400, y: 0 } },
      { id: 'b', code: 'A', start: { x: 0, y: 0 }, end: { x: 0, y: 400 }, floorIds: ['nowhere'] },
      { id: 'c', start: { x: 0, y: 0 }, end: { x: 300, y: 300 }, look: 1 },
      { id: 'd', code: 'Z', start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, look: 1 },
      { id: 'e', code: '  ', start: { x: 0, y: 0 }, end: { x: 10, y: 300 }, look: 1, floorIds: [doc.floors[0].id, 'nowhere'] },
    ];
    const read = readProject(doc);
    expect(read.sections!.map(s => [s.id, s.code, s.look])).toEqual([['a', 'A', 1], ['b', 'B', 1], ['c', 'C', 1], ['e', 'D', 1]]);
    expect(read.sections![1].floorIds).toBeUndefined();
    expect(read.sections![3].floorIds).toEqual([doc.floors[0].id]);
    expect(doc.sections[0].look).toBeUndefined();
  });

  it('keeps storeys of other alternatives', () => {
    const project = createDefaultProject();
    loadProject(project);
    createAlternative();
    const doc = JSON.parse(JSON.stringify(get(currentProject)));
    const inactive = doc.alternatives.find((alt: any) => alt.id !== doc.activeAlternativeId);
    inactive.floors[0].id = 'old-floor';
    doc.sections = [{ id: 's', code: 'A', start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, look: 1, floorIds: ['old-floor'] }];
    expect(readProject(doc).sections![0].floorIds).toEqual(['old-floor']);
  });

  it('rejects repeated ids and malformed sections', () => {
    const doc = base();
    doc.sections = [section(), section()];
    expect(() => readProject(doc)).toThrow('Invalid project: sections[1].id duplicates another section.');
    expect(projectValidationMessage('Invalid project: sections[1].id duplicates another section.', 'pt')).toContain('duplica outro corte');
    doc.sections = [section({ look: 2 as any })];
    expect(() => readProject(doc)).toThrow('sections[0].look');
    doc.sections = [{ ...section(), start: { x: 'a', y: 0 } }];
    expect(() => readProject(doc)).toThrow('sections[0].start.x');
    doc.sections = {};
    expect(() => readProject(doc)).toThrow('sections');
  });

  it('leaves projects without sections as they were', () => {
    expect('sections' in readProject(base())).toBe(false);
  });
});

describe('the Section tool', () => {
  it('is a fixed tool: choosing it keeps the trade and surface', () => {
    activeTrade.set('electrical');
    activeSurface.set('ceiling');
    chooseGroup('section');
    expect(get(selectedTool)).toBe('section');
    expect(get(toolGroup)).toBe('section');
    expect(get(activeTrade)).toBe('electrical');
    expect(get(activeSurface)).toBe('ceiling');
    chooseGroup('select');
    expect(get(toolGroup)).toBe('select');
    activeTrade.set('furnishing');
    activeSurface.set('floor');
  });

  it('ignores cuts shorter than 20 cm', () => {
    expect(MIN_SECTION_LENGTH).toBe(20);
  });
});
