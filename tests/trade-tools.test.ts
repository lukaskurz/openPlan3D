import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { selectedTool, selectedElementId, selectedElementIds, panMode } from '$lib/stores/project';
import { activeTrade, activeSurface, TRADES } from '$lib/stores/workContext';
import { chooseGroup, switchTrade, toolGroup } from '$lib/components/chrome/tools';
import {
  FIXED_TOOLS, TRADE_TOOLS, TRADE_INFO, tradeTools, homeOfTool, contextForTool, isFixedTool,
} from '$lib/components/chrome/tradeTools';

describe('tool bar data', () => {
  it('the fixed bar is Pan, Select, Measure in that order', () => {
    expect(FIXED_TOOLS.map(tool => tool.id)).toEqual(['view', 'select', 'annotate']);
  });

  it('Furnishing on the floor offers today’s drawing tools', () => {
    expect(tradeTools('furnishing', 'floor').map(tool => tool.id)).toEqual(['wall', 'openings', 'structure', 'furniture']);
  });

  it('other trades and the ceiling have no tools yet', () => {
    expect(tradeTools('furnishing', 'ceiling')).toEqual([]);
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
