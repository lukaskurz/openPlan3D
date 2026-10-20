import type { EntourageItem, Floor, FurnitureItem, PlanSection, Point, Room } from '$lib/models/types';
import type { IconName } from '$lib/components/chrome/Icon.svelte';
import type { TranslationKey } from '$lib/i18n';
import { formatArea, formatLength } from '$lib/stores/settings';
import { furnitureTrade, getCatalogItem, getFurnitureSize, isPlumbingFixture } from './furnitureCatalog';
import { furnitureMount, itemSurface } from './mounting';
import { pipeLength } from './pipes';
import { wallLength } from './wallEditing';
import { analyzeConstraints } from './constraints';
import { constraintText } from './constraintRenderer';
import { pointInPolygon } from './hitTesting';
import { editableFurniture, pipeEditable, pipeSurface, structureEditable, type WorkContext } from './workFilter';

/**
 * The Elements panel: everything on a storey, itemised by room or by what it is (walls,
 * doors, furniture, lights, outlets, pipes, notes…). Pure: the panel passes in translations,
 * units and the rooms the plan detected, and gets back groups of rows to draw.
 */

/** Layers the plan can hide; a group with one gets a show/hide switch. */
export type ElementLayer = 'walls' | 'doors' | 'windows' | 'stairs' | 'columns' | 'entourage' | 'guides'
  | 'measurements' | 'annotations' | 'textAnnotations' | 'constraints' | 'sections';

export type ElementKind = 'walls' | 'doors' | 'windows' | 'rooms' | 'stairs' | 'columns'
  | 'furniture' | 'lights' | 'electrical' | 'plumbing' | 'pipes' | 'outdoor'
  | 'sections' | 'measurements' | 'dimensions' | 'notes' | 'guides' | 'rules';

/** A kind, a room (`room:<id>`), or what is in no room. */
export type ElementGroupKey = ElementKind | `room:${string}` | 'outside';

export interface ElementEntry {
  id: string;
  name: string;
  /** Size, type or place: shown after the name, muted. */
  detail: string;
  icon: IconName;
  /** Rooms are selected through the room selection, everything else as an element. */
  room?: boolean;
  locked?: boolean;
}

export interface ElementGroup {
  key: ElementGroupKey;
  label: string;
  icon: IconName;
  layer?: ElementLayer;
  /** By room: the room this group lists, selected from its header. */
  room?: { id: string; detail: string };
  entries: ElementEntry[];
}

export interface ElementsListOptions {
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string;
  units: 'metric' | 'imperial';
  /** The rooms of the storey with their outlines, as the plan detects them. */
  rooms: readonly { room: Room; polygon: Point[] }[];
  /** Sections whose markers show on this storey. */
  sections: readonly PlanSection[];
  furnitureLabel: (item: FurnitureItem) => string;
  entourageLabel: (item: EntourageItem, index: number) => string;
}

/** The furniture groups, in the order the panel shows them. */
export type FurnitureGroup = 'furniture' | 'lights' | 'electrical' | 'plumbing' | 'outdoor';

const LIGHT_CATEGORIES = new Set(['Lighting', 'Outdoor Lighting']);
const LIGHT_SYMBOLS = new Set(['sym_ceiling_light', 'sym_recessed_light', 'sym_pendant']);
const OUTDOOR_CATEGORIES = new Set(['Landscaping', 'Fencing', 'Garden Structures', 'Paths & Lawns', 'Pool & Spa', 'Outdoor Furniture']);

/** Which group a placed item is listed under: light fittings apart from the rest of Electrical, sanitary fixtures with Plumbing. */
export function furnitureGroup(item: Pick<FurnitureItem, 'catalogId'>): FurnitureGroup {
  const def = getCatalogItem(item.catalogId);
  if (!def) return 'furniture';
  if ((LIGHT_CATEGORIES.has(def.category) && !def.id.includes('fan')) || LIGHT_SYMBOLS.has(def.id)) return 'lights';
  const trade = furnitureTrade(def);
  if (trade === 'electrical') return 'electrical';
  if (trade === 'plumbing' || isPlumbingFixture(def)) return 'plumbing';
  if (OUTDOOR_CATEGORIES.has(def.category)) return 'outdoor';
  return 'furniture';
}

function furnitureIcon(item: FurnitureItem, group: FurnitureGroup): IconName {
  const id = item.catalogId;
  if (group === 'lights') return id.includes('recessed') ? 'recessed' : id.includes('sconce') ? 'sconce' : 'bulb';
  if (group === 'electrical') {
    if (id.includes('outlet_double')) return 'outletDouble';
    if (id.includes('outlet') || id.includes('junction')) return 'outlet';
    if (id.includes('switch')) return 'switch';
    if (id.includes('smoke')) return 'smoke';
    if (id.includes('fan')) return 'fan';
    return 'bolt';
  }
  if (group === 'plumbing') return id.includes('drain') ? 'drain' : isPlumbingFixture(item) ? 'fixture' : 'droplet';
  if (group === 'outdoor') return 'tree';
  return 'sofa';
}

