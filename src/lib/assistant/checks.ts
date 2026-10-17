/**
 * Checks the Assistant can run and turn into reusable tools ("Build a tool").
 * A tool is data, never code: a kind, a name and a minimum. The plan draws
 * what the active check finds; the check bar lets the person adjust it.
 */
import { derived, get, writable } from 'svelte/store';
import type { Floor, Point } from '$lib/models/types';
import { resolveRoomGeometry } from '$lib/utils/roomDetection';
import { floorView } from '$lib/stores/chrome';
import { catalogName, furnitureFootprint, insidePolygon, isLayered, polygonArea, polygonGap, wallQuad } from './geometry';

export type CheckKind = 'walkway' | 'room_size';

export interface PlanTool {
  id: string;
  kind: CheckKind;
  name: string;
  description: string;
  minimum: number;
  createdAt: number;
}

export const CHECK_DEFAULTS: Record<CheckKind, { minimum: number; step: number; min: number; max: number; unit: 'cm' | 'm²' }> = {
  walkway: { minimum: 90, step: 5, min: 30, max: 200, unit: 'cm' },
  room_size: { minimum: 9, step: 0.5, min: 1, max: 100, unit: 'm²' },
};

export function clampMinimum(kind: CheckKind, value: unknown): number {
  const d = CHECK_DEFAULTS[kind];
  const n = Number(value);
  if (!Number.isFinite(n)) return d.minimum;
  return Math.min(d.max, Math.max(d.min, Math.round(n / d.step) * d.step));
}

// ── Saved tools ───────────────────────────────────────────────────────

const TOOLS_KEY = 'o3d_assistant_tools';
function readTools(): PlanTool[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(TOOLS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(t => t && (t.kind === 'walkway' || t.kind === 'room_size') && typeof t.id === 'string') : [];
  } catch { return []; }
}
export const assistantTools = writable<PlanTool[]>(readTools());
assistantTools.subscribe(list => {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(TOOLS_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
});

export function makeTool(kind: CheckKind, name: string, description: string, minimum?: number): PlanTool {
  const tool: PlanTool = {
    id: `tool-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind, name: name.trim().slice(0, 40) || (kind === 'walkway' ? 'Walkway check' : 'Room size check'),
    description: description.trim().slice(0, 140), minimum: clampMinimum(kind, minimum ?? CHECK_DEFAULTS[kind].minimum), createdAt: Date.now(),
  };
  assistantTools.update(list => [...list.filter(t => t.name !== tool.name), tool].slice(-20));
  return tool;
}

export function removeTool(id: string) {
  assistantTools.update(list => list.filter(t => t.id !== id));
  if (get(activeCheck)?.toolId === id) activeCheck.set(null);
}

// ── The check shown on the plan ───────────────────────────────────────

export interface ActiveCheck { toolId?: string; kind: CheckKind; name: string; minimum: number }
export const activeCheck = writable<ActiveCheck | null>(null);

export function showTool(tool: PlanTool, minimum?: number) {
  activeCheck.set({ toolId: tool.id, kind: tool.kind, name: tool.name, minimum: clampMinimum(tool.kind, minimum ?? tool.minimum) });
}

/** Change the minimum of the check on screen, and remember it on its tool. */
export function setCheckMinimum(value: number) {
  const check = get(activeCheck);
  if (!check) return;
  const minimum = clampMinimum(check.kind, value);
  activeCheck.set({ ...check, minimum });
  if (check.toolId) assistantTools.update(list => list.map(t => t.id === check.toolId ? { ...t, minimum } : t));
}

// ── Running checks ────────────────────────────────────────────────────

export interface WalkwayGap { between: [string, string]; distance: number; from: Point; to: Point }
export interface SmallRoom { name: string; area: number; polygon: Point[] }
export type CheckResult = { kind: 'walkway'; gaps: WalkwayGap[] } | { kind: 'room_size'; rooms: SmallRoom[] };

/** Gaps this small are deliberate (a nightstand against a bed), not walkways. */
const TOUCHING = 8;

export function runCheck(floor: Floor, kind: CheckKind, minimum: number): CheckResult {
  const geometry = resolveRoomGeometry(floor);
  if (kind === 'room_size') {
    const rooms = geometry
      .map(({ room, polygon }) => ({ name: room.name, area: polygonArea(polygon) / 10000, polygon }))
      .filter(room => !room.polygon.length ? false : room.area < minimum);
    return { kind, rooms };
  }
  const items = floor.furniture.filter(item => !isLayered(item)).map(item => ({ label: catalogName(item), shape: furnitureFootprint(item) }));
  const walls = floor.walls.filter(wall => !wall.curvePoint).map(wall => ({ label: 'wall', shape: wallQuad(wall) }));
  const polygons = geometry.map(g => g.polygon);
  const inRoom = (p: Point) => polygons.some(poly => insidePolygon(p, poly));
  const gaps: WalkwayGap[] = [];
  for (let i = 0; i < items.length; i++) {
    for (const other of [...items.slice(i + 1), ...walls]) {
      const gap = polygonGap(items[i].shape, other.shape);
      if (gap.distance <= TOUCHING || gap.distance >= minimum) continue;
      const middle = { x: (gap.from.x + gap.to.x) / 2, y: (gap.from.y + gap.to.y) / 2 };
      if (!inRoom(middle)) continue;
      gaps.push({ between: [items[i].label, other.label], distance: Math.round(gap.distance), from: gap.from, to: gap.to });
    }
  }
  return { kind, gaps: gaps.sort((a, b) => a.distance - b.distance) };
}

export function describeResult(result: CheckResult, minimum: number): string {
  if (result.kind === 'room_size') {
    if (!result.rooms.length) return `No rooms smaller than ${minimum} m².`;
    return `${result.rooms.length} room(s) smaller than ${minimum} m²:\n${result.rooms.map(r => `- ${r.name}: ${r.area.toFixed(1)} m²`).join('\n')}`;
  }
  if (!result.gaps.length) return `No gaps narrower than ${minimum} cm.`;
  return `${result.gaps.length} gap(s) narrower than ${minimum} cm:\n${result.gaps.slice(0, 30).map(g => `- ${g.distance} cm between ${g.between[0]} and ${g.between[1]} at (${Math.round((g.from.x + g.to.x) / 2)},${Math.round((g.from.y + g.to.y) / 2)})`).join('\n')}`;
}

/** What the active check finds on the floor being shown. */
export const checkResult = derived([activeCheck, floorView], ([$check, $floor]): CheckResult | null =>
  $check && $floor ? runCheck($floor, $check.kind, $check.minimum) : null);
