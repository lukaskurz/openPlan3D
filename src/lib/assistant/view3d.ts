/**
 * view_3d: the Assistant looks at the active floor in 3D. The camera is worked
 * out here (pure functions, plan cm); the mounted ThreeViewer renders the shot.
 * When the 3D view is closed it is opened for the picture and closed again.
 *
 * Scene coordinates are floor-local cm: x = plan x, y up from the floor,
 * z = plan y (the viewer adds the floor's elevation).
 */
import { get } from 'svelte/store';
import type { Floor, Point, Project } from '$lib/models/types';
import { getWallEndHeight, getWallStartHeight } from '$lib/models/types';
import {
  activeFloor, currentProject, detectedRoomsStore, selectedElementId, selectedElementIds, selectedRoomId, viewMode,
} from '$lib/stores/project';
import { effectiveRoomCeiling, floorDefaultCeiling } from '$lib/utils/ceilingHeights';
import { waitForViewer3dCapture, type ScenePoint, type Viewer3dShot } from '$lib/stores/viewer3dCapture';
import { planRooms, type ToolOutcome } from './planTools';

/** Size of the picture the model gets back (3:2, long edge as view_plan's). */
export const VIEW3D_WIDTH = 1200;
export const VIEW3D_HEIGHT = 800;
export const DEFAULT_EYE_HEIGHT = 160;
/** How long the 3D view may take to open and load, ms. */
const OPEN_TIMEOUT_MS = 15_000;

const OVERVIEW_FOV = 50;
const EYE_FOV = 60;
/** Room overviews look down at 45°, the whole floor a little steeper. */
const ROOM_PITCH = 45;
const FLOOR_PITCH = 55;
/** Overviews are taken from the plan's bottom right (larger x and y), looking up-left. */
const OVERVIEW_AZIMUTH = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
/** Room left free around the framed box, as a fraction of the view. */
const FRAME_MARGIN = 1.08;

export class View3dError extends Error {}
const fail = (message: string): never => { throw new View3dError(message); };

// ── Input ─────────────────────────────────────────────────────────────

export type View3dRequest =
  | { kind: 'floor'; heightIgnored: boolean }
  | { kind: 'room'; room: string; heightIgnored: boolean }
  | { kind: 'eye'; from: Point; to: Point; height: number };

function pointOf(value: unknown, name: string): Point {
  const raw = Array.isArray(value) ? value
    : value && typeof value === 'object' ? [(value as Point).x, (value as Point).y] : null;
  if (!raw || raw.length !== 2) fail(`${name} must be a plan point [x, y] in cm.`);
  const [x, y] = raw!.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) fail(`${name} must be a plan point [x, y] in cm.`);
  return { x, y };
}

export function parseView3dInput(input: Record<string, unknown>): View3dRequest {
  const has = (key: string) => input[key] !== undefined && input[key] !== null;
  let height: number | undefined;
  if (has('height')) {
    height = Number(input.height);
    if (!Number.isFinite(height) || height < 10 || height > 2000) fail('height must be an eye height between 10 and 2000 cm.');
  }
  if (has('room') && (has('from') || has('to'))) fail('Give either room, or from and to, not both.');
  if (has('room')) {
    const room = typeof input.room === 'string' ? input.room.trim() : '';
    if (!room) fail('room must be a room id or name.');
    return { kind: 'room', room, heightIgnored: height !== undefined };
  }
  if (has('from') || has('to')) {
    if (!has('from') || !has('to')) fail('Give both from and to for an eye-level view.');
    const from = pointOf(input.from, 'from'), to = pointOf(input.to, 'to');
    if (Math.hypot(to.x - from.x, to.y - from.y) < 10) fail('to must be at least 10 cm away from from: it is the point the view looks towards.');
    return { kind: 'eye', from, to, height: height ?? DEFAULT_EYE_HEIGHT };
  }
  return { kind: 'floor', heightIgnored: height !== undefined };
}

// ── Camera math ───────────────────────────────────────────────────────

/** An axis-aligned box in plan cm, from the floor (0) up to `height`. */
export interface PlanBox { minX: number; minY: number; maxX: number; maxY: number; height: number }

