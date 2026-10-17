import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selectedTool, selectedElementId, selectedElementIds, panMode, placingFurnitureId } from '$lib/stores/project';
import { catalogOpen } from '$lib/stores/chrome';
import { activeTrade, activeSurface, TRADES } from '$lib/stores/workContext';
import { chooseGroup, switchTrade, toolGroup, placeCatalogItem, placeCeilingVariant, ceilingPick } from '$lib/components/chrome/tools';
import {
  FIXED_TOOLS, TRADE_TOOLS, TRADE_INFO, tradeTools, homeOfTool, contextForTool, isFixedTool, groupForItem,
} from '$lib/components/chrome/tradeTools';

describe('tool bar data', () => {
  it('the fixed bar is Pan, Select, Measure in that order', () => {
    expect(FIXED_TOOLS.map(tool => tool.id)).toEqual(['view', 'select', 'annotate']);
  });

  it('Furnishing on the floor offers today’s drawing tools', () => {
    expect(tradeTools('furnishing', 'floor').map(tool => tool.id)).toEqual(['wall', 'openings', 'structure', 'furniture']);
  });

  it('Furnishing on the ceiling offers Ceiling height, Light, Fan and Smoke detector', () => {
    expect(tradeTools('furnishing', 'ceiling').map(tool => tool.id)).toEqual(['ceilingHeight', 'light', 'fan', 'smoke']);
  });

  it('other trades have no tools yet', () => {
    for (const trade of ['electrical', 'plumbing'] as const) {
      expect(tradeTools(trade, 'floor')).toEqual([]);
      expect(tradeTools(trade, 'ceiling')).toEqual([]);
    }
  });

  it('describes every trade and never repeats a fixed tool in a trade bar', () => {
    for (const trade of TRADES) {
      expect(TRADE_INFO[trade]).toBeDefined();
      for (const surface of ['floor', 'ceiling'] as const) {
        for (const tool of TRADE_TOOLS[trade][surface]) expect(isFixedTool(tool.id)).toBe(false);
      }
    }
  });

  it('finds the home of a trade tool, and none for fixed tools', () => {
    expect(homeOfTool('wall')).toEqual({ trade: 'furnishing', surface: 'floor' });
    expect(homeOfTool('furniture')).toEqual({ trade: 'furnishing', surface: 'floor' });
    expect(homeOfTool('light')).toEqual({ trade: 'furnishing', surface: 'ceiling' });
    expect(homeOfTool('ceilingHeight')).toEqual({ trade: 'furnishing', surface: 'ceiling' });
    expect(homeOfTool('select')).toBeNull();
    expect(homeOfTool('annotate')).toBeNull();
  });

  it('only asks for a switch when the current bar does not offer the tool', () => {
    expect(contextForTool('wall', 'furnishing', 'floor')).toBeNull();
    expect(contextForTool('view', 'electrical', 'ceiling')).toBeNull();
    expect(contextForTool('wall', 'electrical', 'floor')).toEqual({ trade: 'furnishing', surface: 'floor' });
    expect(contextForTool('openings', 'furnishing', 'ceiling')).toEqual({ trade: 'furnishing', surface: 'floor' });
  });
});

describe('trade follows the tool', () => {
  beforeEach(() => {
    chooseGroup('select');
    activeTrade.set('furnishing');
    activeSurface.set('floor');
  });

  it('a shortcut for a Furnishing tool switches to Furnishing on the floor', () => {
    activeTrade.set('electrical');
    activeSurface.set('ceiling');
    // What the W shortcut does: set the tool directly, without chooseGroup.
    selectedTool.set('wall');
    panMode.set(false);
    expect(get(toolGroup)).toBe('wall');
    expect(get(activeTrade)).toBe('furnishing');
    expect(get(activeSurface)).toBe('floor');
  });

  it('choosing a fixed tool keeps the trade', () => {
    activeTrade.set('plumbing');
    chooseGroup('annotate');
    chooseGroup('view');
    expect(get(activeTrade)).toBe('plumbing');
  });

  it('switching trade goes back to Select with nothing selected', () => {
    chooseGroup('wall');
    selectedElementId.set('w1');
    selectedElementIds.set(new Set(['w1', 'w2']));
    expect(switchTrade('electrical')).toBe(true);
    expect(get(activeTrade)).toBe('electrical');
    expect(get(toolGroup)).toBe('select');
    expect(get(selectedElementId)).toBeNull();
    expect(get(selectedElementIds).size).toBe(0);
    expect(switchTrade('electrical')).toBe(false);
  });
});

