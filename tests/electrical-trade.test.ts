import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Floor, FurnitureItem, SwitchLink } from '$lib/models/types';
import {
  currentProject, loadProject, addFurniture, moveWallEndpoint, moveWallsDuringDrag, moveWallGeometryDuringDrag, moveWallParallel,
  updateWall, splitWall, reverseWall, removeElement, removeWall, removeFurniture, undo, redo, duplicateSelection,
  moveWallItemDuringDrag, beginUndoGroup, endUndoGroup, toggleSwitchLinkTarget, selectedElementId, selectedElementIds,
  placingFurnitureId, selectedTool, rotateSelection, undoHistoryStore,
} from '$lib/stores/project';
import { hostedPose, rehostWallItems } from '$lib/utils/wallHostedItems';
import { readProject } from '$lib/utils/projectValidation';
import { pastePlanSelection } from '$lib/utils/duplicateSelection';
import { arcPoint, hitTestSwitchLink, isSwitch, isSwitchTarget, linkArc, switchLinksWithout, toggledSwitchLinks } from '$lib/utils/switchLinks';
import { editableFurniture, editablePlanFloor } from '$lib/utils/workFilter';
import { findFurnitureAt } from '$lib/utils/hitTesting';
import { handleGlobalShortcut } from '$lib/utils/shortcuts';
import { activeTrade, activeSurface } from '$lib/stores/workContext';
import {
  chooseGroup, toolGroup, linkPick, linkSwitchId, startLinkTool, placeWallVariant, placementHeight, wallItemHeights, switchTrade,
} from '$lib/components/chrome/tools';
import { groupForItem, homeOfTool } from '$lib/components/chrome/tradeTools';
import { undoMessage } from '$lib/i18n/undoMessages';
import { roomProject } from './fixtures/project';