const dot = (a: ScenePoint, b: ScenePoint) => a.x * b.x + a.y * b.y + a.z * b.z;
function normalize(v: ScenePoint): ScenePoint {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/**
 * Camera position and target that fit the whole box in view, looking at its centre
 * from the plan direction `azimuth` (pointing from the box towards the camera) and
 * `pitch` degrees down. Every corner of the box lands inside the frustum.
 */
export function frameBox(box: PlanBox, options: { azimuth: Point; pitch: number; fov: number; aspect: number }): { eye: ScenePoint; target: ScenePoint } {
  const target = { x: (box.minX + box.maxX) / 2, y: box.height / 2, z: (box.minY + box.maxY) / 2 };
  const pitch = options.pitch * Math.PI / 180;
  const flat = Math.hypot(options.azimuth.x, options.azimuth.y) || 1;
  const ax = options.azimuth.x / flat, az = options.azimuth.y / flat;
  // From the camera towards the target.
  const forward = normalize({ x: -ax * Math.cos(pitch), y: -Math.sin(pitch), z: -az * Math.cos(pitch) });
  const right = normalize({ x: -forward.z, y: 0, z: forward.x });
  const up = { x: right.y * forward.z - right.z * forward.y, y: right.z * forward.x - right.x * forward.z, z: right.x * forward.y - right.y * forward.x };
  const tanV = Math.tan(options.fov * Math.PI / 360) / FRAME_MARGIN;
  const tanH = tanV * options.aspect;
  let distance = 0;
  for (const x of [box.minX, box.maxX]) for (const y of [0, box.height]) for (const z of [box.minY, box.maxY]) {
    const p = { x: x - target.x, y: y - target.y, z: z - target.z };
    const depth = dot(p, forward);
    distance = Math.max(distance, Math.abs(dot(p, right)) / tanH - depth, Math.abs(dot(p, up)) / tanV - depth, 50 - depth);
  }
  return { eye: { x: target.x - forward.x * distance, y: target.y - forward.y * distance, z: target.z - forward.z * distance }, target };
}

const shotOf = (view: { eye: ScenePoint; target: ScenePoint }, fov: number, extra: Partial<Viewer3dShot> = {}): Viewer3dShot =>
  ({ ...view, fov, width: VIEW3D_WIDTH, height: VIEW3D_HEIGHT, ...extra });

export function polygonBox(polygon: Point[], height: number): PlanBox {
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), height };
}

/** A room from above at an angle; walls on the camera's side are cut away. */
export function roomShot(polygon: Point[], ceiling: number): Viewer3dShot {
  if (polygon.length < 3) fail('That room has no outline to look at.');
  const box = polygonBox(polygon, ceiling);
  const view = frameBox(box, { azimuth: OVERVIEW_AZIMUTH, pitch: ROOM_PITCH, fov: OVERVIEW_FOV, aspect: VIEW3D_WIDTH / VIEW3D_HEIGHT });
  return shotOf(view, OVERVIEW_FOV, { cutaway: { box: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY }, towards: OVERVIEW_AZIMUTH } });
}

/** The box around a floor's walls (with their heights) and items, or null for an empty floor. */
export function floorBox(floor: Pick<Floor, 'walls' | 'furniture'>, fallbackHeight = 280): PlanBox | null {
  const points: Point[] = [];
  let height = 0;
  for (const wall of floor.walls) {
    points.push(wall.start, wall.end, ...(wall.curvePoint ? [wall.curvePoint] : []));
    height = Math.max(height, getWallStartHeight(wall), getWallEndHeight(wall));
  }
  for (const item of floor.furniture) points.push(item.position);
  if (!points.length) return null;
  return polygonBox(points, height || fallbackHeight);
}

/** The whole floor from above at an angle; the outer walls on the camera's side are cut away. */
export function floorShot(floor: Pick<Floor, 'walls' | 'furniture'>, fallbackHeight = 280): Viewer3dShot {
  const box = floorBox(floor, fallbackHeight) ?? fail('The floor is empty: there is nothing to see in 3D yet.');
  // A lone item still gets a sensible view.
  const pad = (lo: number, hi: number) => hi - lo < 200 ? [(lo + hi) / 2 - 100, (lo + hi) / 2 + 100] : [lo, hi];
  [box.minX, box.maxX] = pad(box.minX, box.maxX);
  [box.minY, box.maxY] = pad(box.minY, box.maxY);
  const cutaway = { box: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY }, towards: OVERVIEW_AZIMUTH };
  return shotOf(frameBox(box, { azimuth: OVERVIEW_AZIMUTH, pitch: FLOOR_PITCH, fov: OVERVIEW_FOV, aspect: VIEW3D_WIDTH / VIEW3D_HEIGHT }), OVERVIEW_FOV, { cutaway });
}

