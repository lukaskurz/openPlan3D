import { selectionRotation } from '$lib/utils/selectionRotation';
import { splitWallRoomReferences } from '$lib/utils/splitWallRooms';
import { splitWallGeometry } from '$lib/utils/splitWallGeometry';
import { wallPathProfile } from '$lib/utils/wallProfiles';
import { duplicatePlanSelection, pastePlanSelection, shiftedOpeningPosition } from '$lib/utils/duplicateSelection';
import { writable, derived, get, type Writable } from 'svelte/store';
import type { Project, Floor, Wall, Door, Window as Win, FurnitureItem, Point, Stair, Column, BackgroundImage, GuideLine, ElementGroup, EntourageItem, InterchangeState, Pipe, PlanSection } from '$lib/models/types';
import { nextSectionCode } from '$lib/utils/sectionPlan';
import { minPipePoints, validPipeData } from '$lib/utils/pipes';
import { planWallResize, planWallAngle, planStraightenWalls, finitePoint, validPositiveDimension, validOpeningPosition, type WallEndpoint } from '$lib/utils/wallEditing';
import { getOuterWalls } from '$lib/utils/outerWalls';
import { nextFloorLevel, floorElevations, validFloorElevation, orderedFloors, DEFAULT_FLOOR_SPACING } from '$lib/utils/floors';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { defaultMountingHeight, furnitureMount } from '$lib/utils/mounting';
import { validCeilingHeight } from '$lib/utils/ceilingHeights';
import { rehostWallItems, reverseHostedItems, splitHostedItems } from '$lib/utils/wallHostedItems';
import { switchLinksWithout, toggledSwitchLinks } from '$lib/utils/switchLinks';
import { getWallStartHeight, getWallEndHeight, getWallHeightAt, validWallHeight } from '$lib/models/types';
import type { DetailTarget, ItemDetails } from '$lib/models/types';
import { detailItem, itemDetails, validateItemDetails } from '$lib/utils/itemDetails';
import { readProject } from '$lib/utils/projectValidation';
import { mergeRoomPlanFloors, selectableContentIds, type AddedContent } from '$lib/utils/roomplanMerge';
import { doorJoin } from '$lib/utils/scanAlignment';
import { branchAlternative, deleteAlternative, ensureAlternativeCodes, renameAlternative, switchAlternative } from '$lib/utils/planAlternatives';
import type { Constraint, CornerRef, NewConstraint } from '$lib/models/types';
import { buildSketch, checkNewConstraint, endpointKey, isActiveConstraint, isDimension, measureConstraint, planConstraintSolve, planConstraintValue } from '$lib/utils/constraints';
import { constraintMentionsWall, constraintsWithoutWalls, reverseWallConstraints, splitWallConstraints } from '$lib/utils/constraints/cascade';


function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createDefaultFloor(level = 0): Floor {
  const id = uid();
  return { id, name: level === 0 ? 'Ground Floor' : `Floor ${level}`, level, walls: [], rooms: [], doors: [], windows: [], furniture: [], stairs: [], columns: [], guides: [], measurements: [], annotations: [], textAnnotations: [], groups: [] };
}