const floor = (): Floor => get(currentProject)!.floors[0];
const find = (id: string) => floor().furniture.find(item => item.id === id);
const wall = (id: string) => floor().walls.find(item => item.id === id)!;
const item = (id: string, catalogId: string, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

/** The plan pose an item should have on its host wall right now. */
const expectedPose = (id: string) => {
  const fi = find(id)!;
  return hostedPose(wall(fi.wallId!), fi, { wallPosition: fi.wallPosition!, wallSide: fi.wallSide! });
};

beforeEach(() => {
  loadProject(roomProject());
  chooseGroup('select');
  activeTrade.set('furnishing');
  activeSurface.set('floor');
});

describe('wall-hosted items follow their wall', () => {
  // Wall a-0 runs from (0, 0) to (400, 0), 15 cm thick; its left normal points +y (into the room).
  const place = () => addFurniture('sym_outlet', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.25, wallSide: 1 });

  it('takes its pose from the host when placed', () => {
    const id = place();
    expect(find(id)!.position.x).toBeCloseTo(100);
    expect(find(id)!.position.y).toBeCloseTo(7.5 + 7.5);
    expect(find(id)!.rotation).toBeCloseTo(0);
  });

  it('moves with wall drags (endpoint, geometry, solved and parallel moves) and with store edits', () => {
    const id = place();
    beginUndoGroup();
    moveWallEndpoint('a-0', 'start', { x: -400, y: 0 });
    expect(find(id)!.position).toEqual(expectedPose(id).position);
    expect(find(id)!.position.x).toBeCloseTo(-200);
    moveWallGeometryDuringDrag('a-0', { start: { x: -400, y: 100 }, end: { x: 400, y: 100 } });
    expect(find(id)!.position.y).toBeCloseTo(115);
    moveWallsDuringDrag(new Map([['a-0', { start: { x: -400, y: 50 }, end: { x: 400, y: 50 } }]]));
    expect(find(id)!.position.y).toBeCloseTo(65);
    moveWallParallel('a-0', 0, 10);
    expect(find(id)!.position.y).toBeCloseTo(75);
    endUndoGroup('Moved plan geometry');
    updateWall('a-0', { thickness: 35 });
    expect(find(id)!.position.y).toBeCloseTo(60 + 17.5 + 7.5);
    // Undo restores the wall and the item together, in one step per edit.
    undo();
    expect(find(id)!.position.y).toBeCloseTo(75);
    undo();
    expect(find(id)!.position).toEqual({ x: 100, y: 15 });
    redo();
    expect(find(id)!.position.y).toBeCloseTo(75);
  });

  it('a no-op edit leaves history alone (rehosting is idempotent)', () => {
    place();
    const entries = get(undoHistoryStore).entries.length;
    updateWall('a-0', { thickness: 15 });
    expect(get(undoHistoryStore).entries.length).toBe(entries);
    const copy = structuredClone(floor());
    expect(rehostWallItems(copy)).toBe(false);
  });

  it('survives a split: items past the cut move to the new wall, positions rescale', () => {
    const near = place();
    const far = addFurniture('sym_switch', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.75, wallSide: -1 });
    const before = { near: { ...find(near)!.position }, far: { ...find(far)!.position } };
    const newId = splitWall('a-0', 0.5)!;
    expect(find(near)).toMatchObject({ wallId: 'a-0', wallPosition: 0.5 });
    expect(find(far)).toMatchObject({ wallId: newId, wallPosition: 0.5, wallSide: -1 });
    expect(find(near)!.position.x).toBeCloseTo(before.near.x);
    expect(find(far)!.position.x).toBeCloseTo(before.far.x);
    expect(find(far)!.position.y).toBeCloseTo(before.far.y);
    undo();
    expect(find(far)).toMatchObject({ wallId: 'a-0', wallPosition: 0.75 });
  });

  it('keeps its place when the wall is reversed', () => {
    const id = place();
    const before = { ...find(id)!.position }, rotation = find(id)!.rotation;
    reverseWall('a-0');
    expect(find(id)).toMatchObject({ wallPosition: 0.75, wallSide: -1 });
    expect(find(id)!.position.x).toBeCloseTo(before.x);
    expect(find(id)!.position.y).toBeCloseTo(before.y);
    expect(find(id)!.rotation).toBeCloseTo(rotation);
  });

  it('is deleted with its wall, and comes back with Undo', () => {
    const id = place();
    removeElement('a-0');
    expect(find(id)).toBeUndefined();
    undo();
    expect(find(id)).toBeDefined();
    removeWall('a-0');
    expect(find(id)).toBeUndefined();
    undo();
    expect(find(id)).toMatchObject({ wallId: 'a-0' });
  });

  it('slides along walls and can change walls while dragged, as one Undo step', () => {
    const id = place();
    beginUndoGroup();
    moveWallItemDuringDrag(id, 'a-0', 0.5, 1);
    expect(find(id)!.position.x).toBeCloseTo(200);
    moveWallItemDuringDrag(id, 'a-1', 0.5, -1);
    moveWallItemDuringDrag(id, 'missing', 0.5, 1);
    endUndoGroup('Moved furniture');
    expect(find(id)).toMatchObject({ wallId: 'a-1', wallPosition: 0.5, wallSide: -1 });
    // Wall a-1 runs (400, 0) → (400, 300); side −1 is outside, +x.
    expect(find(id)!.position.x).toBeCloseTo(400 + 7.5 + 7.5);
    expect(find(id)!.position.y).toBeCloseTo(150);
    undo();
    expect(find(id)).toMatchObject({ wallId: 'a-0', wallPosition: 0.25 });
  });

  it('is left out of selection rotation', () => {
    const id = place();
    const sofa = addFurniture('sofa', { x: 200, y: 150 });
    rotateSelection(new Set([id, sofa]), 90);
    expect(find(id)!.rotation).toBeCloseTo(0);
    expect(find(sofa)!.rotation).toBe(90);
  });

  it('duplicates by the opening rule', () => {
    const id = place();
    // Alone: further along the same wall.
    const [copy] = duplicateSelection(new Set([id]));
    expect(find(copy)).toMatchObject({ wallId: 'a-0', wallSide: 1 });
    expect(find(copy)!.wallPosition).toBeCloseTo(0.35);
    expect(find(copy)!.position.x).toBeCloseTo(140);
    // With its wall: on the copy of the wall, at the same position.
    const ids = duplicateSelection(new Set(['a-0']));
    const copiedWall = ids.find(other => floor().walls.some(w => w.id === other))!;
    const carried = floor().furniture.filter(fi => fi.wallId === copiedWall);
    expect(carried.map(fi => fi.wallPosition).sort()).toEqual([0.25, 0.35]);
    expect(carried[0].position).toEqual(expectedPose(carried[0].id).position);
    // Pasted where its wall is missing: unhosted.
    const target = structuredClone(floor());
    target.walls = [];
    target.furniture = [];
    pastePlanSelection(floor(), target, new Set([id]), () => 'pasted');
    expect(target.furniture[0].wallId).toBeUndefined();
  });
});

