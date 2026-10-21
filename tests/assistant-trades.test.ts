import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, createDefaultProject, undoHistoryStore } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';

const floor = () => get(currentProject)!.floors[0];
const item = (id: string) => floor().furniture.find(f => f.id === id)!;
const plan = () => runPlanTool('get_plan', {}).text;
const wallAt = (a: [number, number], b: [number, number]) => floor().walls.find(w =>
  (w.start.x === a[0] && w.start.y === a[1] && w.end.x === b[0] && w.end.y === b[1]) || (w.start.x === b[0] && w.start.y === b[1] && w.end.x === a[0] && w.end.y === a[1]))!;
const place = (items: Record<string, unknown>[]) => runPlanTool('place_furniture', { items });

/** One 500 × 400 room drawn as walls only, so it is detected but not saved. */
function livingRoom() {
  loadProject(createDefaultProject('Trades'));
  runPlanTool('add_walls', { points: [[0, 0], [500, 0], [500, 400], [0, 400]], closed: true });
}
const roomId = () => /- (room-\S+) /.exec(plan())![1];

describe('wall and ceiling items', () => {
  beforeEach(livingRoom);

  it('snaps wall items to the nearest wall face at their mounting height', () => {
    const top = wallAt([0, 0], [500, 0]);
    const result = place([{ catalogId: 'sym_outlet', x: 250, y: 20, rotation: 45 }]);
    expect(result.isError).toBeFalsy();
    const outlet = item(result.changed![0]);
    expect(outlet).toMatchObject({ wallId: top.id, wallSide: 1, elevation: 30, rotation: 0 });
    expect(outlet.wallPosition).toBeCloseTo(0.5);
    // Its back against the wall face: half the wall plus half its own depth into the room.
    expect(outlet.position).toEqual({ x: 250, y: 15 });
    expect(result.text).toContain(`on wall ${top.id} facing +y at 30 cm, 250 cm from its start`);
    expect(result.text).not.toMatch(/warning/);
  });

  it('places and slides wall items by offset along their wall, and rejects fields furniture lacks', () => {
    const top = wallAt([0, 0], [500, 0]);
    const fromStart = (id: string) => item(id).wallPosition! * 500;
    const [outlet] = place([{ catalogId: 'sym_outlet', x: 250, y: 20, wallId: top.id, offset: 120 }]).changed!;
    expect(fromStart(outlet)).toBeCloseTo(top.start.x === 0 ? 120 : 380);
    expect(runPlanTool('update_elements', { updates: [{ id: outlet, offset: 300 }] }).isError).toBeFalsy();
    expect(fromStart(outlet)).toBeCloseTo(top.start.x === 0 ? 300 : 200);
    expect(item(outlet).wallId).toBe(top.id);
    expect(runPlanTool('update_elements', { updates: [{ id: outlet, offset: 900 }] }).text).toMatch(/offset on .* must be/);
    const [sofa] = place([{ catalogId: 'sofa', x: 250, y: 300 }]).changed!;
    expect(runPlanTool('update_elements', { updates: [{ id: sofa, offset: 100 }] }).text).toMatch(/takes x, y instead of offset/);
    expect(runPlanTool('update_elements', { updates: [{ id: sofa, colour: 'red' }] }).text).toMatch(/not colour/);
  });

  it('hangs a point on the wall itself on the room side, and warns about the outer face', () => {
    const [inside, outside] = place([
      { catalogId: 'sym_switch', x: 100, y: 0 },
      { catalogId: 'sym_switch', x: 100, y: -30 },
    ]).changed!;
    expect(item(inside).position.y).toBeGreaterThan(0);
    expect(item(outside).position.y).toBeLessThan(0);
    const text = place([{ catalogId: 'sym_outlet', x: 300, y: -30 }]).text;
    expect(text).toMatch(/faces outside every room/);
  });

  it('takes a wall id and a mounting height, and checks them', () => {
    const right = wallAt([500, 0], [500, 400]);
    const result = place([{ catalogId: 'sym_switch', x: 300, y: 120, wallId: right.id, elevation: 120 }]);
    const sw = item(result.changed![0]);
    expect(sw).toMatchObject({ wallId: right.id, elevation: 120 });
    expect(sw.position.x).toBeLessThan(500);
    expect(sw.position.y).toBeCloseTo(120);
    expect(place([{ catalogId: 'sym_outlet', x: 250, y: 200 }]).text).toMatch(/No wall within 100 cm/);
    expect(place([{ catalogId: 'sym_outlet', x: 250, y: 20, elevation: 400 }]).text).toMatch(/must be 0 to 280 cm here/);
    expect(place([{ catalogId: 'sym_outlet', x: 250, y: 20, drop: 10 }]).text).toMatch(/takes elevation, not drop/);
    expect(place([{ catalogId: 'sofa', x: 250, y: 200, wallId: right.id }]).text).toMatch(/isn't a wall item/);
  });

  it('warns when a wall item sits in a window opening', () => {
    const top = wallAt([0, 0], [500, 0]);
    runPlanTool('add_openings', { items: [{ kind: 'window', wallId: top.id, offset: 250 }] });
    const result = place([
      { catalogId: 'wall_sconce', x: 250, y: 20 },
      { catalogId: 'sym_outlet', x: 250, y: 20 },
    ]);
    const [sconce, outlet] = result.changed!;
    expect(result.text).toContain(`${sconce} (Wall Sconce): sits in the opening of window`);
    expect(result.text).not.toContain(`${outlet} (Power Outlet): sits`);
  });

  it('hangs a pendant by its drop, without overlap warnings over a table', () => {
    const [table] = place([{ catalogId: 'dining_table', x: 250, y: 200 }]).changed!;
    const over = place([{ catalogId: 'pendant_light', x: 250, y: 200 }]);
    expect(over.text).not.toMatch(/warning/);
    expect(over.text).toContain('ceiling, drop 60 cm, bottom at 190 cm');
    // Away from the table the same drop leaves too little headroom.
    const loose = place([{ catalogId: 'pendant_light', x: 100, y: 300 }]);
    expect(loose.text).toMatch(/hangs down to 190 cm, under 200 cm headroom/);
    const short = place([{ catalogId: 'pendant_light', x: 400, y: 300, drop: 20 }]);
    expect(short.text).not.toMatch(/warning/);
    expect(item(short.changed![0]).drop).toBe(20);
    expect(place([{ catalogId: 'pendant_light', x: 100, y: 100, drop: 400 }]).text).toMatch(/drop must be 0 to 250 cm/);
    expect(place([{ catalogId: 'pendant_light', x: 100, y: 100, elevation: 200 }]).text).toMatch(/give drop/);
    expect(table).toBeTruthy();
  });

  it('raises floor items and moves wall items to another wall', () => {
    const [tv] = place([{ catalogId: 'television', x: 250, y: 300, elevation: 60 }]).changed!;
    expect(item(tv).elevation).toBe(60);
    const [outlet] = place([{ catalogId: 'sym_outlet', x: 250, y: 20 }]).changed!;
    const left = wallAt([0, 400], [0, 0]);
    const moved = runPlanTool('update_elements', { updates: [{ id: outlet, wallId: left.id, x: 20, y: 100, elevation: 45 }] });
    expect(moved.isError).toBeFalsy();
    expect(item(outlet)).toMatchObject({ wallId: left.id, elevation: 45 });
    expect(item(outlet).position.x).toBeGreaterThan(0);
    expect(item(outlet).position.y).toBeCloseTo(100);
    // x, y alone pick the nearest wall.
    runPlanTool('update_elements', { updates: [{ id: outlet, x: 480, y: 300 }] });
    expect(item(outlet).wallId).toBe(wallAt([500, 0], [500, 400]).id);
    expect(runPlanTool('update_elements', { updates: [{ id: outlet, elevation: 500 }] }).isError).toBe(true);
    const [pendant] = place([{ catalogId: 'pendant_light', x: 250, y: 200 }]).changed!;
    runPlanTool('update_elements', { updates: [{ id: pendant, drop: 30 }] });
    expect(item(pendant).drop).toBe(30);
    expect(runPlanTool('update_elements', { updates: [{ id: tv, drop: 30 }] }).text).toMatch(/not drop/);
  });
});

describe('rooms and walls', () => {
  beforeEach(livingRoom);

  it('overrides and resets the ceiling height of a detected room', () => {
    const id = roomId();
    expect(floor().rooms).toHaveLength(0);
    expect(plan()).toContain('Default ceiling height 280 cm.');
    expect(plan()).toMatch(/ceiling 280 cm, floor light-oak/);
    const [pendant] = place([{ catalogId: 'pendant_light', x: 250, y: 200, drop: 20 }]).changed!;
    const lowered = runPlanTool('update_elements', { updates: [{ id, ceilingHeight: 240 }] });
    expect(lowered.isError).toBeFalsy();
    expect(floor().roomCeilingHeights).toEqual({ [id]: 240 });
    // The room keeps the id the model was given.
    expect(roomId()).toBe(id);
    expect(plan()).toContain('ceiling 240 cm (override)');
    expect(plan()).toContain(`${pendant} pendant_light "Pendant Light" centre (250,200) rot 0° 30×30 cm in Room 1, electrical, ceiling, drop 20 cm, bottom at 190 cm`);
    expect(lowered.text).toMatch(/hangs down to 190 cm/);
    runPlanTool('update_elements', { updates: [{ id, ceilingHeight: null }] });
    expect(floor().roomCeilingHeights).toBeUndefined();
    expect(plan()).toMatch(/ceiling 280 cm, floor/);
    expect(runPlanTool('update_elements', { updates: [{ id, ceilingHeight: 20 }] }).isError).toBe(true);
  });

  it('sets floor materials and wall colours', () => {
    const id = roomId();
    expect(runPlanTool('update_elements', { updates: [{ id, floorMaterial: 'walnut' }] }).isError).toBeFalsy();
    expect(plan()).toContain('floor walnut');
    expect(runPlanTool('update_elements', { updates: [{ id, floorMaterial: 'lava' }] }).text).toMatch(/Unknown floorMaterial lava/);
    const top = wallAt([0, 0], [500, 0]);
    expect(plan()).not.toMatch(/colour/);
    runPlanTool('update_elements', { updates: [{ id: top.id, color: 'sage-green' }] });
    expect(floor().walls.find(w => w.id === top.id)).toMatchObject({ interiorColor: '#d4e2d4', exteriorColor: '#d4e2d4' });
    expect(plan()).toContain('colour sage-green');
    runPlanTool('update_elements', { updates: [{ id: top.id, color: 'red-brick' }] });
    expect(floor().walls.find(w => w.id === top.id)).toMatchObject({ interiorTexture: 'red-brick', exteriorTexture: 'red-brick' });
    expect(plan()).toContain('colour red-brick');
    runPlanTool('update_elements', { updates: [{ id: top.id, color: '#123ABC' }] });
    expect(plan()).toContain('colour #123abc');
    expect(runPlanTool('update_elements', { updates: [{ id: top.id, color: 'blorp' }] }).text).toMatch(/Unknown wall colour blorp/);
  });
});

describe('pipes', () => {
  beforeEach(livingRoom);

  it('adds runs and risers and rejects bad pipes', () => {
    const result = runPlanTool('add_pipes', { items: [
      { kind: 'cold', points: [[20, 20], [200, 20]], run: 'wall', elevation: 40 },
      { kind: 'waste', points: [[480, 380]], riser: true },
      { kind: 'gas', points: [[0, 0], [10, 0]] },
      { kind: 'hot', points: [[0, 0]] },
      { kind: 'hot', points: [[0, 0], [10, 10]], riser: true },
      { kind: 'hot', points: [[0, 0], [10, 10]], diameter: 0 },
    ] });
    expect(result.changed).toHaveLength(2);
    expect(result.text).toMatch(/kind must be cold, hot or waste/);
    expect(result.text).toMatch(/needs at least two different points/);
    expect(result.text).toMatch(/riser stands at a single point/);
    expect(result.text).toMatch(/diameter \(mm\) must be/);
    const [cold, riser] = result.changed!;
    expect(floor().pipes).toEqual([
      { id: cold, kind: 'cold', diameter: 20, points: [{ x: 20, y: 20 }, { x: 200, y: 20 }], run: 'wall', elevation: 40 },
      { id: riser, kind: 'waste', diameter: 50, points: [{ x: 480, y: 380 }], run: 'floor', riser: true },
    ]);
    const text = plan();
    expect(text).toContain(`Pipes (Ø in mm):\n- ${cold} cold Ø20 wall (20,20) (200,20), elevation 40 cm\n- ${riser} waste Ø50 floor (480,380) riser`);
    expect(runPlanTool('add_pipes', { items: [{ kind: 'gas', points: [[0, 0]] }] }).isError).toBe(true);
  });

  it('updates and deletes pipes', () => {
    const [id] = runPlanTool('add_pipes', { items: [{ kind: 'cold', points: [[20, 20], [200, 20]] }] }).changed!;
    const updated = runPlanTool('update_elements', { updates: [{ id, points: [[20, 20], [200, 20], [200, 300]], kind: 'waste', run: 'ceiling' }] });
    expect(updated.isError).toBeFalsy();
    expect(floor().pipes![0]).toMatchObject({ kind: 'waste', diameter: 50, run: 'ceiling', points: [{ x: 20, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 300 }] });
    expect(runPlanTool('update_elements', { updates: [{ id, points: [[5, 5]] }] }).text).toMatch(/at least two different points/);
    expect(runPlanTool('update_elements', { updates: [{ id, run: 'roof' }] }).isError).toBe(true);
    expect(runPlanTool('update_elements', { updates: [{ id }] }).text).toMatch(/Pipes take points/);
    expect(runPlanTool('update_elements', { updates: [{ id, diameter: 110 }] }).isError).toBeFalsy();
    expect(floor().pipes![0].diameter).toBe(110);
    const removed = runPlanTool('delete_elements', { ids: [id] });
    expect(removed.removed).toEqual([id]);
    expect(floor().pipes).toEqual([]);
  });
});

describe('switch links', () => {
  beforeEach(livingRoom);

  it('sets, adds to and removes from what a switch controls', () => {
    const [sw, light, pendant, sofa] = place([
      { catalogId: 'sym_switch', x: 50, y: 20 },
      { catalogId: 'ceiling_light', x: 250, y: 200 },
      { catalogId: 'sym_pendant', x: 400, y: 300 },
      { catalogId: 'sofa', x: 250, y: 330 },
    ]).changed!;
    const entries = get(undoHistoryStore).entries.length;
    const set = runPlanTool('link_switch', { switchId: sw, targetIds: [light] });
    expect(set).toMatchObject({ text: `${sw} controls ${light}.`, changed: [sw] });
    expect(get(undoHistoryStore).entries).toHaveLength(entries + 1);
    runPlanTool('link_switch', { switchId: sw, targetIds: [pendant, light], mode: 'add' });
    expect(floor().switchLinks).toEqual([expect.objectContaining({ switchId: sw, targetIds: [light, pendant] })]);
    const linkId = floor().switchLinks![0].id;
    expect(plan()).toContain(`Switch links:\n- switch ${sw} controls ${light}, ${pendant}`);
    runPlanTool('link_switch', { switchId: sw, targetIds: [light], mode: 'remove' });
    expect(floor().switchLinks).toEqual([{ id: linkId, switchId: sw, targetIds: [pendant] }]);
    expect(runPlanTool('link_switch', { switchId: sw, targetIds: [] }).text).toBe(`${sw} controls nothing now.`);
    expect(floor().switchLinks).toBeUndefined();
    expect(plan()).not.toContain('Switch links');

    expect(runPlanTool('link_switch', { switchId: light, targetIds: [pendant] }).text).toMatch(/isn't a switch/);
    expect(runPlanTool('link_switch', { switchId: sw, targetIds: [sofa] }).text).toMatch(/can't be switched/);
    expect(runPlanTool('link_switch', { switchId: sw, targetIds: ['nope'] }).text).toMatch(/There is no item nope/);
    expect(runPlanTool('link_switch', { switchId: sw, targetIds: [light], mode: 'toggle' }).isError).toBe(true);
    expect(floor().switchLinks).toBeUndefined();
  });

  it('lists links, trades and mounts in get_plan', () => {
    const [sw, light] = place([
      { catalogId: 'sym_switch', x: 50, y: 20 },
      { catalogId: 'ceiling_light', x: 250, y: 200 },
    ]).changed!;
    runPlanTool('link_switch', { switchId: sw, targetIds: [light] });
    const text = plan();
    expect(text).toMatch(new RegExp(`- ${sw} sym_switch "Light Switch" centre \\(50,15\\) rot 0° 15×15 cm in Room 1, electrical, on wall \\S+ facing \\+y at 105 cm, 50 cm from its start`));
    expect(text).toContain(`${light} ceiling_light "Ceiling Light" centre (250,200) rot 0° 40×40 cm in Room 1, electrical, ceiling, drop 0 cm, bottom at 265 cm`);
    expect(text).toContain(`- switch ${sw} controls ${light}`);
  });
});
