import { describe, expect, it } from 'vitest';
import type { Floor, FurnitureItem } from '$lib/models/types';
import { createDefaultFloor } from '$lib/stores/project';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import {
  DIMMED_OPACITY, editableDef, editableFurniture, editablePlanFloor, planOpacity, structureEditable, structureOpacity,
  tradeForPlacing, type WorkContext,
} from '$lib/utils/workFilter';

const item = (id: string, catalogId: string, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

const sofa = item('sofa', 'sofa');
const pendant = item('pendant', 'pendant_light');
const projector = item('projector', 'ceiling_projector');
const outlet = item('outlet', 'sym_outlet');
const drain = item('drain', 'sym_drain');

const ctx = (trade: WorkContext['trade'], surface: WorkContext['surface']): WorkContext => ({ trade, surface });

describe('editable furniture', () => {
  it('Furnishing on the floor edits furnishing floor items only', () => {
    const work = ctx('furnishing', 'floor');
    expect(editableFurniture(sofa, work)).toBe(true);
    expect(editableFurniture(outlet, work)).toBe(false);
    expect(editableFurniture(drain, work)).toBe(false);
    expect(editableFurniture(pendant, work)).toBe(false);
  });

  it('Furnishing on the ceiling edits the ceiling items of every trade, and nothing on the floor', () => {
    const work = ctx('furnishing', 'ceiling');
    expect(editableFurniture(pendant, work)).toBe(true);
    expect(editableFurniture(projector, work)).toBe(true);
    expect(editableFurniture(item('smoke', 'smoke_detector'), work)).toBe(true);
    expect(editableFurniture(sofa, work)).toBe(false);
    expect(editableFurniture(outlet, work)).toBe(false);
  });

  it('Electrical and Plumbing stay strict to their trade on both surfaces', () => {
    expect(editableFurniture(outlet, ctx('electrical', 'floor'))).toBe(true);
    expect(editableFurniture(sofa, ctx('electrical', 'floor'))).toBe(false);
    expect(editableFurniture(pendant, ctx('electrical', 'ceiling'))).toBe(true);
    expect(editableFurniture(projector, ctx('electrical', 'ceiling'))).toBe(false);
    expect(editableFurniture(drain, ctx('plumbing', 'floor'))).toBe(true);
    expect(editableFurniture(pendant, ctx('plumbing', 'ceiling'))).toBe(false);
  });

  it('an item’s own mount wins over its catalog’s', () => {
    expect(editableFurniture({ ...sofa, mount: 'ceiling' }, ctx('furnishing', 'ceiling'))).toBe(true);
    expect(editableFurniture({ ...sofa, mount: 'ceiling' }, ctx('furnishing', 'floor'))).toBe(false);
  });

  it('chooses the trade for placing: the current one when it can edit the item, else the item’s', () => {
    const def = (id: string) => getCatalogItem(id)!;
    expect(editableDef(def('pendant_light'), 'furnishing')).toBe(true);
    expect(tradeForPlacing(def('pendant_light'), 'furnishing')).toBe('furnishing');
    expect(tradeForPlacing(def('pendant_light'), 'plumbing')).toBe('electrical');
    expect(tradeForPlacing(def('sym_outlet'), 'furnishing')).toBe('electrical');
    expect(tradeForPlacing(def('sofa'), 'electrical')).toBe('furnishing');
    expect(tradeForPlacing(def('sym_drain'), 'plumbing')).toBe('plumbing');
  });
});

describe('drawing strength', () => {
  it('dims what cannot be edited', () => {
    const work = ctx('furnishing', 'floor');
    expect(planOpacity(sofa, work)).toBe(1);
    expect(planOpacity(pendant, work)).toBe(DIMMED_OPACITY);
    expect(planOpacity(outlet, work)).toBe(DIMMED_OPACITY);
  });

  it('shows every ceiling item on the ceiling, floor and wall items dimmed', () => {
    for (const trade of ['furnishing', 'electrical', 'plumbing'] as const) {
      const work = ctx(trade, 'ceiling');
      expect(planOpacity(pendant, work)).toBe(1);
      expect(planOpacity(projector, work)).toBe(1);
      expect(planOpacity(sofa, work)).toBe(DIMMED_OPACITY);
      expect(planOpacity(outlet, work)).toBe(DIMMED_OPACITY);
    }
  });

  it('structure is editable, and drawn fully, only in Furnishing on the floor', () => {
    expect(structureEditable(ctx('furnishing', 'floor'))).toBe(true);
    expect(structureEditable(ctx('furnishing', 'ceiling'))).toBe(false);
    expect(structureEditable(ctx('electrical', 'floor'))).toBe(false);
    expect(structureOpacity(ctx('furnishing', 'floor'))).toBe(1);
    expect(structureOpacity(ctx('plumbing', 'floor'))).toBe(DIMMED_OPACITY);
  });
});

describe('editable plan floor', () => {
  function floor(): Floor {
    const f = createDefaultFloor();
    f.walls = [{ id: 'w', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 10, height: 280, color: '#eee' }];
    f.doors = [{ id: 'd', wallId: 'w', position: 0.5, width: 90, height: 210, type: 'single', swingDirection: 'left' } as Floor['doors'][number]];
    f.furniture = [sofa, pendant, outlet];
    f.stairs = [{ id: 's', position: { x: 0, y: 0 }, rotation: 0, width: 100, depth: 300, riserCount: 14, direction: 'up', stairType: 'straight' }];
    f.measurements = [{ id: 'm', x1: 0, y1: 0, x2: 100, y2: 0 }] as Floor['measurements'];
    return f;
  }

  it('keeps the floor as it is when everything is editable but other trades’ furniture', () => {
    const f = floor();
    const editable = editablePlanFloor(f, ctx('furnishing', 'floor'));
    expect(editable.furniture.map(i => i.id)).toEqual(['sofa']);
    expect(editable.walls).toBe(f.walls);
    expect(editable.doors).toBe(f.doors);
  });

  it('drops structure where it cannot be edited, keeping measurements', () => {
    const editable = editablePlanFloor(floor(), ctx('furnishing', 'ceiling'));
    expect(editable.furniture.map(i => i.id)).toEqual(['pendant']);
    expect(editable.walls).toEqual([]);
    expect(editable.doors).toEqual([]);
    expect(editable.stairs).toEqual([]);
    expect(editable.measurements?.map(m => m.id)).toEqual(['m']);
    expect(editablePlanFloor(floor(), ctx('electrical', 'floor')).furniture.map(i => i.id)).toEqual(['outlet']);
  });
});