const capitalise = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);
const oneLine = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The rows of every element of the storey, by kind. */
function entriesByKind(floor: Floor, options: ElementsListOptions): Record<ElementKind, ElementEntry[]> {
  const { t, units } = options;
  const length = (cm: number) => formatLength(cm, units);
  // Footprints in one unit, as on a furniture schedule: 200 × 90 cm.
  const size = (width: number, depth: number) => units === 'metric' ? `${Math.round(width)} × ${Math.round(depth)} cm` : `${length(width)} × ${length(depth)}`;
  const wallNumbers = new Map(floor.walls.map((wall, i) => [wall.id, i + 1]));
  const onWall = (wallId: string) => wallNumbers.has(wallId) ? t('elements.onWall', { number: wallNumbers.get(wallId)! }) : '';
  const joined = (...parts: string[]) => parts.filter(Boolean).join(' · ');

  const byGroup: Record<FurnitureGroup, ElementEntry[]> = { furniture: [], lights: [], electrical: [], plumbing: [], outdoor: [] };
  for (const item of floor.furniture) {
    const group = furnitureGroup(item);
    const mount = furnitureMount(item);
    const dims = getFurnitureSize(item);
    const detail = mount === 'ceiling' ? t('elements.onCeiling')
      : mount === 'wall' ? joined(t('elements.mountedAt', { height: length(item.elevation ?? getCatalogItem(item.catalogId)?.elevation ?? 0) }), item.wallId ? onWall(item.wallId) : '')
        : size(dims.width, dims.depth);
    byGroup[group].push({ id: item.id, icon: furnitureIcon(item, group), name: options.furnitureLabel(item), detail, locked: item.locked });
  }
  (floor.entourage ?? []).forEach((item, i) => byGroup.outdoor.push({ id: item.id, icon: 'tree', name: options.entourageLabel(item, i), detail: '', locked: item.locked }));
  const measures = floor.constraints?.length ? analyzeConstraints(floor.walls, floor.constraints).measures : new Map<string, number>();

  return {
    ...byGroup,
    walls: floor.walls.map((wall, i) => ({
      id: wall.id, icon: 'wall', name: t('elements.wall', { number: i + 1 }),
      detail: joined(length(wallLength(wall)), t('elements.thick', { thickness: length(wall.thickness) })),
    })),
    doors: floor.doors.map((door, i) => ({
      id: door.id, icon: 'door', name: t('elements.door', { number: i + 1 }),
      detail: joined(capitalise(t(`layers.value.${door.type}`)), length(door.width), onWall(door.wallId)),
    })),
    windows: floor.windows.map((win, i) => ({
      id: win.id, icon: 'windowPane', name: t('elements.window', { number: i + 1 }),
      detail: joined(capitalise(t(`layers.value.${win.type}`)), length(win.width), onWall(win.wallId)),
    })),
    rooms: options.rooms.map(({ room }) => ({
      id: room.id, icon: 'roomShape', room: true, name: room.name || t('layers.unnamed'),
      detail: room.floorOpening ? t('elements.floorOpening') : formatArea(room.area, units),
    })),
    stairs: (floor.stairs ?? []).map((stair, i) => ({
      id: stair.id, icon: 'stairs', name: t('elements.stair', { number: i + 1 }),
      detail: joined(capitalise(t(`layers.value.${stair.direction}`)), size(stair.width, stair.depth)),
    })),
    columns: (floor.columns ?? []).map((column, i) => ({
      id: column.id, icon: column.shape === 'round' ? 'columnRound' : 'columnSquare', name: t('elements.column', { number: i + 1 }),
      detail: joined(capitalise(t(`layers.value.${column.shape}`)), length(column.diameter)),
    })),
    pipes: (floor.pipes ?? []).map(pipe => ({
      id: pipe.id, icon: pipe.riser ? 'riser' : 'pipeRun',
      name: t(pipe.riser ? `pipes.riserName.${pipe.kind}` : `pipes.name.${pipe.kind}`),
      detail: pipe.riser ? `${pipe.diameter} mm` : joined(`${pipe.diameter} mm`, length(pipeLength(pipe))),
    })),
    sections: options.sections.map(section => ({
      id: section.id, icon: 'section', name: t('elements.section', { code: section.code }),
      detail: length(Math.hypot(section.end.x - section.start.x, section.end.y - section.start.y)),
    })),
    measurements: (floor.measurements ?? []).map((m, i) => ({
      id: m.id, icon: 'measure', name: t('elements.measurement', { number: i + 1 }),
      detail: length(Math.hypot(m.x2 - m.x1, m.y2 - m.y1)),
    })),
    dimensions: (floor.annotations ?? []).map((a, i) => ({
      id: a.id, icon: 'dimension', name: a.label?.trim() || t('elements.dimension', { number: i + 1 }),
      detail: length(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)),
    })),
    notes: (floor.textAnnotations ?? []).map(note => ({
      id: note.id, icon: 'text', name: oneLine(note.text) || t('layers.emptyNote'), detail: '',
    })),
    guides: (floor.guides ?? []).map((guide, i) => ({
      id: guide.id, icon: 'ruler', name: t('elements.guide', { number: i + 1 }),
      detail: capitalise(t(`layers.value.${guide.orientation}`)),
    })),
    rules: (floor.constraints ?? []).map(c => {
      const value = measures.get(c.id);
      return { id: c.id, icon: c.kind === 'fix' ? 'lock' : 'constrain', name: t(`constraintKinds.${c.kind}`), detail: value === undefined ? '' : constraintText(c, value, units) };
    }),
  };
}

