import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { panMode, selectedTool, placingStair } from '$lib/stores/project';
import { toolGroup, chooseGroup, finishTool, placeStairs, startingGroup } from '$lib/components/chrome/tools';

describe('tool groups', () => {
  beforeEach(() => chooseGroup('select'));

  it('Look around is pan mode on top of the Select tool', () => {
    chooseGroup('view');
    expect(get(toolGroup)).toBe('view');
    expect(get(panMode)).toBe(true);
    expect(get(selectedTool)).toBe('select');
    chooseGroup('select');
    expect(get(toolGroup)).toBe('select');
    expect(get(panMode)).toBe(false);
  });

  it('any drawing tool leaves Look around', () => {
    chooseGroup('view');
    chooseGroup('wall');
    expect(get(panMode)).toBe(false);
    expect(get(toolGroup)).toBe('wall');
    chooseGroup('view');
    placeStairs();
    expect(get(panMode)).toBe(false);
    expect(get(placingStair)).toBe(true);
    expect(get(toolGroup)).toBe('structure');
  });

  it('Done goes back to whichever of Look around and Select was chosen last', () => {
    chooseGroup('view');
    chooseGroup('openings');
    finishTool();
    expect(get(toolGroup)).toBe('view');
    chooseGroup('select');
    chooseGroup('annotate');
    finishTool();
    expect(get(toolGroup)).toBe('select');
  });

  it('starts in Select where there is no touch screen', () => {
    expect(startingGroup()).toBe('select');
  });
});
