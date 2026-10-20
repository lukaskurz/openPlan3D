import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, createDefaultProject, viewMode } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import {
  eyeShot, floorShot, frameBox, parseView3dInput, planView3d, roomShot, runView3d, view3dRooms, View3dError,
  VIEW3D_HEIGHT, VIEW3D_WIDTH, type PlanBox,
} from '$lib/assistant/view3d';
import type { ScenePoint, Viewer3dShot } from '$lib/stores/viewer3dCapture';

const floor = () => get(currentProject)!.floors[0];
const project = () => get(currentProject)!;

/** Where a scene point lands in the picture, in normalised device coordinates (−1…1), and its depth. */
function project3(shot: Viewer3dShot, p: ScenePoint) {
  const f = norm(sub(shot.target, shot.eye));
  const r = norm({ x: -f.z, y: 0, z: f.x });
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = sub(p, shot.eye), depth = dot(d, f);
  const tanV = Math.tan(shot.fov * Math.PI / 360), tanH = tanV * shot.width / shot.height;
  return { x: dot(d, r) / (depth * tanH), y: dot(d, u) / (depth * tanV), depth };
}
const sub = (a: ScenePoint, b: ScenePoint) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: ScenePoint, b: ScenePoint) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (v: ScenePoint) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const corners = (box: PlanBox) => [box.minX, box.maxX].flatMap(x => [0, box.height].flatMap(y => [box.minY, box.maxY].map(z => ({ x, y, z }))));

describe('view_3d input', () => {
  it('reads the three kinds of view', () => {
    expect(parseView3dInput({})).toEqual({ kind: 'floor', heightIgnored: false });
    expect(parseView3dInput({ room: ' Living ' })).toEqual({ kind: 'room', room: 'Living', heightIgnored: false });
    expect(parseView3dInput({ from: [0, 0], to: [100, 50] })).toEqual({ kind: 'eye', from: { x: 0, y: 0 }, to: { x: 100, y: 50 }, height: 160 });
    expect(parseView3dInput({ from: [0, 0], to: [100, 0], height: 110 })).toMatchObject({ height: 110 });
    expect(parseView3dInput({ room: 'Living', height: 120 })).toMatchObject({ heightIgnored: true });
  });

  it.each([
    [{ from: [0, 0], to: [0, 0] }, /at least 10 cm away/],
    [{ from: [0, 0], to: [5, 5] }, /at least 10 cm away/],
    [{ from: [0, 0] }, /both from and to/],
    [{ to: [0, 0] }, /both from and to/],
    [{ from: [0], to: [100, 0] }, /from must be a plan point/],
    [{ from: [0, 0], to: ['a', 0] }, /to must be a plan point/],
    [{ from: [0, 0], to: [100, 0], height: -5 }, /height must be/],
    [{ room: 'Living', from: [0, 0], to: [100, 0] }, /not both/],
    [{ room: '  ' }, /room must be/],
  ])('rejects %j', (input, message) => {
    expect(() => parseView3dInput(input as Record<string, unknown>)).toThrow(View3dError);
    expect(() => parseView3dInput(input as Record<string, unknown>)).toThrow(message);
  });
});