/** How each kind of element shows as a group of its own. */
const KIND_GROUPS: Readonly<Record<ElementKind, { icon: IconName; layer?: ElementLayer }>> = {
  walls: { icon: 'wall', layer: 'walls' },
  doors: { icon: 'door', layer: 'doors' },
  windows: { icon: 'windowPane', layer: 'windows' },
  rooms: { icon: 'roomShape' },
  stairs: { icon: 'stairs', layer: 'stairs' },
  columns: { icon: 'columnRound', layer: 'columns' },
  furniture: { icon: 'sofa' },
  lights: { icon: 'bulb' },
  electrical: { icon: 'bolt' },
  plumbing: { icon: 'pipe' },
  pipes: { icon: 'pipeRun' },
  outdoor: { icon: 'tree' },
  sections: { icon: 'section', layer: 'sections' },
  measurements: { icon: 'measure', layer: 'measurements' },
  dimensions: { icon: 'dimension', layer: 'annotations' },
  notes: { icon: 'text', layer: 'textAnnotations' },
  guides: { icon: 'ruler', layer: 'guides' },
  rules: { icon: 'constrain', layer: 'constraints' },
};

function kindGroups(kinds: Record<ElementKind, ElementEntry[]>, order: readonly ElementKind[], t: ElementsListOptions['t']): ElementGroup[] {
  return order.filter(kind => kinds[kind].length)
    .map(kind => ({ key: kind, label: t(`elements.group.${kind}`), ...KIND_GROUPS[kind], entries: kinds[kind] }));
}

/** Notes, measurements and the like: in both views, after everything that is built. */
const ANNOTATION_KINDS: readonly ElementKind[] = ['sections', 'measurements', 'dimensions', 'notes', 'guides', 'rules'];

/** By type: every element of the storey in the group of its kind; empty groups are left out. Pipes join Plumbing. */
export function elementGroups(floor: Floor, options: ElementsListOptions): ElementGroup[] {
  const kinds = entriesByKind(floor, options);
  kinds.plumbing = [...kinds.plumbing, ...kinds.pipes];
  return kindGroups(kinds, ['walls', 'doors', 'windows', 'rooms', 'stairs', 'columns', 'furniture', 'lights', 'electrical', 'plumbing', 'outdoor', ...ANNOTATION_KINDS], options.t);
}

/** Things that stand, hang or lie in a room, in the order a room lists them. */
const ROOM_KINDS: readonly ElementKind[] = ['furniture', 'lights', 'electrical', 'plumbing', 'outdoor', 'stairs', 'columns'];

/**
 * By room: each room with what is in it, then what is in no room, then the building's own
 * parts (walls, doors, windows, pipe runs), which border or cross rooms and so are listed
 * once in groups of their own, then the notes and measurements. Every element shows once.
 * An item is in the innermost room around its centre; an item on a wall is in the room on
 * the side it faces. Every room shows, even an empty one, so it can be picked.
 */