export function createDefaultProject(name = 'Untitled Project'): Project {
  const floor = createDefaultFloor();
  return {
    id: uid(),
    name,
    floors: [floor],
    activeFloorId: floor.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export const currentProject = writable<Project | null>(null);

export const activeFloor = derived(currentProject, ($p) => {
  if (!$p) return null;
  return $p.floors.find((f) => f.id === $p.activeFloorId) ?? $p.floors[0] ?? null;
});

export type Tool = 'select' | 'wall' | 'door' | 'window' | 'furniture' | 'text' | 'measure' | 'annotate' | 'pipe' | 'section';
export const selectedTool = writable<Tool>('select');

/** Shared activation for the sidebar and keyboard measurement tools. */
export function activateMeasurementTool(tool: 'measure' | 'annotate') {
  panMode.set(false);
  placingFurnitureId.set(null);
  placingStair.set(false);
  placingColumn.set(false);
  placingEntourageId.set(null);
  calibrationMode.set(false);
  doorJoinMode.set(null);
  elevationPickMode.set(false);
  selectedTool.set(tool);
}
export const snapEnabled = writable<boolean>(true);
/** When true, left-click drag pans the canvas instead of selecting */
export const panMode = writable<boolean>(false);
export const showFurnitureStore = writable<boolean>(true);
export const selectedElementId = writable<string | null>(null);
/** Multi-select: set of element IDs currently selected (used alongside selectedElementId for marquee/shift-click) */
export const selectedElementIds = writable<Set<string>>(new Set());
export const viewMode = writable<'2d' | '3d'>('2d');

// Undo / Redo
/** The canvas selection that went with a history state. It travels with the state so Undo leaves the
 *  elements selected that the user had before the step and Redo the ones they had after it. */
interface SelectionSnapshot { id: string | null; ids: string[] }
interface UndoEntry {
  state: string;
  description: string;
  timestamp: number;
  selection?: SelectionSnapshot;
}
const captureSelection = (): SelectionSnapshot => ({ id: get(selectedElementId), ids: [...get(selectedElementIds)] });
const undoStack: UndoEntry[] = [];
const redoStack: UndoEntry[] = [];
function pushHistory(stack: UndoEntry[], entry: UndoEntry) {
  stack.push(entry);
  // Photos must not multiply into an unbounded string history. Always retain
  // the latest step, even for an existing project larger than this budget.
  let bytes = stack.reduce((sum, item) => sum + item.state.length * 2, 0);
  while (stack.length > 1 && (stack.length > 50 || bytes > 32 * 1024 * 1024)) bytes -= stack.shift()!.state.length * 2;
}

/** Reactive store exposing undo history for the UndoHistoryPanel */
export const undoHistoryStore = writable<{ entries: { description: string; timestamp: number }[]; currentIndex: number }>({ entries: [], currentIndex: -1 });

function syncHistoryStore() {
  const entries = undoStack.map(e => ({ description: e.description, timestamp: e.timestamp }));
  // currentIndex: undoStack.length means "current state" (top), entries are past states
  undoHistoryStore.set({ entries, currentIndex: undoStack.length });
}

/** Current undo action description — set before calling mutate/snapshot */
let _nextDescription = '';

// Undo coalescing: rapid consecutive edits to the same field (e.g. typing digits
// into a dimension input, which fires `oninput` per keystroke) should collapse into
// a single undo entry instead of one per keystroke. The first edit pushes the
// pre-edit baseline; subsequent edits sharing the same key within the time window
// reuse it rather than pushing a fresh snapshot.
let _lastCoalesceKey: string | null = null;
let _lastSnapshotTime = 0;
const COALESCE_WINDOW_MS = 800;

/** Break any active coalescing chain so the next edit starts a fresh undo entry. */
function resetCoalescing() {
  _lastCoalesceKey = null;
}

/** Build a coalesce key for an element edit from its type, id, and the fields changed.
 *  Rapid edits to the same element+fields collapse into one undo entry; changing which
 *  fields are edited (or which element) starts a new entry. */
function coalesceKeyFor(type: string, id: string, updates: Record<string, unknown>): string {
  return `${type}:${id}:${Object.keys(updates).sort().join(',')}`;
}

// Undo grouping: batch multiple mutations into a single undo entry
let undoGroupSnapshot: string | null = null;
let undoGroupUpdatedAt: Project['updatedAt'] | undefined;
let undoGroupSelection: SelectionSnapshot | undefined;
let undoGroupDepth = 0;

/** Begin an undo group. Nested calls are supported; only the outermost pair takes effect. */
export function beginUndoGroup() {
  if (undoGroupDepth === 0) {
    const p = get(currentProject);
    undoGroupSnapshot = p ? JSON.stringify(p) : null;
    undoGroupUpdatedAt = p?.updatedAt;
    undoGroupSelection = captureSelection();
  }
  undoGroupDepth++;
}

/** End an undo group. Commits a single undo entry from the state captured at beginUndoGroup(). */
export function endUndoGroup(description?: string) {
  if (undoGroupDepth <= 0) return;
  undoGroupDepth--;
  if (undoGroupDepth === 0) {
    const before = undoGroupSnapshot, updatedAt = undoGroupUpdatedAt, selection = undoGroupSelection;
    const action = description || _nextDescription || 'Group action';
    undoGroupSnapshot = null;
    undoGroupUpdatedAt = undefined;
    undoGroupSelection = undefined;
    _nextDescription = '';
    resetCoalescing();
    const project = get(currentProject);
    // Drag frames bump updatedAt; only changed content earns an entry and discards Redo.
    if (before === null || !project || JSON.stringify({ ...project, updatedAt }) === before) return;
    pushHistory(undoStack, { state: before, description: action, timestamp: Date.now(), selection });
    redoStack.length = 0;
    syncHistoryStore();
  }
}

/** Record the project as it is now, or `state` (its JSON before an in-place edit), as the next Undo step. */
function snapshot(description?: string, coalesceKey?: string, state?: string) {
  // If inside an undo group, skip — the group handles the snapshot
  if (undoGroupDepth > 0) return;
  const p = get(currentProject);
  if (!p) return;
  const now = Date.now();
  // Coalesce rapid consecutive edits to the same field: the top-of-stack entry
  // already holds the correct pre-edit baseline, so don't push another snapshot.
  if (
    coalesceKey &&
    coalesceKey === _lastCoalesceKey &&
    now - _lastSnapshotTime < COALESCE_WINDOW_MS &&
    undoStack.length > 0
  ) {
    _lastSnapshotTime = now;
    redoStack.length = 0;
    return;
  }
  pushHistory(undoStack, { state: state ?? JSON.stringify(p), description: description || _nextDescription || 'Edit', timestamp: now, selection: captureSelection() });
  redoStack.length = 0;
  _nextDescription = '';
  _lastCoalesceKey = coalesceKey ?? null;
  _lastSnapshotTime = now;
  syncHistoryStore();
}

function reviveDates(p: Project): Project {
  if (p.createdAt && !(p.createdAt instanceof Date)) p.createdAt = new Date(p.createdAt as any);
  if (p.updatedAt && !(p.updatedAt instanceof Date)) p.updatedAt = new Date(p.updatedAt as any);
  for (const alt of p.alternatives ?? []) if (!(alt.updatedAt instanceof Date)) alt.updatedAt = new Date(alt.updatedAt as any);
  return p;
}

/** Selections and elevation targets belong to one floor, never the one switched to. */
function clearFloorContext() {
  calibrationMode.set(false);
  calibrationPoints.set([]);
  doorJoinMode.set(null);
  selectedElementId.set(null);
  selectedElementIds.set(new Set());
  selectedRoomId.set(null);
  detectedRoomsStore.set([]);
  elevationWallId.set(null);
  elevationPickMode.set(false);
  selectedTool.set('select');
  placingFurnitureId.set(null);
  placingStair.set(false);
  placingColumn.set(false);
  placingEntourageId.set(null);
}

/** Ids the restored floor no longer holds must not drive the next edit (Delete on a stale selection). */
function pruneFloorContext(project: Project) {
  const floor = project.floors.find(f => f.id === project.activeFloorId) ?? project.floors[0];
  if (!floor) return;
  const ids = new Set([floor.walls, floor.doors, floor.windows, floor.furniture, floor.stairs ?? [], floor.columns ?? [], floor.guides ?? [],
    floor.measurements ?? [], floor.annotations ?? [], floor.textAnnotations ?? [], floor.entourage ?? []].flat().map(item => item.id));
  const prune = (store: Writable<string | null>, known: Set<string>) => {
    const id = get(store);
    if (id !== null && !known.has(id)) store.set(null);
  };
  // Sections are project-level: one stays selected (and open) while the project still has it.
  const sectionIds = new Set((project.sections ?? []).map(section => section.id));
  for (const id of sectionIds) ids.add(id);
  prune(selectedElementId, ids);
  prune(openSectionId, sectionIds);
  prune(elevationWallId, new Set(floor.walls.map(wall => wall.id)));
  prune(selectedRoomId, new Set([...floor.rooms, ...get(detectedRoomsStore)].map(room => room.id)));
  const selected = [...get(selectedElementIds)];
  if (selected.some(id => !ids.has(id))) selectedElementIds.set(new Set(selected.filter(id => ids.has(id))));
}

/** Restore a history state with the selection recorded for it; entries without one keep the current selection, pruned. */
function restoreHistoryProject(state: string, selection?: SelectionSnapshot) {
  const project = reviveDates(JSON.parse(state));
  const current = get(currentProject);
  if (current?.activeFloorId !== project.activeFloorId || current?.activeAlternativeId !== project.activeAlternativeId) clearFloorContext();
  currentProject.set(project);
  if (selection) {
    selectedElementId.set(selection.id);
    selectedElementIds.set(new Set(selection.ids));
  }
  pruneFloorContext(project);
}

// ── Previews ──────────────────────────────────────────────────────
// The Assistant draws its proposed changes on the real plan. Everything from
// beginPreview() on becomes a single undo step when committed; discarding (or
// pressing undo) puts the plan back exactly as it was.

/** True while proposed changes are shown on the plan but not yet applied. */
export const previewActive = writable(false);
let previewBaseline: string | null = null;

export function beginPreview() {
  if (previewBaseline !== null) return;
  const p = get(currentProject);
  if (!p) return;
  previewBaseline = JSON.stringify(p);
  beginUndoGroup();
  previewActive.set(true);
}

export function commitPreview(description: string) {
  if (previewBaseline === null) return;
  previewBaseline = null;
  undoGroupDepth = 1;
  endUndoGroup(description);
  previewActive.set(false);
}

export function discardPreview() {
  if (previewBaseline === null) return;
  const state = previewBaseline;
  previewBaseline = null;
  restoreHistoryProject(state);
  undoGroupDepth = 1;
  endUndoGroup();
  previewActive.set(false);
}

/** Run an edit on the active floor as one undoable change. */
export function editActiveFloor(fn: (floor: Floor) => void, description?: string) {
  mutate(fn, description);
}

export function undo() {
  if (previewBaseline !== null) { discardPreview(); return; }
  resetCoalescing();
  const prev = undoStack.pop();
  if (!prev) return;
  const cur = get(currentProject);
  if (cur) pushHistory(redoStack, { state: JSON.stringify(cur), description: prev.description, timestamp: prev.timestamp, selection: captureSelection() });
  restoreHistoryProject(prev.state, prev.selection);
  syncHistoryStore();
}

export function redo() {
  if (previewBaseline !== null) return;
  resetCoalescing();
  const next = redoStack.pop();
  if (!next) return;
  const cur = get(currentProject);
  if (cur) pushHistory(undoStack, { state: JSON.stringify(cur), description: next.description, timestamp: next.timestamp, selection: captureSelection() });
  restoreHistoryProject(next.state, next.selection);
  syncHistoryStore();
}

/** Jump to a specific undo history step by index (0 = oldest) */
export function jumpToUndoStep(targetIndex: number) {
  if (previewBaseline !== null) discardPreview();
  const total = undoStack.length; // total past states; current state is at index `total`
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > total) return;
  if (targetIndex === total) return; // already at current state
  const cur = get(currentProject);
  if (!cur) return;
  resetCoalescing();

  // Pair each redo state with the action that produced it, just as undo() does.
  // Publish only the final state rather than every intermediate project.
  const stepsBack = total - targetIndex;
  let state = JSON.stringify(cur), selection: SelectionSnapshot | undefined = captureSelection();
  for (let i = 0; i < stepsBack; i++) {
    const entry = undoStack.pop()!;
    pushHistory(redoStack, { state, description: entry.description, timestamp: entry.timestamp, selection });
    state = entry.state;
    selection = entry.selection;
  }
  restoreHistoryProject(state, selection);
  syncHistoryStore();
}

/** Apply `fn` to the active floor as one Undo step. An edit that changes nothing leaves history, Redo and updatedAt alone. */
function mutate(fn: (floor: Floor) => void, description?: string, coalesceKey?: string) {
  const p = get(currentProject);
  const floor = p?.floors.find((f) => f.id === p.activeFloorId);
  if (!p || !floor) return;
  const before = JSON.stringify(p);
  fn(floor);
  // Wall-hosted items follow their walls whatever the edit did to them (idempotent).
  rehostWallItems(floor);
  if (JSON.stringify(p) === before) return;
  snapshot(description, coalesceKey, before);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Apply `fn` to the project itself (project-level data such as sections) as one Undo step, like `mutate`. */
function mutateProject(fn: (project: Project) => void, description?: string, coalesceKey?: string) {
  const p = get(currentProject);
  if (!p) return;
  const before = JSON.stringify(p);
  fn(p);
  if (JSON.stringify(p) === before) return;
  snapshot(description, coalesceKey, before);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

export function addWall(start: Point, end: Point): string {
  const id = uid();
  mutate((f) => {
    // Copy the coordinates: the canvas passes magnet-snap results (with snappedTo* flags) and
    // reuses one point for the next wall's start; the model keeps plain, independent points.
    f.walls.push({ id, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, thickness: 15, height: 280, startHeight: 280, endHeight: 280, color: '#444444' });
  }, 'Added wall');
  if (typeof window !== 'undefined') {
    import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-wall', end.x > 400 ? 300 : end.x + 20, 120)).catch(() => {});
  }
  return id;
}

/** Take deleted ids out of the floor's switch links (dropping links left empty); leaves the floor alone when none is affected. */
function dropSwitchLinksTo(f: Floor, removed: ReadonlySet<string>) {
  if (!f.switchLinks) return;
  const next = switchLinksWithout(f.switchLinks, removed);
  if (next === f.switchLinks) return;
  if (next.length) f.switchLinks = next;
  else delete f.switchLinks;
}

export function removeWall(id: string) {
  mutate((f) => {
    f.walls = f.walls.filter((w) => w.id !== id);
    f.doors = f.doors.filter((d) => d.wallId !== id);
    f.windows = f.windows.filter((w) => w.wallId !== id);
    // Wall-hosted items (outlets, switches, sconces) go with their wall, like openings.
    const hosted = new Set(f.furniture.filter(item => item.wallId === id).map(item => item.id));
    if (hosted.size) {
      f.furniture = f.furniture.filter(item => !hosted.has(item.id));
      dropSwitchLinksTo(f, hosted);
      if (f.groups) f.groups = f.groups.map(group => ({ ...group, elementIds: group.elementIds.filter(itemId => !hosted.has(itemId)) })).filter(group => group.elementIds.length >= 2);
    }
    if (f.constraints) f.constraints = constraintsWithoutWalls(f.constraints, new Set([id]));
  }, 'Deleted wall');
}

export function addDoor(wallId: string, position: number, doorType: Door['type'] = 'single'): string {
  const id = uid();
  const defaults: Record<Door['type'], { width: number; height: number }> = {
    single: { width: 90, height: 210 },
    double: { width: 150, height: 210 },
    sliding: { width: 180, height: 210 },
    french: { width: 150, height: 220 },
    balcony: { width: 90, height: 220 },
    pocket: { width: 90, height: 210 },
    bifold: { width: 180, height: 210 },
    opening: { width: 100, height: 210 },
    garage: { width: 240, height: 210 },
  };
  const { width, height } = defaults[doorType];
  mutate((f) => {
    f.doors.push({ id, wallId, position, width, height, type: doorType, swingDirection: 'left', flipSide: false });
  }, `Added ${doorType} door`);
  if (typeof window !== 'undefined') {
    import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-door', 300, 120)).catch(() => {});
  }
  return id;
}

export function addWindow(wallId: string, position: number, windowType: import('$lib/models/types').Window['type'] = 'standard'): string {
  const id = uid();
  const defaults: Record<import('$lib/models/types').Window['type'], { width: number; height: number }> = {
    standard: { width: 120, height: 120 },
    fixed: { width: 100, height: 100 },
    casement: { width: 80, height: 130 },
    sliding: { width: 180, height: 120 },
    bay: { width: 200, height: 150 },
  };
  const { width, height } = defaults[windowType];
  mutate((f) => {
    f.windows.push({ id, wallId, position, width, height, sillHeight: 90, type: windowType });
  }, `Added ${windowType} window`);
  return id;
}

/** Where a wall-mounted item hangs: its wall, the position along it (0..1) and the side its face points to. */
export interface WallHost { wallId: string; wallPosition: number; wallSide: 1 | -1 }

/**
 * Place a catalog item. Floor and wall items get the catalog's elevation (a wall
 * item's mounting height); ceiling items store none, since their height follows
 * the room's ceiling (spec §4.2). A wall item may be given its `host` wall, which
 * is stored when that wall is on the active floor.
 */
export function addFurniture(catalogId: string, position: Point, host?: WallHost): string {
  const id = uid();
  mutate((f) => {
    const def = getCatalogItem(catalogId);
    const elevation = def ? defaultMountingHeight(def) : undefined;
    const item: FurnitureItem = { id, catalogId, position, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...(elevation ? { elevation } : {}) };
    if (host && furnitureMount(item) === 'wall' && f.walls.some(wall => wall.id === host.wallId) && Number.isFinite(host.wallPosition)) {
      item.wallId = host.wallId;
      item.wallPosition = Math.max(0, Math.min(1, host.wallPosition));
      item.wallSide = host.wallSide === -1 ? -1 : 1;
    }
    f.furniture.push(item);
  }, `Added ${catalogId}`);
  if (typeof window !== 'undefined') {
    import('$lib/stores/onboarding.svelte').then(m => m.triggerTip('first-furniture', position.x + 20, position.y + 20)).catch(() => {});
  }
  return id;
}

/** Snapshot the current state before a drag begins (call once at drag start) */
export function beginDrag(description = 'Moved element') {
  snapshot(description);
}

/** Move furniture without creating an undo snapshot on every call (used during drag).
 *  Call `beginDrag()` when the drag starts to snapshot the pre-drag state. */
export function moveFurniture(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const item = floor.furniture.find((fi) => fi.id === id);
  if (item && !samePoint(item.position, position)) {
    item.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Apply one drag frame atomically. The canvas owns the enclosing undo group. */
export function transformFurnitureDuringDrag(id: string, updates: Partial<Pick<FurnitureItem, 'position' | 'rotation' | 'scale' | 'width' | 'depth'>>) {
  const p = get(currentProject);
  const floor = p?.floors.find(f => f.id === p.activeFloorId);
  const item = floor?.furniture.find(fi => fi.id === id);
  if (!p || !item) return;
  const { position, rotation, scale } = updates;
  if ((!position || samePoint(item.position, position)) && (rotation === undefined || rotation === item.rotation)
    && (!scale || (scale.x === item.scale.x && scale.y === item.scale.y && scale.z === item.scale.z))) return;
  Object.assign(item, updates);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Snapshot the current state before a drag begins (call once at drag start).
 *  Alias for beginDrag() for backward compatibility. */
export function commitFurnitureMove() {
  snapshot('Moved furniture');
}

/** Rotate supported unlocked objects and walls around their collective bounds center. */
export function rotateSelection(ids: ReadonlySet<string>, degrees = 15) {
  const project = get(currentProject), floor = get(activeFloor);
  if (!project || !floor) return;
  const updates = selectionRotation(floor,ids,degrees,project.customEntourage);
  if (!updates.size) return;
  mutate(f => {
    for (const item of [...f.furniture,...f.stairs ?? [],...f.columns ?? [],...f.entourage ?? []]) {
      const update = updates.get(item.id);
      if (update) Object.assign(item,update);
    }
    for (const wall of f.walls) {
      const update = updates.get(wall.id)?.wall;
      if (update) Object.assign(wall,update);
    }
    for (const item of f.textAnnotations ?? []) {
      const update = updates.get(item.id);
      if (update) Object.assign(item, { x:update.position.x,y:update.position.y,rotation:update.rotation });
    }
    for (const item of [...f.measurements ?? [],...f.annotations ?? []]) {
      const update = updates.get(item.id);
      if (update?.endpoints) Object.assign(item,update.endpoints);
    }
    for (const pipe of f.pipes ?? []) {
      const points = updates.get(pipe.id)?.points;
      if (points) pipe.points = points;
    }
  }, 'Rotated selection');
}

export function rotateFurniture(id: string, angle: number) {
  mutate((f) => {
    const item = f.furniture.find((fi) => fi.id === id);
    if (item) item.rotation = (item.rotation + angle) % 360;
  }, 'Rotated furniture');
}

export function setFurnitureRotation(id: string, angle: number) {
  mutate((f) => {
    const item = f.furniture.find((fi) => fi.id === id);
    if (item) item.rotation = ((angle % 360) + 360) % 360;
  });
}

export function scaleFurniture(id: string, scale: { x: number; y: number }) {
  const item = get(activeFloor)?.furniture.find(item => item.id === id);
  if (!item || !Number.isFinite(scale.x) || !Number.isFinite(scale.y)) return;
  const bounded = (value: number) => (value < 0 ? -1 : 1) * Math.max(0.2, Math.abs(value));
  updateFurniture(id, { scale: { x: bounded(scale.x), y: bounded(scale.y), z: item.scale.z } });
}

/** Furniture array order controls painting and hit testing in the plan. */
export function reorderFurniture(id: string, destination: 'front' | 'back') {
  const furniture = get(activeFloor)?.furniture;
  if (!furniture) return;
  const index = furniture.findIndex(item => item.id === id);
  const target = destination === 'front' ? furniture.length - 1 : 0;
  if (index < 0 || index === target) return;
  mutate(floor => {
    const [item] = floor.furniture.splice(index, 1);
    floor.furniture.splice(target, 0, item);
  }, destination === 'front' ? 'Brought furniture to front' : 'Sent furniture to back');
}

export function removeFurniture(id: string) {
  mutate((f) => {
    f.furniture = f.furniture.filter((fi) => fi.id !== id);
    dropSwitchLinksTo(f, new Set([id]));
  }, 'Deleted furniture');
}

// Stairs
export function addStair(position: Point): string {
  const id = uid();
  mutate((f) => {
    if (!f.stairs) f.stairs = [];
    f.stairs.push({ id, position, rotation: 0, width: 100, depth: 300, riserCount: 14, direction: 'up', stairType: 'straight' });
  }, 'Added stair');
  return id;
}

export function updateStair(id: string, updates: Partial<Stair>) {
  mutate((f) => {
    if (!f.stairs) return;
    const s = f.stairs.find((s) => s.id === id);
    if (s) Object.assign(s, updates);
  }, undefined, coalesceKeyFor('stair', id, updates));
}

export function removeStair(id: string) {
  mutate((f) => {
    if (!f.stairs) return;
    f.stairs = f.stairs.filter((s) => s.id !== id);
  });
}

export function moveStair(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor || !floor.stairs) return;
  const s = floor.stairs.find((s) => s.id === id);
  if (s && !samePoint(s.position, position)) {
    s.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

// Background Image
export function setBackgroundImage(bg: BackgroundImage | undefined) {
  mutate((f) => {
    f.backgroundImage = bg;
  });
}

export function updateBackgroundImage(updates: Partial<BackgroundImage>) {
  mutate((f) => {
    if (f.backgroundImage) Object.assign(f.backgroundImage, updates);
  });
}

// Column functions
export function addColumn(position: Point, shape: 'round' | 'square' = 'round'): string {
  const id = uid();
  mutate((f) => {
    if (!f.columns) f.columns = [];
    f.columns.push({ id, position, rotation: 0, shape, diameter: 30, height: 280, color: '#cccccc' });
  }, `Added ${shape} column`);
  return id;
}

export function updateColumn(id: string, updates: Partial<Column>) {
  mutate((f) => {
    if (!f.columns) return;
    const c = f.columns.find((c) => c.id === id);
    if (c) Object.assign(c, updates);
  }, undefined, coalesceKeyFor('column', id, updates));
}

export function removeColumn(id: string) {
  mutate((f) => {
    if (!f.columns) return;
    f.columns = f.columns.filter((c) => c.id !== id);
  });
}

export function moveColumn(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor || !floor.columns) return;
  const c = floor.columns.find((c) => c.id === id);
  if (c && !samePoint(c.position, position)) {
    c.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Tool for placing columns */
export const placingColumn = writable<boolean>(false);
export const placingColumnShape = writable<'round' | 'square'>('round');

/** Tool for placing stairs */
export const placingStair = writable<boolean>(false);

// --- Entourage (2D presentation symbols) ---
export const placingEntourageId = writable<string | null>(null);

export function addEntourageItem(defId: string, position: Point, width: number): string {
  const id = uid();
  mutate((f) => {
    if (!f.entourage) f.entourage = [];
    f.entourage.push({ id, defId, position, width, rotation: 0 });
  }, 'Added entourage');
  return id;
}

/** Move an entourage item without snapshotting (used during drag). */
export function moveEntourage(id: string, position: Point) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  const item = floor?.entourage?.find((e) => e.id === id);
  if (item && !samePoint(item.position, position)) {
    item.position = position;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Resize an entourage item without snapshotting (used during handle drag). */
export function resizeEntourage(id: string, width: number) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  const item = floor?.entourage?.find((e) => e.id === id);
  if (item && item.width !== width) {
    item.width = width;
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

export function updateEntourageItem(id: string, updates: Partial<EntourageItem>) {
  mutate((f) => {
    const e = f.entourage?.find((e) => e.id === id);
    if (e) Object.assign(e, updates);
  }, undefined, coalesceKeyFor('entourage', id, updates));
}

/** Register an uploaded PNG as a reusable project-level entourage symbol. */
export function addCustomEntourage(name: string, dataUrl: string, aspect: number): string {
  const p = get(currentProject);
  if (!p) return '';
  snapshot('Added custom entourage');
  if (!p.customEntourage) p.customEntourage = [];
  const id = uid();
  p.customEntourage.push({ id, name, dataUrl, aspect });
  p.updatedAt = new Date();
  currentProject.set({ ...p });
  return id;
}

/** Scale calibration mode */
export const calibrationMode = writable<boolean>(false);
export const calibrationPoints = writable<Point[]>([]);

/** Delete a room's exclusive boundary and metadata, preserving neighboring rooms. */
export function removeRoom(id: string) {
  const floor = get(activeFloor);
  if (!floor) return;
  const rooms = [...floor.rooms, ...get(detectedRoomsStore)];
  const room = rooms.find(room => room.id === id);
  if (!room) return;
  const retainedWalls = new Set(rooms.filter(room => room.id !== id).flatMap(room => room.walls));
  beginUndoGroup();
  try {
    for (const wallId of room.walls) {
      if (!retainedWalls.has(wallId)) removeElement(wallId);
    }
    mutate(floor => {
      floor.rooms = floor.rooms.filter(room => room.id !== id);
      if (floor.roomCeilingHeights && id in floor.roomCeilingHeights) {
        delete floor.roomCeilingHeights[id];
        if (Object.keys(floor.roomCeilingHeights).length === 0) delete floor.roomCeilingHeights;
      }
    }, 'Deleted room');
    detectedRoomsStore.update(rooms => rooms.filter(room => room.id !== id));
  } finally {
    endUndoGroup();
  }
}

export function removeElement(id: string) {
  // Sections live on the project, not the floor (Delete key, context menu, action slot).
  if (get(currentProject)?.sections?.some(section => section.id === id)) { removeSection(id); return; }
  mutate((f) => {
    // Check if the element being removed is a wall — if so, also remove associated doors/windows
    const isWall = f.walls.some((w) => w.id === id);
    const removedIds = new Set([id]);
    if (isWall) for (const opening of [...f.doors, ...f.windows, ...f.furniture]) {
      // Openings and wall-hosted items (outlets, switches, sconces) go with their wall.
      if (opening.wallId === id) removedIds.add(opening.id);
    }
    f.walls = f.walls.filter((w) => w.id !== id);
    if (isWall) {
      // Cascade delete: remove doors and windows attached to this wall
      f.doors = f.doors.filter((d) => d.wallId !== id);
      f.windows = f.windows.filter((w) => w.wallId !== id);
    }
    f.doors = f.doors.filter((d) => d.id !== id);
    f.windows = f.windows.filter((w) => w.id !== id);
    f.furniture = f.furniture.filter((fi) => !removedIds.has(fi.id));
    dropSwitchLinksTo(f, removedIds);
    if (f.stairs) f.stairs = f.stairs.filter((s) => s.id !== id);
    if (f.columns) f.columns = f.columns.filter((c) => c.id !== id);
    if (f.textAnnotations) f.textAnnotations = f.textAnnotations.filter((t) => t.id !== id);
    if (f.measurements) f.measurements = f.measurements.filter(item => item.id !== id);
    if (f.annotations) f.annotations = f.annotations.filter(item => item.id !== id);
    if (f.pipes) f.pipes = f.pipes.filter(item => item.id !== id);
    if (f.entourage) f.entourage = f.entourage.filter((e) => e.id !== id);
    if (f.constraints) {
      f.constraints = f.constraints.filter(c => c.id !== id);
      if (isWall) f.constraints = constraintsWithoutWalls(f.constraints, new Set([id]));
    }
    if (f.groups) f.groups = f.groups.map(group => ({ ...group, elementIds: group.elementIds.filter(itemId => !removedIds.has(itemId)) })).filter(group => group.elementIds.length >= 2);
  }, 'Deleted element');
}

/** Move a wall endpoint without creating an undo snapshot (for dragging) */
export function moveWallEndpoint(id: string, endpoint: 'start' | 'end', position: Point) {
  if (!finitePoint(position)) return;
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const w = floor.walls.find((w) => w.id === id);
  if (w && !samePoint(w[endpoint], position)) {
    // Store only x/y: the drag passes magnet-snap results carrying snappedTo* flags and the
    // same object to every joined corner, which otherwise reach saves and Download JSON.
    w[endpoint] = { x: position.x, y: position.y };
    rehostWallItems(floor);
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** Translate wall geometry during a drag; the canvas owns the Undo group. */
export function moveWallGeometryDuringDrag(id: string, geometry: Pick<Wall, 'start' | 'end' | 'curvePoint'>) {
  if (!finitePoint(geometry.start) || !finitePoint(geometry.end) ||
    (geometry.curvePoint !== undefined && !finitePoint(geometry.curvePoint))) return;
  const project = get(currentProject);
  const wall = project?.floors.find(floor => floor.id === project.activeFloorId)?.walls.find(wall => wall.id === id);
  if (!project || !wall) return;
  if (samePoint(wall.start, geometry.start) && samePoint(wall.end, geometry.end)
    && (!geometry.curvePoint || (wall.curvePoint && samePoint(wall.curvePoint, geometry.curvePoint)))) return;
  wall.start = { x: geometry.start.x, y: geometry.start.y };
  wall.end = { x: geometry.end.x, y: geometry.end.y };
  if (geometry.curvePoint) wall.curvePoint = { x: geometry.curvePoint.x, y: geometry.curvePoint.y };
  rehostWallItems(project.floors.find(floor => floor.id === project.activeFloorId)!);
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

/** Apply a solved drag step to several walls at once; the canvas owns the Undo group. */
export function moveWallsDuringDrag(changes: Map<string, Partial<Wall>>) {
  const project = get(currentProject);
  const floor = project?.floors.find(f => f.id === project.activeFloorId);
  if (!project || !floor || !changes.size) return;
  for (const wall of floor.walls) {
    const updates = changes.get(wall.id);
    if (updates) Object.assign(wall, updates);
  }
  rehostWallItems(floor);
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

/** Resize joined corners atomically. Openings keep their normalized wall positions. */
export function resizeWallLength(id: string, length: number, fixed: WallEndpoint = 'start'): string | null {
  const floor = get(activeFloor);
  if (!floor) return 'Select a floor first.';
  // A wall with a length dimension changes through that dimension.
  const dimension = floor.constraints?.find(c => c.kind === 'length' && c.wallId === id && !c.driven);
  if (dimension?.kind === 'length') {
    const wall = floor.walls.find(w => w.id === id);
    if (!wall || !Number.isFinite(length)) return 'Enter a length.';
    const value = dimension.side === 0 ? length : dimension.value + length - Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    return updateConstraintValue(dimension.id, value, fixed);
  }
  let changes: Map<string, Partial<Wall>>;
  try { changes = settleWallChanges(floor, planWallResize(floor.walls, id, length, fixed)); }
  catch (error) { return error instanceof Error ? error.message : 'The wall could not be resized.'; }
  if (!changes.size) return null;
  applyWallChanges(changes, 'Resized connected wall', `wall-length:${id}:${fixed}`);
  return null;
}

function applyWallChanges(changes: Map<string, Partial<Wall>>, description: string, coalesceKey?: string) {
  mutate(f => {
    for (const wall of f.walls) {
      const updates = changes.get(wall.id);
      if (updates) Object.assign(wall, updates);
    }
  }, description, coalesceKey);
}

const withWallChanges = (walls: Wall[], changes: Map<string, Partial<Wall>>) => walls.map(w => changes.has(w.id) ? { ...w, ...changes.get(w.id) } : w);

/**
 * Re-solve the floor's constraints around planned wall changes: the endpoints the edit
 * placed stay put and everything else moves as little as possible. Throws with a
 * user-facing message when the constraints can't accept the edit. Unconstrained floors
 * pass through unchanged.
 */
function settleWallChanges(floor: Floor, changes: Map<string, Partial<Wall>>, walls: Wall[] = floor.walls): Map<string, Partial<Wall>> {
  if (!floor.constraints?.some(isActiveConstraint) || !changes.size) return changes;
  const pinned = new Map<string, Point>();
  for (const [id, updates] of changes) {
    if (updates.start) pinned.set(endpointKey(id, 'start'), updates.start);
    if (updates.end) pinned.set(endpointKey(id, 'end'), updates.end);
  }
  const solved = planConstraintSolve(withWallChanges(walls, changes), floor.constraints, { pinned });
  const merged = new Map(changes);
  for (const [id, updates] of solved) merged.set(id, { ...merged.get(id), ...updates });
  return merged;
}

export function setWallAngle(id: string, angle: number, fixed: WallEndpoint = 'start'): string | null {
  const floor = get(activeFloor);
  if (!floor) return 'Select a floor first.';
  let changes: Map<string, Partial<Wall>>;
  try { changes = settleWallChanges(floor, planWallAngle(floor.walls, id, angle, fixed)); }
  catch (error) { return error instanceof Error ? error.message : 'The wall could not be rotated.'; }
  if (changes.size) applyWallChanges(changes, 'Rotated wall', `wall-angle:${id}:${fixed}`);
  return null;
}

/** Returns the number of walls moved, or an error message. */
export function straightenWalls(tolerance?: number): number | string {
  const floor = get(activeFloor);
  if (!floor) return 'Select a floor first.';
  let changes: Map<string, Partial<Wall>>;
  try { changes = settleWallChanges(floor, planStraightenWalls(floor.walls, tolerance)); }
  catch (error) { return error instanceof Error ? error.message : 'The walls could not be straightened.'; }
  if (changes.size) applyWallChanges(changes, 'Straightened walls');
  return changes.size;
}

// --- Constraints ---

/** A short message about the plan (e.g. a dimension that became driven), shown by the canvas. */
export const planNotice = writable<{ text: string; tone: 'info' | 'error'; at: number } | null>(null);
export function showPlanNotice(text: string, tone: 'info' | 'error' = 'info') {
  planNotice.set({ text, tone, at: Date.now() });
}

export type { NewConstraint } from '$lib/models/types';
export type AddConstraintResult = { id: string; driven: boolean } | { error: string };

/**
 * Add a dimension or geometric constraint. A dimension that would over-constrain the
 * plan is added as a driven (reference) dimension instead; an over-constraining
 * geometric constraint is refused.
 */
export function addConstraint(input: NewConstraint): AddConstraintResult {
  const floor = get(activeFloor);
  if (!floor) return { error: 'Select a floor first.' };
  const id = uid();
  let constraint = { ...input, id } as Constraint;
  const check = checkNewConstraint(floor.walls, floor.constraints ?? [], constraint);
  if (check.status === 'unsatisfiable') return { error: check.message };
  let changes = check.status === 'ok' ? check.changes : new Map<string, Partial<Wall>>();
  if (check.status === 'overConstrained') {
    if (!isDimension(constraint)) return { error: 'This would over-constrain the plan: the walls are already held this way.' };
    constraint = { ...constraint, driven: true };
    changes = new Map();
  }
  mutate(f => {
    for (const wall of f.walls) { const updates = changes.get(wall.id); if (updates) Object.assign(wall, updates); }
    (f.constraints ??= []).push(constraint);
  }, isDimension(constraint) ? 'Added dimension' : 'Added constraint');
  return { id, driven: !!constraint.driven };
}

/** Change a dimension's value and move the plan to match. Returns an error message, or null. */
export function updateConstraintValue(id: string, value: number, fixedEnd: WallEndpoint = 'start'): string | null {
  const floor = get(activeFloor);
  const constraint = floor?.constraints?.find(c => c.id === id);
  if (!floor || !constraint || !isDimension(constraint)) return 'Select a dimension to change.';
  if (Object.is(constraint.value, value)) return null;
  let changes: Map<string, Partial<Wall>>;
  try { changes = planConstraintValue(floor.walls, floor.constraints!, id, value, fixedEnd); }
  catch (error) { return error instanceof Error ? error.message : 'The dimension could not be changed.'; }
  mutate(f => {
    for (const wall of f.walls) { const updates = changes.get(wall.id); if (updates) Object.assign(wall, updates); }
    const c = f.constraints?.find(c => c.id === id);
    if (c && isDimension(c)) c.value = value;
  }, 'Changed dimension', `constraint-value:${id}`);
  return null;
}

/** Current measured value of a dimension on the active floor (cm or degrees). */
export function measuredConstraintValue(c: Constraint, walls = get(activeFloor)?.walls ?? []): number | null {
  return measureConstraint(c, buildSketch(walls));
}

/** Switch a dimension between driving (moves the plan) and driven (reports only). */
export function setConstraintDriven(id: string, driven: boolean): string | null {
  const floor = get(activeFloor);
  const constraint = floor?.constraints?.find(c => c.id === id);
  if (!floor || !constraint || !isDimension(constraint)) return 'Select a dimension.';
  if (!!constraint.driven === driven) return null;
  const value = measuredConstraintValue(constraint, floor.walls) ?? constraint.value;
  if (!driven) {
    const others = floor.constraints!.filter(c => c.id !== id);
    const check = checkNewConstraint(floor.walls, others, { ...constraint, driven: false, value } as Constraint);
    if (check.status === 'overConstrained') return 'This dimension would over-constrain the plan. Remove another constraint first.';
    if (check.status === 'unsatisfiable') return check.message;
  }
  mutate(f => {
    const c = f.constraints?.find(c => c.id === id);
    if (c && isDimension(c)) { c.value = value; if (driven) c.driven = true; else delete c.driven; }
  }, 'Edited constraint');
  return null;
}

/** Edit how a dimension measures (faces, axis) or where its line sits, without moving walls. */
export function updateConstraint(id: string, updates: Partial<{ side: 0 | 1 | -1; sideA: 0 | 1 | -1; sideB: 0 | 1 | -1; axis: 'aligned' | 'x' | 'y'; offset: number }>) {
  const floor = get(activeFloor);
  const constraint = floor?.constraints?.find(c => c.id === id);
  if (!floor || !constraint) return;
  const next = { ...constraint, ...updates } as Constraint;
  if (isDimension(next) && Object.keys(updates).some(key => key !== 'offset')) {
    const value = measuredConstraintValue(next, floor.walls);
    if (value !== null) next.value = value;
  }
  mutate(f => {
    const index = f.constraints?.findIndex(c => c.id === id) ?? -1;
    if (index >= 0) f.constraints![index] = next;
  }, 'Edited constraint', coalesceKeyFor('constraint', id, updates));
}

export function removeConstraint(id: string) {
  removeElement(id);
}

export type GeometricConstraintKind = 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'fix';
/** Constrain tool waiting for walls (or a corner, for Fix) to be clicked; null when inactive. */
export const constraintPickMode = writable<GeometricConstraintKind | null>(null);
selectedTool.subscribe(() => constraintPickMode.set(null));

/** Add a geometric constraint to walls (and a corner, for Fix), holding them as they are now. */
export function addGeometricConstraint(kind: GeometricConstraintKind, wallIds: string[], corner?: CornerRef): AddConstraintResult {
  const floor = get(activeFloor);
  if (!floor) return { error: 'Select a floor first.' };
  const walls = wallIds.map(id => floor.walls.find(w => w.id === id));
  if (walls.some(w => !w)) return { error: 'Pick walls on this floor.' };
  if (walls.some(w => w!.curvePoint)) return { error: 'Curved walls can’t be constrained.' };
  if (kind === 'fix') {
    if (corner) {
      const wall = floor.walls.find(w => w.id === corner.wallId);
      return wall ? addConstraint({ kind, target: corner, at: [{ ...wall[corner.end] }] }) : { error: 'Pick a corner on this floor.' };
    }
    return addConstraint({ kind, target: { wallId: walls[0]!.id }, at: [{ ...walls[0]!.start }, { ...walls[0]!.end }] });
  }
  if (kind === 'horizontal' || kind === 'vertical') return addConstraint({ kind, wallId: walls[0]!.id });
  if (walls.length < 2 || walls[0]!.id === walls[1]!.id) return { error: 'Pick two different walls.' };
  return addConstraint({ kind, wallA: walls[0]!.id, wallB: walls[1]!.id });
}

/** The geometric constraint of `kind` on exactly this wall, if any (H, V or a whole-wall fix). */
export function wallConstraint(floor: Floor | null | undefined, wallId: string, kind: 'horizontal' | 'vertical' | 'fix'): Constraint | undefined {
  return floor?.constraints?.find(c => c.kind === kind && (c.kind === 'fix' ? !('end' in c.target) && c.target.wallId === wallId : 'wallId' in c && c.wallId === wallId));
}

function unchangedFields(current: object, updates: object): boolean {
  return Object.entries(updates).every(([key, value]) => Object.is((current as Record<string, unknown>)[key], value));
}

export function updateWall(id: string, updates: Partial<Wall>) {
  const wall = get(activeFloor)?.walls.find(w => w.id === id);
  if (!wall) return;
  const unchanged = Object.entries(updates).every(([key, value]) => {
    if (key === 'start' || key === 'end' || key === 'curvePoint') {
      const point = updates[key], previous = wall[key];
      if (point && previous) return point.x === previous.x && point.y === previous.y;
    }
    return Object.is(wall[key as keyof Wall], value);
  });
  const flattening = updates.height !== undefined && updates.startHeight === undefined && updates.endHeight === undefined
    && (getWallStartHeight(wall) !== updates.height || getWallEndHeight(wall) !== updates.height);
  if (unchanged && !flattening) return;
  if ('thickness' in updates && !validPositiveDimension(updates.thickness)) return;
  if (['start', 'end'].some(key => key in updates && !finitePoint(updates[key as 'start' | 'end']))) return;
  if (updates.curvePoint !== undefined && !finitePoint(updates.curvePoint)) return;
  if (['height', 'startHeight', 'endHeight'].some(key => key in updates && !validWallHeight(updates[key as keyof Wall]))) return;
  // Constraints: curving a constrained wall releases it; geometry and thickness edits re-solve.
  const floor = get(activeFloor)!;
  let settled = new Map<string, Partial<Wall>>(), releaseConstraints = false;
  if (floor.constraints?.length) {
    if (updates.curvePoint && !wall.curvePoint && floor.constraints.some(c => constraintMentionsWall(c, id))) releaseConstraints = true;
    else if (['start', 'end', 'thickness', 'curvePoint'].some(key => key in updates)) {
      try { settled = settleWallChanges(floor, new Map([[id, updates]])); }
      catch (error) { showPlanNotice(error instanceof Error ? error.message : 'The constraints can’t accept this change.', 'error'); return; }
    }
  }
  mutate((f) => {
    if (releaseConstraints) {
      f.constraints = f.constraints?.filter(c => !constraintMentionsWall(c, id));
      showPlanNotice('Curved walls can’t be constrained, so this wall’s constraints were removed.');
    }
    for (const other of f.walls) if (other.id !== id && settled.has(other.id)) Object.assign(other, settled.get(other.id));
    const w = f.walls.find((w) => w.id === id);
    if (w) {
      Object.assign(w, updates);
      if (settled.has(id)) Object.assign(w, settled.get(id));
      if (updates.height !== undefined && updates.startHeight === undefined && updates.endHeight === undefined) {
        w.startHeight = updates.height;
        w.endHeight = updates.height;
      } else {
        const startH = getWallStartHeight(w);
        const endH = getWallEndHeight(w);
        w.startHeight = startH;
        w.endHeight = endH;
        w.height = Math.max(startH, endH);
      }
    }
  }, undefined, coalesceKeyFor('wall', id, updates));
}

export function reverseWall(id: string) {
  mutate((f) => {
    const w = f.walls.find((w) => w.id === id);
    if (!w) return;
    const oldStart = { ...w.start };
    w.start = { ...w.end };
    w.end = oldStart;

    const startH = getWallStartHeight(w);
    const endH = getWallEndHeight(w);
    w.startHeight = endH;
    w.endHeight = startH;
    w.height = Math.max(startH, endH);
    [w.interiorColor, w.exteriorColor] = [w.exteriorColor, w.interiorColor];
    [w.interiorTexture, w.exteriorTexture] = [w.exteriorTexture, w.interiorTexture];

    for (const d of f.doors) {
      if (d.wallId === id) {
        d.position = 1 - d.position;
        d.swingDirection = d.swingDirection === 'left' ? 'right' : 'left';
        d.flipSide = !d.flipSide;
      }
    }
    for (const win of f.windows) {
      if (win.wallId === id) {
        win.position = 1 - win.position;
      }
    }
    reverseHostedItems(f.furniture, id);
    if (f.constraints) f.constraints = reverseWallConstraints(f.constraints, id);
  }, 'Reversed wall direction');
}

export function updateDoor(id: string, updates: Partial<Door>) {
  const door = get(activeFloor)?.doors.find(d => d.id === id);
  if (!door || unchangedFields(door, updates)) return;
  if (['width', 'height'].some(key => key in updates && !validPositiveDimension(updates[key as 'width' | 'height']))) return;
  if ('position' in updates && !validOpeningPosition(updates.position)) return;
  mutate((f) => {
    const d = f.doors.find((d) => d.id === id);
    if (d) Object.assign(d, updates);
  }, undefined, coalesceKeyFor('door', id, updates));
}

export function updateWindow(id: string, updates: Partial<Win>) {
  const window = get(activeFloor)?.windows.find(w => w.id === id);
  if (!window || unchangedFields(window, updates)) return;
  if (['width', 'height'].some(key => key in updates && !validPositiveDimension(updates[key as 'width' | 'height']))) return;
  if ('sillHeight' in updates && !validWallHeight(updates.sillHeight)) return;
  if ('position' in updates && !validOpeningPosition(updates.position)) return;
  mutate((f) => {
    const w = f.windows.find((w) => w.id === id);
    if (w) Object.assign(w, updates);
  }, undefined, coalesceKeyFor('window', id, updates));
}

export function updateFurniture(id: string, updates: Partial<FurnitureItem>) {
  const item = get(activeFloor)?.furniture.find(item => item.id === id);
  if (!item) return;
  if (Object.keys(updates).every(key => {
    if (key === 'position' && updates.position) {
      return item.position.x === updates.position.x && item.position.y === updates.position.y;
    }
    if (key === 'scale' && updates.scale) {
      return item.scale.x === updates.scale.x && item.scale.y === updates.scale.y && item.scale.z === updates.scale.z;
    }
    return item[key as keyof FurnitureItem] === updates[key as keyof FurnitureItem];
  })) return;
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (!fi) return;
    Object.assign(fi, updates);
    // A ceiling item's height follows the ceiling; it never keeps a stored elevation.
    if (furnitureMount(fi) === 'ceiling') delete fi.elevation;
  }, undefined, coalesceKeyFor('furniture', id, updates));
}

/** Commit prepared metadata/photo edits only to the project that was read. */
export function commitItemDetails(expected: Project, next: Project, description: string, coalesceKey?: string) {
  if (get(currentProject) !== expected || next.id !== expected.id) throw new Error('The project changed while the photo was being prepared. Select the photo again.');
  const valid = readProject(next);
  if (JSON.stringify(expected) === JSON.stringify(valid)) return;
  snapshot(description, coalesceKey);
  valid.updatedAt = new Date();
  currentProject.set(valid);
}

export function updateItemDetails(target: DetailTarget, patch: ItemDetails) {
  const project = get(currentProject);
  if (!project || project.activeFloorId !== target.floorId) return;
  const next = readProject(project), floor = next.floors.find(f => f.id === target.floorId)!;
  if (target.kind === 'rooms' && !detailItem(next, target)) {
    const detected = get(detectedRoomsStore).find(r => r.id === target.id);
    if (detected) floor.rooms.push(structuredClone(detected));
  }
  const item = detailItem(next, target);
  if (!item) return;
  const details = { ...itemDetails(project, target), ...patch };
  validateItemDetails(details, target.kind);
  item.details = details;
  commitItemDetails(project, next, 'Changed item details', coalesceKeyFor(`details:${target.floorId}:${target.kind}`, target.id, { ...patch }));
}

export function updateRoom(id: string, updates: Partial<{ name: string; floorTexture: string; floorOpening: boolean; color: string; roomType: import('$lib/models/types').RoomCategory; labelOffset: import('$lib/models/types').Point | undefined }>) {
  const floor = get(activeFloor);
  if (!floor || Object.keys(updates).length === 0) return;
  const saved = floor.rooms.find(room => room.id === id);
  if (!saved && !get(detectedRoomsStore).some(room => room.id === id)) return;
  if (saved && Object.entries(updates).every(([key, value]) => {
    if (key === 'labelOffset' && value && typeof value === 'object' && saved.labelOffset) {
      return value.x === saved.labelOffset.x && value.y === saved.labelOffset.y;
    }
    return saved[key as keyof typeof updates] === value;
  })) return;
  mutate((f) => {
    let r = f.rooms.find((r) => r.id === id);
    if (r) {
      Object.assign(r, updates);
    } else {
      // Room not in floor.rooms yet (dynamically detected) — add it so changes persist on save
      const detected = get(detectedRoomsStore).find((r) => r.id === id);
      if (detected) {
        const newRoom = { ...detected, ...updates };
        f.rooms.push(newRoom);
      }
    }
  }, undefined, coalesceKeyFor('room', id, updates));
}

/**
 * Set a room's ceiling height in cm, or clear the override with `undefined` (spec §4.4).
 * A detected room is saved into `floor.rooms` first, since only saved rooms keep their
 * id. The value goes into `floor.roomCeilingHeights` and is mirrored into the room's
 * `details.ceilingHeight` for the native package; clearing also clears that mirror
 * (null, which removes the native value). One undo step; rapid edits coalesce.
 */
export function setRoomCeilingHeight(roomId: string, height: number | undefined) {
  const floor = get(activeFloor);
  if (!floor || (height !== undefined && !validCeilingHeight(height))) return;
  const detected = floor.rooms.some(room => room.id === roomId) ? undefined : get(detectedRoomsStore).find(room => room.id === roomId);
  if (!detected && !floor.rooms.some(room => room.id === roomId)) return;
  mutate((f) => {
    let room = f.rooms.find(room => room.id === roomId);
    if (!room) {
      if (height === undefined) return;
      room = structuredClone(detected!);
      f.rooms.push(room);
    }
    if (height === undefined) {
      if (f.roomCeilingHeights) {
        delete f.roomCeilingHeights[roomId];
        if (Object.keys(f.roomCeilingHeights).length === 0) delete f.roomCeilingHeights;
      }
      if (room.details?.ceilingHeight != null) room.details = { ...room.details, ceilingHeight: null };
    } else {
      f.roomCeilingHeights = { ...f.roomCeilingHeights, [roomId]: height };
      room.details = { ...room.details, ceilingHeight: height };
    }
  }, 'Changed ceiling height', coalesceKeyFor('ceiling', roomId, { height }));
}

/**
 * What a newly added storey starts from.
 * - `outer`  — the envelope of the current floor, so the storey sits on the
 *              same footprint and its exterior lines up with the floor below.
 * - `copy`   — every wall of the current floor, partitions included.
 * - `empty`  — a blank floor.
 */
export type FloorSeed = 'empty' | 'outer' | 'copy';

export function addFloor(name?: string, seed: FloorSeed = 'outer') {
  const p = get(currentProject);
  if (!p) return;
  snapshot('Added floor');
  // Levels drive the 3D stacking order, so derive from the highest existing
  // level rather than the floor count — removing a middle floor would
  // otherwise hand the next storey a level that is already taken.
  const level = nextFloorLevel(p.floors);
  const floor = createDefaultFloor(level);
  // Continue the top floor's adjusted elevation, retaining any skipped levels.
  const top = floorElevations(p.floors).at(-1);
  if (top) {
    const elevation = top.elevation + (level - top.level) * DEFAULT_FLOOR_SPACING;
    if (elevation !== level * DEFAULT_FLOOR_SPACING && validFloorElevation(elevation)) floor.elevation = elevation;
  }
  if (name !== undefined) floor.name = name;
  if (seed !== 'empty') {
    const cur = p.floors.find(f => f.id === p.activeFloorId);
    if (cur) {
      // Walls only — doors and windows belong to the storey they were placed
      // on (a front door does not repeat upstairs) and carry wall ids that no
      // longer resolve once the walls are re-issued.
      const source = seed === 'outer' ? getOuterWalls(cur.walls) : cur.walls;
      floor.walls = source.map(w => ({ ...w, id: uid(), start: { ...w.start }, end: { ...w.end },
        ...(w.curvePoint ? { curvePoint: { ...w.curvePoint } } : {}) }));
    }
  }
  clearFloorContext();
  p.floors.push(floor);
  p.activeFloorId = floor.id;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function removeFloor(id: string) {
  const p = get(currentProject);
  if (!p || p.floors.length <= 1 || !p.floors.some(f => f.id === id)) return;
  snapshot('Removed floor');
  if (p.activeFloorId === id) clearFloorContext();
  p.floors = p.floors.filter(f => f.id !== id);
  if (p.activeFloorId === id) {
    p.activeFloorId = p.floors[0].id;
  }
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function setActiveFloor(floorId: string) {
  const p = get(currentProject);
  if (!p) return;
  if (p.activeFloorId !== floorId && p.floors.some((f) => f.id === floorId)) {
    clearFloorContext();
    p.activeFloorId = floorId;
    currentProject.set({ ...p });
  }
}

// ── Plan alternatives ────────────────────────────────────────────────

/** Default names for new alternatives from their code, e.g. "Option B" (and for branches, e.g. "Copy of A"); the UI passes its language's version. */
export type AlternativeNamer = (letter: string) => string;
const defaultAlternativeName: AlternativeNamer = letter => `Option ${letter}`;

/**
 * Keep the current plan and continue working in a copy of it. `kind` 'new' gives the
 * copy the next letter code (C), 'branch' continues the active one's line (A → A1).
 * Codes are part of the snapshot, so undo restores them.
 */
export function createAlternative(options: { name?: string; thumbnail?: string; nameFor?: AlternativeNamer; copyNameFor?: AlternativeNamer; kind?: 'branch' | 'new' } = {}) {
  const p = get(currentProject);
  if (!p) return;
  snapshot('Created alternative');
  branchAlternative(p, { id: uid(), originalId: uid(), now: new Date(), thumbnail: options.thumbnail,
    nameFor: options.nameFor ?? defaultAlternativeName, copyNameFor: options.copyNameFor, name: options.name, kind: options.kind ?? 'new' });
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Make another alternative the plan being edited. The thumbnail pictures the one being left. */
export function switchPlanAlternative(id: string, thumbnail?: string) {
  const p = get(currentProject);
  if (!p?.alternatives?.some(alt => alt.id === id) || p.activeAlternativeId === id) return;
  snapshot('Switched alternative');
  clearFloorContext();
  switchAlternative(p, id, new Date(), thumbnail);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function renamePlanAlternative(id: string, name: string) {
  const p = get(currentProject);
  const alt = p?.alternatives?.find(alt => alt.id === id);
  if (!p || !alt || !name.trim() || alt.name === name.trim()) return;
  snapshot('Renamed alternative');
  renameAlternative(p, id, name);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function deletePlanAlternative(id: string) {
  const p = get(currentProject);
  if (!p?.alternatives || p.alternatives.length < 2 || !p.alternatives.some(alt => alt.id === id)) return;
  snapshot('Deleted alternative');
  if (id === p.activeAlternativeId) clearFloorContext();
  deleteAlternative(p, id, new Date());
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** An omitted elevation restores the legacy level-based default. */
export function updateFloorElevation(floorId: string, elevation?: number) {
  const p = get(currentProject);
  if (!p || (elevation !== undefined && !validFloorElevation(elevation))) return;
  const entry = floorElevations(p.floors).find(entry => entry.floor.id === floorId);
  if (!entry || (elevation === undefined ? entry.floor.elevation === undefined : entry.elevation === elevation)) return;
  snapshot('Changed floor elevation', `floor-elevation:${floorId}`);
  if (elevation === undefined) delete entry.floor.elevation;
  else entry.floor.elevation = elevation;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Omission restores the legacy 5 cm slab. */
export function updateFloorSlabThickness(floorId: string, thickness?: number) {
  const p = get(currentProject);
  if (!p || (thickness !== undefined && (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0))) return;
  const floor = p.floors.find(f => f.id === floorId);
  if (!floor || (thickness === undefined ? floor.slabThickness === undefined : (floor.slabThickness ?? 5) === thickness)) return;
  snapshot('Changed slab thickness', `floor-slab:${floorId}`);
  if (thickness === undefined) delete floor.slabThickness;
  else floor.slabThickness = thickness;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** Every history entry restores the whole project, so a rename must be a step of its own. */
export function updateProjectName(name: string) {
  const p = get(currentProject);
  if (!p || p.name === name) return;
  snapshot('Renamed project', 'project-name');
  p.name = name;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/** The Settings dialog edits per keystroke; rapid edits share one step. */
export function updateProjectDescription(description: string) {
  const p = get(currentProject);
  if (!p || (p.description ?? '') === description) return;
  snapshot('Changed project description', 'project-description');
  p.description = description;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

export function loadProject(project: Project) {
  previewBaseline = null;
  previewActive.set(false);
  undoStack.length = 0;
  redoStack.length = 0;
  undoGroupDepth = 0;
  undoGroupSnapshot = null;
  undoGroupSelection = undefined;
  _nextDescription = '';
  resetCoalescing();
  clearFloorContext();
  openSectionId.set(null);
  // Projects not read through readProject (e.g. built in memory) may predate version codes.
  ensureAlternativeCodes(project);
  currentProject.set(project);
  syncHistoryStore();
}

/** How many elements a merge placed and their ids per floor, for selecting them afterwards. */
export type RoomPlanMergeResult = { placed: number; added: AddedContent[] };

/** Commit a pure merge as one history entry. Nothing changes while no project is open. */
function applyRoomPlanMerge(floors: Floor[], description: string, gapCm?: number, interchange?: InterchangeState): RoomPlanMergeResult {
  const p = get(currentProject);
  if (!p) return { placed: 0, added: [] };
  const { project, placed, added } = mergeRoomPlanFloors(p, floors, gapCm, interchange);
  snapshot(description);
  project.updatedAt = new Date();
  currentProject.set(project);
  return { placed, added };
}

/** Add one floor's content beside the active floor's, whatever level it was scanned as. */
export function importFloorIntoCurrentProject(floor: Floor, gapCm?: number): RoomPlanMergeResult {
  const p = get(currentProject);
  if (!p) return { placed: 0, added: [] };
  const entries = orderedFloors(p.floors);
  const active = entries.find(entry => entry.floor.id === p.activeFloorId) ?? entries[0];
  if (!active) return { placed: 0, added: [] };
  return applyRoomPlanMerge([{ ...floor, level: active.level }], 'Imported floor', gapCm);
}

/** Stitch RoomPlan storeys into the open plan by level, as a single undo step; `interchange` carries the file's sibling data. */
export function addRoomPlanFloorsToProject(floors: Floor[], gapCm?: number, interchange?: InterchangeState): RoomPlanMergeResult {
  return applyRoomPlanMerge(floors, 'Added RoomPlan scan', gapCm, interchange);
}

/** Show `floorId` with exactly `ids` selected and a clean editing context (select tool, nothing being placed). */
export function selectImportedElements(floorId: string, ids: string[]) {
  const p = get(currentProject);
  if (!p || !p.floors.some(f => f.id === floorId)) return;
  if (p.activeFloorId !== floorId) setActiveFloor(floorId); else clearFloorContext();
  selectedElementIds.set(new Set(ids.length > 1 ? ids : []));
  selectedElementId.set(ids.length === 1 ? ids[0] : null);
}

/** Door-to-door scan alignment: the door picked first, until a second door is clicked or the mode is cancelled. */
export const doorJoinMode = writable<{ firstDoorId: string } | null>(null);

/**
 * Carry the wall group holding `movingDoorId` onto the far side of `targetDoorId`'s wall
 * (see utils/scanAlignment) as one history entry, then select what moved, which also ends
 * the pick mode. False, with no history entry and the mode untouched, when the doors cannot
 * be joined.
 */
export function joinScanDoors(movingDoorId: string, targetDoorId: string, gapCm?: number): boolean {
  const p = get(currentProject);
  const floor = p?.floors.find(f => f.id === p.activeFloorId);
  const joined = floor ? doorJoin(floor, movingDoorId, targetDoorId, gapCm) : null;
  if (!joined) return false;
  mutate(f => { Object.assign(f, joined.floor); }, 'Joined doors');
  selectImportedElements(floor!.id, selectableContentIds(joined.floor, joined.movedIds));
  return true;
}

export const selectedRoomId = writable<string | null>(null);
/** Detected rooms (synced from canvas room detection) */
export const detectedRoomsStore = writable<import('$lib/models/types').Room[]>([]);
/** catalogId currently being placed (null = not placing) */
export const placingFurnitureId = writable<string | null>(null);
/** Rotation angle for furniture being placed */
export const placingRotation = writable<number>(0);
/** Door subtype currently selected for placement */
export const placingDoorType = writable<Door['type']>('single');
/** Window subtype currently selected for placement */
export const placingWindowType = writable<import('$lib/models/types').Window['type']>('standard');

/** Duplicate a door onto the same wall */
export function duplicateDoor(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const d = floor.doors.find(d => d.id === id);
  if (!d) return null;
  const wall = floor.walls.find(w => w.id === d.wallId);
  if (!wall) return null;
  const newPos = shiftedOpeningPosition(wall, d);
  const newId = uid();
  mutate(f => {
    f.doors.push({ ...d, id: newId, position: newPos });
  });
  return newId;
}

/** Duplicate a window onto the same wall */
export function duplicateWindow(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.windows.find(w => w.id === id);
  if (!w) return null;
  const wall = floor.walls.find(candidate => candidate.id === w.wallId);
  if (!wall) return null;
  const newPos = shiftedOpeningPosition(wall, w);
  const newId = uid();
  mutate(f => {
    f.windows.push({ ...w, id: newId, position: newPos });
  });
  return newId;
}

/** Duplicate the full canvas selection in one history action. */
export function duplicateSelection(ids: ReadonlySet<string>): string[] {
  const floor = get(activeFloor);
  if (!floor || !ids.size) return [];
  const copy = structuredClone(floor);
  const newIds = duplicatePlanSelection(copy, ids, uid);
  if (newIds.length) mutate(f => Object.assign(f, copy), 'Duplicated selection');
  return newIds;
}

/** Paste a captured selection, with one history entry and no dependence on source IDs. */
export function pasteSelection(source: Floor, ids: ReadonlySet<string>, step = 1): string[] {
  const floor = get(activeFloor);
  if (!floor) return [];
  const copy = structuredClone(floor);
  const newIds = pastePlanSelection(source, copy, ids, uid, step);
  if (newIds.length) mutate(f => Object.assign(f, copy), 'Pasted selection');
  return newIds;
}

/** Duplicate furniture */
export function duplicateFurniture(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const fi = floor.furniture.find(fi => fi.id === id);
  if (!fi) return null;
  const newId = uid();
  mutate(f => {
    f.furniture.push({ ...fi, id: newId, position: { x: fi.position.x + 30, y: fi.position.y + 30 } });
  });
  return newId;
}

/** Move a wall parallel to itself (both endpoints shift by the same perpendicular offset) without undo snapshot (for dragging) */
export function moveWallParallel(id: string, dx: number, dy: number) {
  if (dx === 0 && dy === 0) return;
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return;
  const w = floor.walls.find((w) => w.id === id);
  if (w) {
    w.start = { x: w.start.x + dx, y: w.start.y + dy };
    w.end = { x: w.end.x + dx, y: w.end.y + dy };
    if (w.curvePoint) {
      w.curvePoint = { x: w.curvePoint.x + dx, y: w.curvePoint.y + dy };
    }
    rehostWallItems(floor);
    p.updatedAt = new Date();
    currentProject.set({ ...p });
  }
}

/** An opening belongs to one wall, so a split cannot cross its interior. */
export function wallSplitIntersectsOpening(id: string, t: number): boolean {
  const p = get(currentProject);
  const floor = p?.floors.find(f => f.id === p.activeFloorId);
  const wall = floor?.walls.find(w => w.id === id);
  if (!floor || !wall || !Number.isFinite(t) || t <= 0 || t >= 1) return false;
  const geometry = splitWallGeometry(wall, t);
  const first = wallPathProfile({ ...wall, ...geometry.first });
  const second = wallPathProfile({ ...wall, ...geometry.second });
  return [...floor.doors, ...floor.windows].some(opening => {
    if (opening.wallId !== id) return false;
    const clearance = opening.position <= t
      ? first.length - first.distanceAt(opening.position / t)
      : second.distanceAt((opening.position - t) / (1-t));
    return clearance < opening.width / 2 - 1e-7;
  });
}

/** Split a wall into two segments at a given parameter t (0-1) */
export function splitWall(id: string, t: number): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find((f) => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.walls.find((w) => w.id === id);
  if (!w) return null;
  if (!Number.isFinite(t) || t <= 0.001 || t >= 0.999) return null; // prevent division by zero at extremes
  if (wallSplitIntersectsOpening(id, t)) return null;
  snapshot('Split wall');
  const geometry = splitWallGeometry(w, t);
  const midPt = geometry.first.end;
  const startH = getWallStartHeight(w);
  const endH = getWallEndHeight(w);
  const midH = getWallHeightAt(w, t);
  const newId = uid();
  const roomReferences = splitWallRoomReferences(floor, w, t, newId);
  // New wall from midpoint to original end
  floor.walls.push({
    ...w,
    ...geometry.second,
    id: newId,
    start: { ...midPt },
    end: { ...w.end },
    thickness: w.thickness,
    height: Math.max(midH, endH),
    startHeight: midH,
    endHeight: endH,
    color: w.color,
    interiorColor: w.interiorColor,
    interiorTexture: w.interiorTexture,
    exteriorColor: w.exteriorColor,
    exteriorTexture: w.exteriorTexture,
  });
  // Shorten original wall to midpoint
  for (const room of floor.rooms) {
    const references = roomReferences.get(room.id);
    if (references) room.walls = references;
  }
  for (const group of floor.groups ?? []) {
    if (group.elementIds.includes(id)) {
      group.elementIds = group.elementIds.flatMap(member => member === id ? [id, newId] : [member]);
    }
  }
  if (floor.constraints?.length) {
    const split = splitWallConstraints(floor.constraints, id, newId, midPt, uid);
    floor.constraints = split.constraints;
    if (split.dropped) showPlanNotice(`Removed ${split.dropped} face dimension${split.dropped === 1 ? '' : 's'} on the split wall.`);
  }
  w.end = { ...midPt };
  if (geometry.first.curvePoint) w.curvePoint = geometry.first.curvePoint;
  w.startHeight = startH;
  w.endHeight = midH;
  w.height = Math.max(startH, midH);
  // Move doors/windows on the original wall: adjust positions
  for (const d of floor.doors) {
    if (d.wallId === id) {
      if (d.position > t) {
        d.wallId = newId;
        d.position = (d.position - t) / (1 - t);
      } else {
        d.position = d.position / t;
      }
    }
  }
  for (const win of floor.windows) {
    if (win.wallId === id) {
      if (win.position > t) {
        win.wallId = newId;
        win.position = (win.position - t) / (1 - t);
      } else {
        win.position = win.position / t;
      }
    }
  }
  splitHostedItems(floor.furniture, id, newId, t);
  rehostWallItems(floor);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
  return newId;
}

/** Duplicate a wall */
export function duplicateWall(id: string): string | null {
  const p = get(currentProject);
  if (!p) return null;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor) return null;
  const w = floor.walls.find(w => w.id === id);
  if (!w) return null;
  const newId = uid();
  mutate(f => {
    f.walls.push({ ...w, id: newId, start: { x: w.start.x + 30, y: w.start.y + 30 }, end: { x: w.end.x + 30, y: w.end.y + 30 } });
  });
  return newId;
}

// --- Guide Lines ---
export function addGuide(orientation: 'horizontal' | 'vertical', position: number): string {
  const id = uid();
  mutate(f => {
    if (!f.guides) f.guides = [];
    f.guides.push({ id, orientation, position });
  });
  return id;
}

export function moveGuide(id: string, position: number) {
  mutate(f => {
    if (!f.guides) return;
    const g = f.guides.find(g => g.id === id);
    if (g) g.position = position;
  });
}

export function removeGuide(id: string) {
  mutate(f => {
    if (!f.guides) return;
    f.guides = f.guides.filter(g => g.id !== id);
  });
}

// --- Measurements ---
export function addMeasurement(x1: number, y1: number, x2: number, y2: number): string {
  const id = uid();
  mutate(f => {
    if (!f.measurements) f.measurements = [];
    f.measurements.push({ id, x1, y1, x2, y2 });
  });
  return id;
}

export function updateMeasurement(id: string, updates: Partial<{ x1: number; y1: number; x2: number; y2: number }>) {
  mutate(f => {
    const item = f.measurements?.find(item => item.id === id);
    if (item) Object.assign(item, updates);
  }, undefined, coalesceKeyFor('measurement', id, updates));
}

export function removeMeasurement(id: string) {
  removeElement(id);
}

// --- Sections (spec §4.8) ---
const validSectionPoint = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Add a section cut from `start` to `end` with the next free code ('A', 'B'…). Returns its id, or '' when the cut is not a line. */
export function addSection(start: Point, end: Point, look: 1 | -1 = 1): string {
  if (!validSectionPoint(start) || !validSectionPoint(end) || samePoint(start, end) || !get(currentProject)) return '';
  const id = uid();
  mutateProject(p => {
    const sections = p.sections ?? [];
    p.sections = [...sections, { id, code: nextSectionCode(sections.map(section => section.code)), start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, look: look === -1 ? -1 : 1 }];
  }, 'Added section');
  return id;
}

/** Change a section's line, direction, code or storeys. Ignored when it would leave a zero-length cut. */
export function updateSection(id: string, patch: Partial<Pick<PlanSection, 'start' | 'end' | 'look' | 'code' | 'floorIds'>>) {
  const keys = Object.keys(patch);
  const moved = keys.every(key => key === 'start' || key === 'end');
  mutateProject(p => {
    const section = p.sections?.find(item => item.id === id);
    if (!section) return;
    const start = patch.start ?? section.start, end = patch.end ?? section.end;
    if (!validSectionPoint(start) || !validSectionPoint(end) || samePoint(start, end)) return;
    if (patch.start) section.start = { x: start.x, y: start.y };
    if (patch.end) section.end = { x: end.x, y: end.y };
    if (patch.look !== undefined) section.look = patch.look === -1 ? -1 : 1;
    if (typeof patch.code === 'string' && patch.code.trim()) section.code = patch.code.trim();
    if ('floorIds' in patch) {
      if (patch.floorIds?.length) section.floorIds = [...patch.floorIds];
      else delete section.floorIds;
    }
  }, moved ? 'Moved section' : 'Edited section', coalesceKeyFor('section', id, patch as Record<string, unknown>));
}

/** Look the other way: the cut stays, its viewing direction turns round. */
export function flipSection(id: string) {
  mutateProject(p => {
    const section = p.sections?.find(item => item.id === id);
    if (section) section.look = section.look === -1 ? 1 : -1;
  }, 'Reversed section');
}

export function removeSection(id: string) {
  if (!get(currentProject)?.sections?.some(section => section.id === id)) return;
  mutateProject(p => {
    p.sections = p.sections!.filter(section => section.id !== id);
    if (!p.sections.length) delete p.sections;
  }, 'Deleted section');
  if (get(openSectionId) === id) openSectionId.set(null);
  if (get(selectedElementId) === id) selectedElementId.set(null);
}

// --- Annotations ---
export function addAnnotation(x1: number, y1: number, x2: number, y2: number, offset = 40, label?: string): string {
  const id = uid();
  mutate(f => {
    if (!f.annotations) f.annotations = [];
    f.annotations.push({ id, x1, y1, x2, y2, offset, label });
  });
  return id;
}

export function removeAnnotation(id: string) {
  removeElement(id);
}

export function updateAnnotation(id: string, updates: Partial<{ x1: number; y1: number; x2: number; y2: number; offset: number; label: string }>) {
  mutate(f => {
    if (!f.annotations) return;
    const a = f.annotations.find(a => a.id === id);
    if (!a) return;
    Object.assign(a, updates);
  }, undefined, coalesceKeyFor('annotation', id, updates));
}

// --- Text Annotations ---
export function addTextAnnotation(x: number, y: number, text: string, fontSize = 16, color = '#1e293b', rotation = 0): string {
  const id = uid();
  mutate(f => {
    if (!f.textAnnotations) f.textAnnotations = [];
    f.textAnnotations.push({ id, x, y, text, fontSize, color, rotation });
  });
  return id;
}

export function removeTextAnnotation(id: string) {
  removeElement(id);
}

export function updateTextAnnotation(id: string, updates: Partial<{ x: number; y: number; text: string; fontSize: number; color: string; rotation: number }>) {
  mutate(f => {
    if (!f.textAnnotations) return;
    const t = f.textAnnotations.find(t => t.id === id);
    if (!t) return;
    Object.assign(t, updates);
  }, undefined, coalesceKeyFor('textAnnotation', id, updates));
}

export function moveTextAnnotation(id: string, position: { x: number; y: number }) {
  const p = get(currentProject);
  if (!p) return;
  const floor = p.floors.find(f => f.id === p.activeFloorId);
  if (!floor?.textAnnotations) return;
  const t = floor.textAnnotations.find(t => t.id === id);
  if (!t || (t.x === position.x && t.y === position.y)) return;
  t.x = position.x;
  t.y = position.y;
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

// --- Wall-hosted items and switch links (spec §4.2, §4.5) ---

/**
 * Move a wall-hosted item (outlet, switch, sconce) to a wall position and side during a
 * drag; it may change walls. Its plan pose follows from the host. The canvas owns the
 * enclosing Undo group, as for other drags.
 */
export function moveWallItemDuringDrag(id: string, wallId: string, wallPosition: number, wallSide: 1 | -1) {
  if (!Number.isFinite(wallPosition)) return;
  const p = get(currentProject);
  const floor = p?.floors.find(f => f.id === p.activeFloorId);
  const item = floor?.furniture.find(fi => fi.id === id);
  if (!p || !floor || !item || !floor.walls.some(wall => wall.id === wallId)) return;
  const position = Math.max(0, Math.min(1, wallPosition)), side = wallSide === -1 ? -1 : 1;
  if (item.wallId === wallId && item.wallPosition === position && item.wallSide === side) return;
  item.wallId = wallId;
  item.wallPosition = position;
  item.wallSide = side;
  rehostWallItems(floor);
  p.updatedAt = new Date();
  currentProject.set({ ...p });
}

/**
 * Add `targetId` to the switch's link, or take it out when it is already there (spec §4.5).
 * A switch has at most one link: it is created with its first target and removed with its
 * last. Both must be furniture on the active floor. One Undo step.
 */
export function toggleSwitchLinkTarget(switchId: string, targetId: string) {
  if (switchId === targetId) return;
  const linked = get(activeFloor)?.switchLinks?.find(link => link.switchId === switchId)?.targetIds.includes(targetId);
  mutate(f => {
    if (!f.furniture.some(item => item.id === switchId) || !f.furniture.some(item => item.id === targetId)) return;
    const next = toggledSwitchLinks(f.switchLinks ?? [], switchId, targetId, uid);
    if (next.length) f.switchLinks = next;
    else delete f.switchLinks;
  }, linked ? 'Unlinked from switch' : 'Linked to switch');
}

// --- Pipes (spec §4.5) ---

/** Add a pipe; returns its id, or null when the pipe is not well formed (see validPipeData). */
export function addPipe(pipe: Omit<Pipe, 'id'>): string | null {
  if (!validPipeData(pipe)) return null;
  const id = uid();
  mutate(f => { (f.pipes ??= []).push({ id, ...structuredClone(pipe) }); }, 'Added pipe');
  return id;
}

/**
 * Change a pipe's kind, diameter, run, elevation, riser flag or points. An update that
 * would leave the pipe malformed is ignored; `undefined` clears an optional field.
 * Rapid edits of the same fields coalesce into one Undo step (a multi-drag frame by frame).
 */
export function updatePipe(id: string, updates: Partial<Omit<Pipe, 'id'>>) {
  mutate(f => {
    const pipe = f.pipes?.find(item => item.id === id);
    if (!pipe) return;
    const next: Pipe = { ...pipe, ...structuredClone(updates) };
    for (const key of Object.keys(updates) as (keyof Pipe)[]) if (next[key] === undefined) delete next[key];
    if (!validPipeData(next)) return;
    for (const key of Object.keys(pipe) as (keyof Pipe)[]) delete pipe[key];
    Object.assign(pipe, next);
  }, 'Edited pipe', coalesceKeyFor('pipe', id, updates));
}

/** Insert a point into a pipe at `index` (default: after the last point). */
export function addPipePoint(id: string, point: Point, index?: number) {
  if (!finitePoint(point)) return;
  mutate(f => {
    const pipe = f.pipes?.find(item => item.id === id);
    if (!pipe) return;
    const at = index === undefined ? pipe.points.length : Math.max(0, Math.min(pipe.points.length, Math.round(index)));
    pipe.points.splice(at, 0, { x: point.x, y: point.y });
  }, 'Added pipe point');
}

/** Move one point of a pipe; drag frames of the same point coalesce into one Undo step. */
export function movePipePoint(id: string, index: number, point: Point) {
  if (!finitePoint(point)) return;
  mutate(f => {
    const target = f.pipes?.find(item => item.id === id)?.points[index];
    if (target) { target.x = point.x; target.y = point.y; }
  }, 'Moved pipe point', `pipePoint:${id}:${index}`);
}

/** Remove one point of a pipe; a pipe left with too few points is deleted. */
export function removePipePoint(id: string, index: number) {
  mutate(f => {
    const pipe = f.pipes?.find(item => item.id === id);
    if (!pipe || index < 0 || index >= pipe.points.length) return;
    pipe.points.splice(index, 1);
    if (pipe.points.length < minPipePoints(pipe)) f.pipes = f.pipes!.filter(item => item.id !== id);
  }, 'Removed pipe point');
}

// Layer visibility store (used by the Elements panel, FloorPlanCanvas and the plan exports)
/** `floorBelow` is the dimmed reference underlay of the storey beneath the active one; `roomLabels` shows room names and areas;
 * `underlay` is the traced drawing (the floor's background image); `sections` are the section cut markers. */
export const layerVisibility = writable<{ walls: boolean; doors: boolean; windows: boolean; furniture: boolean; stairs: boolean; columns: boolean; guides: boolean; measurements: boolean; annotations: boolean; textAnnotations: boolean; entourage: boolean; floorBelow: boolean; roomLabels: boolean; constraints: boolean; underlay: boolean; sections: boolean }>({
  walls: true, doors: true, windows: true, furniture: true, stairs: true, columns: true, guides: true, measurements: true, annotations: true, textAnnotations: true, entourage: true, floorBelow: true, roomLabels: true, constraints: true, underlay: true, sections: true,
});

// --- Lock ---
/** Lock the supported selection together; unlock when every item is already locked. */
export function toggleSelectionLock(ids: ReadonlySet<string>) {
  const floor = get(activeFloor);
  if (!floor) return;
  const items = [...floor.furniture, ...floor.entourage ?? []].filter(item => ids.has(item.id));
  if (!items.length) return;
  const locked = items.some(item => !item.locked);
  mutate(f => {
    for (const item of [...f.furniture, ...f.entourage ?? []]) {
      if (ids.has(item.id)) item.locked = locked;
    }
  }, locked ? 'Locked selection' : 'Unlocked selection');
}

export function toggleFurnitureLock(id: string) {
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (fi) fi.locked = !fi.locked;
  });
}

export function setFurnitureLocked(id: string, locked: boolean) {
  mutate((f) => {
    const fi = f.furniture.find((fi) => fi.id === id);
    if (fi) fi.locked = locked;
  });
}

// --- Element Groups ---
export function createGroup(elementIds: string[]): string | null {
  if (elementIds.length < 2) return null;
  const id = uid();
  mutate((f) => {
    if (!f.groups) f.groups = [];
    // Remove any existing group membership for these elements
    f.groups = f.groups.map(g => ({
      ...g,
      elementIds: g.elementIds.filter(eid => !elementIds.includes(eid))
    })).filter(g => g.elementIds.length >= 2);
    f.groups.push({ id, elementIds: [...elementIds] });
  });
  return id;
}

export function ungroup(groupId: string) {
  mutate((f) => {
    if (!f.groups) return;
    f.groups = f.groups.filter(g => g.id !== groupId);
  });
}

export function ungroupElements(elementIds: string[]) {
  mutate((f) => {
    if (!f.groups) return;
    f.groups = f.groups.filter(g => !g.elementIds.some(eid => elementIds.includes(eid)));
  });
}

export function findGroupForElement(floor: Floor, elementId: string): ElementGroup | undefined {
  if (!floor.groups) return undefined;
  return floor.groups.find(g => g.elementIds.includes(elementId));
}

/** Wall id whose face-on elevation editor is open (null = closed) */
export const elevationWallId = writable<string | null>(null);
/** The section shown in the section viewer, or null. */
export const openSectionId = writable<string | null>(null);
/** A wall elevation or a section is open over the plan (the plan's chrome steps aside). */
export const sideViewOpen = derived([elevationWallId, openSectionId], ([$wall, $section]) => !!$wall || !!$section);
/** Armed when Elevation is requested with no wall selected: the next wall
 *  clicked in the plan canvas opens its elevation; empty click / Esc cancels */
export const elevationPickMode = writable<boolean>(false);

// Zoom store for 2D canvas — shared between FloorPlanCanvas and TopBar
export const canvasZoom = writable<number>(1);
export const canvasMinimumZoom = writable<number>(0.1);
// Camera position stores for 2D canvas — used to compute viewport center
export const canvasCamX = writable<number>(0);
export const canvasCamY = writable<number>(0);