describe('placing a catalog item', () => {
  beforeEach(() => {
    chooseGroup('select');
    activeTrade.set('furnishing');
    activeSurface.set('floor');
  });

  it('switches to the item’s surface first (Furnishing edits every ceiling item), then arms it', () => {
    selectedElementId.set('sofa-1');
    expect(placeCatalogItem('pendant_light')).toBe(true);
    expect(get(activeTrade)).toBe('furnishing');
    expect(get(activeSurface)).toBe('ceiling');
    expect(get(placingFurnitureId)).toBe('pendant_light');
    expect(get(selectedTool)).toBe('furniture');
    expect(get(toolGroup)).toBe('light');
    expect(get(catalogOpen)).toBe(false);
    expect(get(selectedElementId)).toBeNull();
  });

  it('goes back to the floor for wall items and to Furnishing for furniture', () => {
    placeCatalogItem('sym_smoke');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
    placeCatalogItem('sym_outlet');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['electrical', 'floor']);
    expect(get(placingFurnitureId)).toBe('sym_outlet');
    placeCatalogItem('sym_drain');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['plumbing', 'floor']);
    placeCatalogItem('ceiling_projector');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
    placeCatalogItem('sofa');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'floor']);
    expect(get(placingFurnitureId)).toBe('sofa');
  });

  it('keeps the selection when nothing needs to switch, and refuses unknown ids', () => {
    selectedElementId.set('kept');
    placeCatalogItem('sofa');
    expect(get(selectedElementId)).toBe('kept');
    expect(placeCatalogItem('no-such-item')).toBe(false);
    expect(get(placingFurnitureId)).toBe('sofa');
  });

  it('an armed item keeps its context when the tool group changes around it', () => {
    placeCatalogItem('ceiling_light');
    // e.g. the canvas re-asserting the furniture tool while placing
    selectedTool.set('furniture');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
    chooseGroup('select');
    expect(get(placingFurnitureId)).toBeNull();
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
  });

  it('switches trade only when the current one cannot edit the item', () => {
    activeTrade.set('plumbing');
    placeCatalogItem('ceiling_light');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['electrical', 'ceiling']);
    // Electrical edits its own ceiling items, so a smoke detector keeps it.
    placeCatalogItem('smoke_detector');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['electrical', 'ceiling']);
    // …but not a ceiling projector (furnishing).
    placeCatalogItem('ceiling_projector');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
  });
});

describe('ceiling tools', () => {
  beforeEach(() => {
    chooseGroup('select');
    activeTrade.set('furnishing');
    activeSurface.set('floor');
  });

  it('Light, Fan and Smoke detector arm their items and switch to the ceiling, keeping Furnishing', () => {
    chooseGroup('light');
    expect(get(placingFurnitureId)).toBe('ceiling_light');
    expect(get(toolGroup)).toBe('light');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
    chooseGroup('fan');
    expect([get(placingFurnitureId), get(toolGroup)]).toEqual(['ceiling_fan', 'fan']);
    chooseGroup('smoke');
    expect([get(placingFurnitureId), get(toolGroup)]).toEqual(['smoke_detector', 'smoke']);
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
  });

  it('a light variant stays the Light tool and is remembered', () => {
    placeCeilingVariant('light', 'pendant_light');
    expect([get(placingFurnitureId), get(toolGroup)]).toEqual(['pendant_light', 'light']);
    chooseGroup('select');
    chooseGroup('light');
    expect(get(placingFurnitureId)).toBe('pendant_light');
    placeCeilingVariant('light', 'ceiling_light');
  });

  it('maps catalog items to their tool group', () => {
    expect(groupForItem('chandelier')).toBe('light');
    expect(groupForItem('sym_ceiling_fan')).toBe('fan');
    expect(groupForItem('sym_smoke')).toBe('smoke');
    expect(groupForItem('sofa')).toBe('furniture');
    expect(groupForItem(null)).toBe('furniture');
  });

  it('Ceiling height is Select limited to rooms, on the ceiling, until another tool is chosen', () => {
    chooseGroup('ceilingHeight');
    expect(get(toolGroup)).toBe('ceilingHeight');
    expect(get(ceilingPick)).toBe(true);
    expect(get(selectedTool)).toBe('select');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['furnishing', 'ceiling']);
    // A shortcut picking another tool leaves it.
    selectedTool.set('measure');
    expect(get(ceilingPick)).toBe(false);
    chooseGroup('ceilingHeight');
    chooseGroup('select');
    expect(get(ceilingPick)).toBe(false);
    expect(get(toolGroup)).toBe('select');
  });
});