describe('view_3d cameras', () => {
  it('frames every corner of a box inside the picture, in front of the camera', () => {
    const box: PlanBox = { minX: 100, minY: 50, maxX: 600, maxY: 450, height: 250 };
    const view = frameBox(box, { azimuth: { x: 1, y: 1 }, pitch: 45, fov: 50, aspect: 1.5 });
    const shot = { ...view, fov: 50, width: 1200, height: 800 };
    expect(view.target).toEqual({ x: 350, y: 125, z: 250 });
    const points = corners(box).map(p => project3(shot, p));
    for (const p of points) {
      expect(p.depth).toBeGreaterThan(0);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
    // Snug: the box fills most of the picture in one direction.
    expect(Math.max(...points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))))).toBeGreaterThan(0.85);
  });

  it('looks at a room from its bottom-right corner, 45° down, with the near side cut away', () => {
    const polygon = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
    const shot = roomShot(polygon, 260);
    expect(shot.width).toBe(VIEW3D_WIDTH);
    expect(shot.height).toBe(VIEW3D_HEIGHT);
    expect(shot.target).toEqual({ x: 250, y: 130, z: 200 });
    const d = sub(shot.eye, shot.target);
    expect(d.x).toBeGreaterThan(0);
    expect(d.z).toBeCloseTo(d.x, 6);
    expect(Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180 / Math.PI).toBeCloseTo(45, 6);
    expect(shot.cutaway).toEqual({ box: { minX: 0, minY: 0, maxX: 500, maxY: 400 }, towards: { x: Math.SQRT1_2, y: Math.SQRT1_2 } });
    // A bigger room is seen from further away.
    const big = roomShot(polygon.map(p => ({ x: p.x * 2, y: p.y * 2 })), 260);
    expect(Math.hypot(...Object.values(sub(big.eye, big.target)))).toBeGreaterThan(Math.hypot(d.x, d.y, d.z));
  });

  it('stands at from with the eye at height, looking level towards to', () => {
    const shot = eyeShot({ x: 100, y: 200 }, { x: 400, y: 200 }, 150);
    expect(shot.eye).toEqual({ x: 100, y: 150, z: 200 });
    expect(shot.target).toEqual({ x: 400, y: 150, z: 200 });
    expect(shot.cutaway).toBeUndefined();
    expect(eyeShot({ x: 0, y: 0 }, { x: 0, y: 100 }).eye.y).toBe(160);
    expect(() => eyeShot({ x: 0, y: 0 }, { x: 0, y: 0 })).toThrow(View3dError);
  });

  it('frames all walls of the floor, and refuses an empty one', () => {
    const walls = [
      { id: 'a', start: { x: 0, y: 0 }, end: { x: 900, y: 0 }, thickness: 20, height: 300 },
      { id: 'b', start: { x: 900, y: 0 }, end: { x: 900, y: 600 }, thickness: 20, height: 250 },
    ];
    const shot = floorShot({ walls, furniture: [] } as never);
    const box: PlanBox = { minX: 0, minY: 0, maxX: 900, maxY: 600, height: 300 };
    for (const p of corners(box).map(c => project3(shot, c))) {
      expect(p.depth).toBeGreaterThan(0);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
    expect(shot.target).toEqual({ x: 450, y: 150, z: 300 });
    expect(shot.cutaway?.box).toEqual({ minX: 0, minY: 0, maxX: 900, maxY: 600 });
    expect(() => floorShot({ walls: [], furniture: [] } as never)).toThrow(/empty/);
  });
});

describe('view_3d on the plan', () => {
  beforeEach(() => {
    loadProject(createDefaultProject('3D views'));
    runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    runPlanTool('add_room', { name: 'Bedroom', x: 500, y: 0, width: 400, depth: 400 });
  });

  it('finds rooms by name or the id get_plan shows', () => {
    const rooms = view3dRooms(project(), floor());
    expect(rooms.map(room => room.name).sort()).toEqual(['Bedroom', 'Living']);
    const bedroom = rooms.find(room => room.name === 'Bedroom')!;
    expect(runPlanTool('get_plan', {}).text).toContain(bedroom.id);
    const byName = planView3d(parseView3dInput({ room: 'bedroom' }), floor(), project(), rooms);
    const byId = planView3d(parseView3dInput({ room: bedroom.id }), floor(), project(), rooms);
    expect(byId.shot).toEqual(byName.shot);
    expect(byName.shot.target.x).toBeCloseTo(700, 6);
    expect(byName.text).toContain('"Bedroom"');
  });

  it('names the rooms there are when the room is unknown', () => {
    const rooms = view3dRooms(project(), floor());
    expect(() => planView3d(parseView3dInput({ room: 'Kitchen' }), floor(), project(), rooms)).toThrow(/No room "Kitchen".*"Living".*|No room "Kitchen".*"Bedroom"/);
  });

  it('says where an eye-level view stands', () => {
    const rooms = view3dRooms(project(), floor());
    const { text } = planView3d(parseView3dInput({ from: [100, 200], to: [800, 200] }), floor(), project(), rooms);
    expect(text).toContain('standing in "Living"');
    expect(text).toContain('facing into "Bedroom"');
  });

  it('returns input errors as tool errors without opening the 3D view', async () => {
    const outcome = await runView3d({ from: [10, 10], to: [10, 10] });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/^error: /);
    expect(get(viewMode)).toBe('2d');
    const unknown = await runView3d({ room: 'Garage' });
    expect(unknown.text).toContain('No room "Garage"');
  });
});