/** Standing at `from`, eyes `height` cm above the floor, looking level towards `to`. */
export function eyeShot(from: Point, to: Point, height = DEFAULT_EYE_HEIGHT): Viewer3dShot {
  if (Math.hypot(to.x - from.x, to.y - from.y) < 10) fail('to must be at least 10 cm away from from.');
  return shotOf({ eye: { x: from.x, y: height, z: from.y }, target: { x: to.x, y: height, z: to.y } }, EYE_FOV);
}

// ── Rooms ─────────────────────────────────────────────────────────────

/** `id` as the plan tools give it; `roomId` the room's own (detected rooms' change between detections). */
export interface View3dRoom { id: string; roomId: string; name: string; polygon: Point[]; ceiling: number }

export function view3dRooms(project: Pick<Project, 'floors'>, floor: Floor, detected = get(detectedRoomsStore)): View3dRoom[] {
  return planRooms(floor, detected).map(({ id, room, polygon }) => ({
    id,
    roomId: room.id,
    name: room.name,
    polygon,
    ceiling: effectiveRoomCeiling(project, floor, room),
  }));
}

/** A room by id, else by name (ignoring case); an unknown one lists the rooms there are. */
export function findView3dRoom(rooms: View3dRoom[], query: string): View3dRoom {
  const byId = rooms.find(room => room.id === query || room.roomId === query);
  if (byId) return byId;
  const wanted = query.trim().toLocaleLowerCase();
  const byName = rooms.find(room => room.name.trim().toLocaleLowerCase() === wanted);
  if (byName) return byName;
  if (!rooms.length) fail(`No room "${query}": this floor has no rooms yet. Leave room out to see the whole floor.`);
  return fail(`No room "${query}" on this floor. Rooms: ${rooms.map(room => `${room.id} "${room.name}"`).join(', ')}.`);
}

function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ── Planning a picture ───────────────────────────────────────────────

const r0 = Math.round;
const at = (p: { x: number; z: number }) => `(${r0(p.x)}, ${r0(p.z)})`;

/** The shot for a request and the words that go with the picture. */
export function planView3d(request: View3dRequest, floor: Floor, project: Pick<Project, 'floors'>, rooms: View3dRoom[]): { shot: Viewer3dShot; text: string } {
  const notes: string[] = [];
  if (request.kind !== 'eye' && request.heightIgnored) notes.push('height only applies to from/to views and was ignored.');
  if (request.kind === 'room') {
    const room = findView3dRoom(rooms, request.room);
    const shot = roomShot(room.polygon, room.ceiling);
    const box = polygonBox(room.polygon, room.ceiling);
    return { shot, text: [
      `3D view of "${room.name}" (${room.id}), ${r0(box.maxX - box.minX)} × ${r0(box.maxY - box.minY)} cm, ceiling ${r0(room.ceiling)} cm, from above at ${ROOM_PITCH}°.`,
      `Camera above the plan's bottom right of the room at ${at(shot.eye)}, ${r0(shot.eye.y)} cm up, looking up-left at ${at(shot.target)}: plan +x runs towards the picture's lower right, plan +y towards its lower left, so the room's corner with the smallest x and y is at the top.`,
      'Walls, doors and windows on the camera side are see-through so the room shows; ceilings are not drawn from above. Room labels are hidden.',
      ...notes,
    ].join(' ') };
  }
  if (request.kind === 'eye') {
    const shot = eyeShot(request.from, request.to, request.height);
    const standing = rooms.find(room => insidePolygon(request.from, room.polygon));
    const facing = rooms.find(room => insidePolygon(request.to, room.polygon));
    const where = standing ? `standing in "${standing.name}"` : 'standing outside every room';
    if (standing && request.height >= standing.ceiling) notes.push(`The eye is at or above that room's ceiling (${r0(standing.ceiling)} cm), so the ceiling is not visible.`);
    return { shot, text: [
      `Eye-level 3D view from ${at(shot.eye)} towards ${at(shot.target)}, eyes ${r0(request.height)} cm above the floor, looking level (${EYE_FOV}° vertical, about ${r0(2 * Math.atan(Math.tan(EYE_FOV * Math.PI / 360) * VIEW3D_WIDTH / VIEW3D_HEIGHT) * 180 / Math.PI)}° across), ${where}${facing && facing !== standing ? `, facing into "${facing.name}"` : ''}.`,
      'Walls, ceilings and lights are drawn as built; room labels are hidden.',
      ...notes,
    ].join(' ') };
  }
  const shot = floorShot(floor, floorDefaultCeiling(project, floor));
  return { shot, text: [
    `3D view of the whole floor "${floor.name}" from above at ${FLOOR_PITCH}°, camera above the plan's bottom right at ${at(shot.eye)}, ${r0(shot.eye.y)} cm up, looking up-left at ${at(shot.target)}.`,
    'The outer walls on the camera side (largest x and y) are see-through; inner walls can still hide what stands right behind them, so use room or from/to for a closer look. Ceilings are not drawn from above and room labels are hidden.',
    ...notes,
  ].join(' ') };
}