describe('switch links', () => {
  const links = (): SwitchLink[] => floor().switchLinks ?? [];

  it('toggles targets on one link per switch, created and removed on demand, with undo messages', () => {
    const sw = addFurniture('sym_switch', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.1, wallSide: 1 });
    const light = addFurniture('ceiling_light', { x: 200, y: 150 });
    const fan = addFurniture('ceiling_fan', { x: 300, y: 150 });
    toggleSwitchLinkTarget(sw, light);
    toggleSwitchLinkTarget(sw, fan);
    expect(links()).toHaveLength(1);
    expect(links()[0]).toMatchObject({ switchId: sw, targetIds: [light, fan] });
    toggleSwitchLinkTarget(sw, light);
    expect(links()[0].targetIds).toEqual([fan]);
    toggleSwitchLinkTarget(sw, fan);
    expect(floor().switchLinks).toBeUndefined();
    const descriptions = get(undoHistoryStore).entries.map(entry => entry.description).slice(-4);
    expect(descriptions).toEqual(['Linked to switch', 'Linked to switch', 'Unlinked from switch', 'Unlinked from switch']);
    expect(undoMessage('Linked to switch', 'pt')).toBe('Ligado ao interruptor');
    undo();
    expect(links()[0].targetIds).toEqual([fan]);
    // Unknown items and self links are ignored.
    toggleSwitchLinkTarget(sw, 'missing');
    toggleSwitchLinkTarget(sw, sw);
    expect(links()[0].targetIds).toEqual([fan]);
  });

  it('are cleaned when the switch, a target, its wall or the link itself is deleted', () => {
    const sw = addFurniture('sym_switch', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.1, wallSide: 1 });
    const a = addFurniture('ceiling_light', { x: 200, y: 150 });
    const b = addFurniture('pendant_light', { x: 100, y: 150 });
    toggleSwitchLinkTarget(sw, a);
    toggleSwitchLinkTarget(sw, b);
    removeElement(a);
    expect(links()[0].targetIds).toEqual([b]);
    removeFurniture(b);
    expect(floor().switchLinks).toBeUndefined();
    undo(); undo();
    expect(links()[0].targetIds).toEqual([a, b]);
    removeElement('a-0'); // the switch hangs on it
    expect(floor().switchLinks).toBeUndefined();
    undo();
    removeElement(links()[0].id);
    expect(floor().switchLinks).toBeUndefined();
  });

  it('validation drops links to missing furniture and keeps one link per switch', () => {
    const project = roomProject();
    project.floors[0].furniture = [item('s', 'sym_switch'), item('l', 'ceiling_light'), item('m', 'ceiling_fan')];
    project.floors[0].switchLinks = [
      { id: 'k1', switchId: 's', targetIds: ['l', 'gone', 'l', 's'] },
      { id: 'k2', switchId: 's', targetIds: ['m'] },
      { id: 'k3', switchId: 'gone', targetIds: ['l'] },
      { id: 'k4', switchId: 'm', targetIds: ['gone'] },
    ];
    const read = readProject(JSON.parse(JSON.stringify(project)));
    expect(read.floors[0].switchLinks).toEqual([{ id: 'k1', switchId: 's', targetIds: ['l'] }]);
    const plain = roomProject();
    expect(readProject(JSON.parse(JSON.stringify(plain))).floors[0].switchLinks).toBeUndefined();
    const bad = roomProject();
    (bad.floors[0] as any).switchLinks = 'nope';
    expect(() => readProject(JSON.parse(JSON.stringify(bad)))).toThrow();
  });

  it('duplicating a switch with its targets copies the link', () => {
    const sw = addFurniture('sym_switch', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.1, wallSide: 1 });
    const light = addFurniture('ceiling_light', { x: 200, y: 150 });
    toggleSwitchLinkTarget(sw, light);
    const ids = duplicateSelection(new Set([sw, light]));
    expect(links()).toHaveLength(2);
    expect(ids).not.toContain(links()[1].id);
    expect(ids).toEqual(expect.arrayContaining([links()[1].switchId, ...links()[1].targetIds]));
  });

  it('pure helpers: toggle, cleanup, kinds', () => {
    let n = 0;
    const id = () => `l${++n}`;
    let next = toggledSwitchLinks([], 's', 'a', id);
    expect(next).toEqual([{ id: 'l1', switchId: 's', targetIds: ['a'] }]);
    next = toggledSwitchLinks(next, 's', 'b', id);
    expect(next[0].targetIds).toEqual(['a', 'b']);
    expect(toggledSwitchLinks(toggledSwitchLinks(next, 's', 'a', id), 's', 'b', id)).toEqual([]);
    const same = [{ id: 'x', switchId: 's', targetIds: ['a'] }];
    expect(switchLinksWithout(same, new Set(['other']))).toBe(same);
    expect(switchLinksWithout(same, new Set(['a']))).toEqual([]);
    expect(isSwitch({ catalogId: 'sym_switch' })).toBe(true);
    expect(isSwitchTarget({ catalogId: 'pendant_light' })).toBe(true);
    expect(isSwitchTarget({ catalogId: 'sym_outlet_double' })).toBe(true);
    expect(isSwitchTarget({ catalogId: 'sym_switch' })).toBe(false);
    expect(isSwitchTarget({ catalogId: 'sofa' })).toBe(false);
  });

  it('hit-tests the drawn arc, not the straight chord', () => {
    const furniture = [{ id: 's', position: { x: 0, y: 0 } }, { id: 't', position: { x: 400, y: 0 } }];
    const linksList = [{ id: 'k', switchId: 's', targetIds: ['t'] }];
    const arc = linkArc({ x: 0, y: 0 }, { x: 400, y: 0 });
    const mid = arcPoint(arc, 0.5);
    expect(Math.abs(mid.y)).toBeGreaterThan(30);
    expect(hitTestSwitchLink(mid, linksList, furniture, 5)).toBe('k');
    expect(hitTestSwitchLink({ x: 200, y: 0 }, linksList, furniture, 5)).toBeNull();
    expect(hitTestSwitchLink(mid, [{ id: 'k', switchId: 's', targetIds: ['missing'] }], furniture, 5)).toBeNull();
  });
});