export function roomGroups(floor: Floor, options: ElementsListOptions): ElementGroup[] {
  const { t, units } = options;
  const kinds = entriesByKind(floor, options);
  const faces = options.rooms
    .filter(face => face.polygon.length >= 3)
    .map(face => ({ ...face, size: Math.abs(polygonArea(face.polygon)) }))
    .sort((a, b) => a.size - b.size);
  const roomAt = (point: Point) => faces.find(face => pointInPolygon(point, face.polygon))?.room.id;

  const anchors = new Map<string, Point>();
  for (const item of floor.furniture) anchors.set(item.id, furnitureAnchor(item, floor));
  for (const item of [...floor.stairs ?? [], ...floor.columns ?? [], ...floor.entourage ?? []]) anchors.set(item.id, item.position);

  const contents = new Map<string, ElementEntry[]>(options.rooms.map(({ room }) => [room.id, []]));
  const outside: ElementEntry[] = [];
  for (const kind of ROOM_KINDS) {
    for (const entry of kinds[kind]) {
      const anchor = anchors.get(entry.id);
      const room = anchor ? roomAt(anchor) : undefined;
      (room !== undefined ? contents.get(room) ?? outside : outside).push(entry);
    }
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // Named rooms in alphabetical order, unnamed ones after them.
  const rooms = [...options.rooms].sort((a, b) => !a.room.name !== !b.room.name ? (a.room.name ? -1 : 1) : collator.compare(a.room.name, b.room.name));
  const groups: ElementGroup[] = rooms.map(({ room }) => ({
    key: `room:${room.id}`, label: room.name || t('layers.unnamed'), icon: 'roomShape',
    room: { id: room.id, detail: room.floorOpening ? t('elements.floorOpening') : formatArea(room.area, units) },
    entries: contents.get(room.id) ?? [],
  }));
  if (outside.length) groups.push({ key: 'outside', label: t('elements.group.outside'), icon: 'tree', entries: outside });
  return [...groups, ...kindGroups(kinds, ['walls', 'doors', 'windows', 'pipes', ...ANNOTATION_KINDS], t)];
}

/** Where an item is for finding its room: its centre, or for a wall item a point just off the face it hangs on. */
function furnitureAnchor(item: FurnitureItem, floor: Floor): Point {
  const wall = item.wallId ? floor.walls.find(w => w.id === item.wallId) : undefined;
  if (!wall || item.wallPosition === undefined) return item.position;
  const at = Math.max(0, Math.min(1, item.wallPosition));
  const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, len = Math.hypot(dx, dy) || 1;
  // The left normal (−dy, dx) is side 1 (see wallSideAt). A chord stands in for a curved host: enough to tell the side.
  const offset = (item.wallSide === -1 ? -1 : 1) * (wall.thickness / 2 + 5);
  return { x: wall.start.x + dx * at - (dy / len) * offset, y: wall.start.y + dy * at + (dx / len) * offset };
}

function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j].x * points[i].y - points[i].x * points[j].y;
  return sum / 2;
}

/**
 * The groups with only the rows that match the query: rows containing it as a phrase ("wall 3" is
 * Wall 3 and what is on it), else rows whose name, detail or group contains every word of it.
 */
export function filterElementGroups(groups: readonly ElementGroup[], query: string): ElementGroup[] {
  const phrase = query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  if (!phrase) return [...groups];
  const words = phrase.split(' ');
  const text = (group: ElementGroup, entry: ElementEntry) => ` ${group.label} · ${entry.name} · ${entry.detail}`.toLocaleLowerCase();
  // A room whose name matches stays even with nothing in it, so it can still be picked.
  const keep = (match: (text: string) => boolean) => groups
    .map(group => ({ ...group, entries: group.entries.filter(entry => match(text(group, entry))) }))
    .filter(group => group.entries.length || (group.room && match(` ${group.label} · ${group.room.detail}`.toLocaleLowerCase())));
  const byPhrase = keep(text => text.includes(phrase));
  return byPhrase.length ? byPhrase : keep(text => words.every(word => text.includes(word)));
}

/**
 * The trade and surface to switch to before selecting an element from the list, or null
 * when the current ones can already select it (see workFilter): an outlet picked while
 * working on Furnishing switches to Electrical, a wall picked on the ceiling goes back to
 * Furnishing on the floor. Rooms, notes, measurements and sections select anywhere.
 */
export function contextForElement(floor: Floor, id: string, ctx: WorkContext): WorkContext | null {
  const item = floor.furniture.find(fi => fi.id === id);
  if (item) {
    if (editableFurniture(item, ctx)) return null;
    // A ceiling item of any trade is editable in Furnishing on the ceiling; stay in the trade when that is where we are.
    const surface = itemSurface(item);
    const trade = editableFurniture(item, { trade: ctx.trade, surface }) ? ctx.trade : furnitureTrade(item);
    return { trade, surface };
  }
  const structure = [floor.walls, floor.doors, floor.windows, floor.stairs ?? [], floor.columns ?? [], floor.entourage ?? []];
  if (structure.some(items => items.some(element => element.id === id))) {
    return structureEditable(ctx) ? null : { trade: 'furnishing', surface: 'floor' };
  }
  const pipe = floor.pipes?.find(p => p.id === id);
  if (pipe) return pipeEditable(pipe, ctx) ? null : { trade: 'plumbing', surface: pipeSurface(pipe) };
  return null;
}