// ── Running the tool ─────────────────────────────────────────────────

/** Opens the 3D view if needed and waits for its capturer; null when it does not come up. */
async function openViewer(deadline: number) {
  const controller = new AbortController();
  // The editor drops back to 2D when the viewer fails to load.
  const stop = viewMode.subscribe(mode => { if (mode !== '3d') controller.abort(); });
  try {
    return await waitForViewer3dCapture(Math.max(0, deadline - performance.now()), controller.signal);
  } finally { stop(); }
}

async function view3d(input: Record<string, unknown>): Promise<ToolOutcome> {
  const request = parseView3dInput(input);
  const project = get(currentProject) ?? fail('No plan is open.');
  const floor = get(activeFloor) ?? fail('No plan is open.');
  const { shot, text } = planView3d(request, floor, project, view3dRooms(project, floor, get(detectedRoomsStore)));

  const deadline = performance.now() + OPEN_TIMEOUT_MS;
  const opened = get(viewMode) !== '3d';
  // Entering 3D clears the selection; it is put back with the plan.
  const selection = opened ? { id: get(selectedElementId), ids: new Set(get(selectedElementIds)), room: get(selectedRoomId) } : null;
  if (opened) viewMode.set('3d');
  try {
    const capturer = await openViewer(deadline);
    if (!capturer) fail('The 3D view did not open in time, so there is no picture. Answer without it.');
    const { pendingModels } = await capturer!.whenReady(deadline);
    let url: string;
    try { url = capturer!.capture(shot); }
    catch (error) { return fail(`The 3D view could not be drawn in this browser (${(error as Error)?.message || 'WebGL unavailable'}). Answer without the picture.`); }
    const caveat = pendingModels ? ` ${pendingModels} furniture model${pendingModels === 1 ? ' was' : 's were'} still loading and show${pendingModels === 1 ? 's' : ''} as simple stand-in shapes.` : '';
    return { text: text + caveat, image: { mediaType: 'image/jpeg', data: url.slice(url.indexOf(',') + 1) } };
  } finally {
    if (opened && get(viewMode) === '3d') {
      viewMode.set('2d');
      // The person never saw 3D, so its first-visit tip waits for their own visit.
      import('$lib/stores/onboarding.svelte').then(m => m.hideTip('first-3d')).catch(() => {});
      // Only what entering 3D cleared, unless something else was selected meanwhile.
      if (selection && get(selectedElementId) === null && get(selectedRoomId) === null) {
        selectedElementIds.set(selection.ids);
        selectedElementId.set(selection.id);
        selectedRoomId.set(selection.room);
      }
    }
  }
}

// One picture at a time, so two calls never fight over opening and closing the view.
let queue: Promise<unknown> = Promise.resolve();

/** view_3d: a picture of the active floor in 3D. */
export function runView3d(input: Record<string, unknown>): Promise<ToolOutcome> {
  const run = queue.then(() => view3d(input)).catch((error): ToolOutcome => {
    if (error instanceof View3dError) return { text: `error: ${error.message}`, isError: true };
    console.error('assistant view_3d failed', error);
    return { text: `error: the 3D view failed (${(error as Error)?.message ?? 'unknown'}).`, isError: true };
  });
  queue = run;
  return run;
}