describe('Electrical tools', () => {
  it('arm their wall items, remember variants and highlight their button', () => {
    chooseGroup('outlet');
    expect(get(placingFurnitureId)).toBe('sym_outlet');
    expect(get(toolGroup)).toBe('outlet');
    expect([get(activeTrade), get(activeSurface)]).toEqual(['electrical', 'floor']);
    placeWallVariant('outlet', 'sym_outlet_double');
    expect(get(toolGroup)).toBe('outlet');
    chooseGroup('switch');
    expect([get(placingFurnitureId), get(toolGroup)]).toEqual(['sym_switch', 'switch']);
    chooseGroup('wallLight');
    expect([get(placingFurnitureId), get(toolGroup)]).toEqual(['wall_sconce', 'wallLight']);
    chooseGroup('outlet');
    expect(get(placingFurnitureId)).toBe('sym_outlet_double');
    placeWallVariant('outlet', 'sym_outlet');
    expect(groupForItem('wall_sconce_outdoor')).toBe('wallLight');
    expect(homeOfTool('link')).toEqual({ trade: 'electrical', surface: 'floor' });
  });

  it('the ceiling Light and Fan keep Electrical', () => {
    switchTrade('electrical');
    chooseGroup('light');
    expect([get(activeTrade), get(activeSurface), get(toolGroup)]).toEqual(['electrical', 'ceiling', 'light']);
    chooseGroup('fan');
    expect([get(activeTrade), get(activeSurface), get(toolGroup)]).toEqual(['electrical', 'ceiling', 'fan']);
  });

  it('the Outlet height option sets the mounting height of the next outlets', () => {
    expect(placementHeight('sym_outlet')).toBeUndefined();
    wallItemHeights.set({ outlet: 110 });
    expect(placementHeight('sym_outlet_double')).toBe(110);
    expect(placementHeight('sym_switch')).toBeUndefined();
    expect(placementHeight('sofa')).toBeUndefined();
    wallItemHeights.set({});
  });

  it('the Link tool starts in Electrical with nothing selected, optionally with a switch picked, and Done ends it', () => {
    selectedElementId.set('something');
    startLinkTool('sw-1');
    expect(get(activeTrade)).toBe('electrical');
    expect(get(toolGroup)).toBe('link');
    expect(get(linkSwitchId)).toBe('sw-1');
    expect(get(selectedElementId)).toBeNull();
    // Electrical on the ceiling offers Link too, so the surface stays.
    activeSurface.set('ceiling');
    chooseGroup('link');
    expect([get(activeSurface), get(toolGroup), get(linkSwitchId)]).toEqual(['ceiling', 'link', null]);
    chooseGroup('select');
    expect(get(linkPick)).toBe(false);
    selectedTool.set('wall');
    expect(get(toolGroup)).toBe('wall');
  });
});

