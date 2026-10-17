import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { loadProject, placingFurnitureId, selectedTool } from '$lib/stores/project';
import { catalogOpen, catalogScope } from '$lib/stores/chrome';
import { activeSurface, activeTrade } from '$lib/stores/workContext';
import { chooseGroup, finishTool, placeCatalogItem, switchTrade, toolGroup } from '$lib/components/chrome/tools';
import { switchSurface } from '$lib/components/chrome/surface';
import { contextForTool, groupForItem, homeOfTool, tradeTools } from '$lib/components/chrome/tradeTools';
import { pipeDraft, addDraftPoint } from '$lib/stores/pipeTool';
import { currentProject } from '$lib/stores/project';
import { roomProject } from './fixtures/project';

beforeEach(() => {
  loadProject(roomProject());
  chooseGroup('select');
  activeTrade.set('furnishing');
  activeSurface.set('floor');
  pipeDraft.set([]);
});

describe('plumbing tool bar', () => {
  it('offers Pipe, Fixture and Floor drain on the floor and Pipe on the ceiling', () => {
    expect(tradeTools('plumbing', 'floor').map(tool => tool.id)).toEqual(['pipe', 'fixture', 'drain']);
    expect(tradeTools('plumbing', 'ceiling').map(tool => tool.id)).toEqual(['pipe']);
    expect(tradeTools('plumbing', 'ceiling')[0].label).toBe('chrome.tool.pipeCeiling');
    expect(homeOfTool('pipe')).toEqual({ trade: 'plumbing', surface: 'floor' });
    expect(contextForTool('pipe', 'plumbing', 'ceiling')).toBeNull();
    expect(groupForItem('sym_drain')).toBe('drain');
    expect(groupForItem('toilet')).toBe('furniture');
  });

  it('the Pipe tool highlights Pipe, and from another trade brings Plumbing on the floor', () => {
    chooseGroup('pipe');
    expect(get(selectedTool)).toBe('pipe');
    expect(get(toolGroup)).toBe('pipe');
    expect(get(activeTrade)).toBe('plumbing');
    expect(get(activeSurface)).toBe('floor');
  });

  it('the Pipe tool stays on the ceiling for ceiling runs', () => {
    switchTrade('plumbing');
    switchSurface('ceiling');
    chooseGroup('pipe');
    expect(get(toolGroup)).toBe('pipe');
    expect(get(activeSurface)).toBe('ceiling');
  });

  it('Done ends the Pipe tool and keeps the run drawn so far', () => {
    chooseGroup('pipe');
    addDraftPoint({ x: 0, y: 0 });
    addDraftPoint({ x: 100, y: 0 });
    finishTool();
    expect(get(selectedTool)).toBe('select');
    expect(get(currentProject)!.floors[0].pipes).toHaveLength(1);
  });

  it('Floor drain arms the drain symbol in Plumbing', () => {
    switchTrade('plumbing');
    chooseGroup('drain');
    expect(get(placingFurnitureId)).toBe('sym_drain');
    expect(get(toolGroup)).toBe('drain');
    expect(get(activeTrade)).toBe('plumbing');
  });

  it('Fixture opens the catalog limited to plumbing, and placing a fixture keeps Plumbing', () => {
    switchTrade('plumbing');
    chooseGroup('fixture');
    expect(get(catalogOpen)).toBe(true);
    expect(get(catalogScope)).toBe('plumbing');
    expect(get(toolGroup)).toBe('fixture');
    expect(placeCatalogItem('toilet')).toBe(true);
    expect(get(activeTrade)).toBe('plumbing');
    expect(get(activeSurface)).toBe('floor');
    expect(get(placingFurnitureId)).toBe('toilet');
    expect(get(toolGroup)).toBe('fixture');
    // Any other tool clears the scope again.
    chooseGroup('furniture');
    expect(get(catalogScope)).toBe('all');
    expect(get(toolGroup)).toBe('furniture');
  });

  it('a fixture placed from Electrical switches to Furnishing, its own trade', () => {
    switchTrade('electrical');
    placeCatalogItem('toilet');
    expect(get(activeTrade)).toBe('furnishing');
  });
});