describe('Electrical editing cannot move furniture (spec §6, package 3)', () => {
  it('furniture is not hit, box-selected or kept selected in Electrical, and Delete leaves it alone', () => {
    const sofa = addFurniture('sofa', { x: 200, y: 150 });
    const outlet = addFurniture('sym_outlet', { x: 0, y: 0 }, { wallId: 'a-0', wallPosition: 0.5, wallSide: 1 });
    const work = { trade: 'electrical' as const, surface: 'floor' as const };
    const editable = floor().furniture.filter(fi => editableFurniture(fi, work));
    expect(findFurnitureAt({ x: 200, y: 150 }, editable)).toBeNull();
    expect(findFurnitureAt(find(outlet)!.position, editable)?.id).toBe(outlet);
    expect(editablePlanFloor(floor(), work).furniture.map(fi => fi.id)).toEqual([outlet]);
    expect(editablePlanFloor(floor(), work).walls).toEqual([]);

    // A stale selection (e.g. restored by Undo) is dropped once Electrical is showing.
    selectedElementId.set(sofa);
    activeTrade.set('electrical');
    expect(get(selectedElementId)).toBeNull();
    selectedElementId.set(sofa);
    expect(get(selectedElementId)).toBeNull();
    selectedElementIds.set(new Set([sofa, outlet, 'a-0']));
    expect(get(selectedElementIds).size).toBe(0);
    expect(get(selectedElementId)).toBe(outlet);
    selectedElementId.set(null);
    selectedElementId.set(sofa);
    handleGlobalShortcut({ key: 'Delete', target: null, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, preventDefault() {} } as unknown as KeyboardEvent);
    expect(find(sofa)).toBeDefined();
    // The outlet can be selected and moved along its wall.
    selectedElementId.set(outlet);
    expect(get(selectedElementId)).toBe(outlet);
    activeTrade.set('furnishing');
    expect(get(selectedElementId)).toBeNull();
  });
});
