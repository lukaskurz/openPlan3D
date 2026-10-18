export interface Point { x: number; y: number; }

/** Shared item metadata. Null explicitly clears a retained native value. */
export interface ItemDetails {
  note?: string | null;
  price?: number | null;
  photos?: string[];
  material?: string | null;
  roomType?: string | null;
  ceilingHeight?: number | null; // centimetres; metadata, not a wall-height edit
}
export type DetailKind = 'walls' | 'doors' | 'windows' | 'furniture' | 'rooms';
export type DetailTarget = { floorId: string; kind: DetailKind; id: string };
export type PackageMapping = { id: string; kind: string; webId: string; floorId?: string }[];
export interface ProjectPackageState {
  version: 1;
  furnitureCategoriesVersion?: 1;
  native: Record<string, any>;
  mapping: PackageMapping;
  assets: Record<string, string>; // assets/<filename> → base64 bytes, one copy per file
}

export interface Wall {
  details?: ItemDetails;
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  height: number;
  /** Endpoint heights in centimetres. Missing values use the legacy height. */
  startHeight?: number;
  endHeight?: number;
  color: string;
  /** Optional quadratic bezier control point for curved walls */
  curvePoint?: Point;
  texture?: string;
  /** Interior-specific overrides (if different from exterior) */
  interiorColor?: string;
  interiorTexture?: string;
  /** Exterior-specific overrides */
  exteriorColor?: string;
  exteriorTexture?: string;
}

export function validWallHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function getWallStartHeight(wall: Wall): number {
  return validWallHeight(wall.startHeight) ? wall.startHeight : validWallHeight(wall.height) ? wall.height : 280;
}

export function getWallEndHeight(wall: Wall): number {
  return validWallHeight(wall.endHeight) ? wall.endHeight : validWallHeight(wall.height) ? wall.height : 280;
}

export function getWallHeightAt(wall: Wall, t: number): number {
  const s = getWallStartHeight(wall);
  const e = getWallEndHeight(wall);
  const clampedT = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  return s + (e - s) * clampedT;
}


export type RoomCategory = 'indoor' | 'outdoor' | 'garage' | 'utility';

export interface Room {
  /** Enclosed opening through this floor's slab; excluded from usable floor area. */
  floorOpening?: boolean;
  details?: ItemDetails;
  id: string;
  name: string;
  walls: string[];
  floorTexture: string;
  area: number;
  color?: string;
  roomType?: RoomCategory;
  /** Custom label position offset from centroid (in world units) */
  labelOffset?: Point;
}

export interface Door {
  details?: ItemDetails;
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  /** french and balcony are full-height glass doors with two and one leaves. */
  type: 'single' | 'double' | 'sliding' | 'french' | 'balcony' | 'pocket' | 'bifold' | 'opening' | 'garage';
  /** Glass doors: equal panes per leaf separated by glazing bars (1 = one sheet). */
  glassPanes?: number;
  swingDirection: 'left' | 'right';
  flipSide: boolean; // flip which side of wall the door opens to (vertical flip)
}

export interface Window {
  details?: ItemDetails;
  id: string;
  wallId: string;
  position: number; // 0-1 along wall
  width: number;
  height: number;
  sillHeight: number;
  type: 'standard' | 'fixed' | 'casement' | 'sliding' | 'bay';
}

/** The trade an item or tool belongs to (spec §4.1). */
export type Trade = 'furnishing' | 'electrical' | 'plumbing';
/** Which surface of the current storey the plan shows (spec §4.1). */
export type Surface = 'floor' | 'ceiling';
/** How a furniture item is fixed (spec §4.2): standing on the floor, hung on a wall, or hung from the ceiling. */
export type Mount = 'floor' | 'wall' | 'ceiling';

export interface FurnitureItem {
  /** Project-owned model; catalogId remains a portable procedural fallback. */
  customModelId?: string;
  details?: ItemDetails;
  id: string;
  catalogId: string;
  /** Original unsupported import category, used only by the imported_object preview. */
  sourceCategory?: string;
  position: Point;
  rotation: number;
  scale: { x: number; y: number; z: number };
  // Per-item overrides (optional — falls back to catalog defaults)
  color?: string;
  width?: number;   // cm
  depth?: number;   // cm
  height?: number;  // cm
  /**
   * Bottom of the object above the floor, in cm (e.g. a TV on a stand). Missing means 0.
   * Floor items: where the bottom sits. Wall items: the mounting height (outlet 30, switch 105).
   * Ceiling items never store it; their height follows the room's ceiling (see `drop`).
   */
  elevation?: number;
  /** How the item is fixed. Missing means the catalog's mount, else 'floor'. Read it with `furnitureMount()`. */
  mount?: Mount;
  /** Ceiling items: distance from the ceiling to the item's top, in cm (a pendant's cord). Missing means the catalog's `defaultDrop`, else 0. */
  drop?: number;
  /** Wall items: the hosting wall, like a door's or window's `wallId`. */
  wallId?: string;
  /** Wall items: position along the hosting wall, 0 (start) .. 1 (end). */
  wallPosition?: number;
  /** Wall items: which side of the hosting wall the face points to (1 = left of start → end, −1 = right). */
  wallSide?: 1 | -1;
  material?: string; // material name/id
  locked?: boolean;
  /** Light fixtures: photometry overrides for the 3D view. Missing fields use the catalog fixture's (utils/fixtureLights.ts). */
  light?: FixtureLight;
}

/** A light fixture's output, as the 3D view renders it. Every field is optional. */
export interface FixtureLight {
  /** Luminous flux at full output, lm (≥ 0). */
  lumens?: number;
  /** Spots: full beam angle at half intensity, degrees (5–140). */
  beamAngle?: number;
  /** Correlated colour temperature, K (1000–10000). */
  colorTemperature?: number;
  /** Dimmer, 0 (off) .. 1 (full). Missing means 1. */
  dim?: number;
  /** Spots: beam tilt from straight down (or up) towards the item's front, degrees (0–90), e.g. for wall-washing. */
  tilt?: number;
}

export interface ElementGroup {
  id: string;
  elementIds: string[];
}

export type StairType = 'straight' | 'l-shaped' | 'u-shaped' | 'spiral';

export interface Stair {
  id: string;
  position: Point;
  rotation: number;
  width: number;   // default 100cm
  depth: number;   // default 300cm
  riserCount: number; // default 14
  direction: 'up' | 'down';
  stairType: StairType; // default 'straight'
}

export interface Column {
  id: string;
  position: Point;
  rotation: number;
  shape: 'round' | 'square';
  diameter: number;  // cm (for round) or side length (for square)
  height: number;    // cm
  color: string;
}

export interface Measurement {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Annotation {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  offset: number; // perpendicular offset for dimension line (default 40)
}

export type PipeKind = 'cold' | 'hot' | 'waste';
export type PipeRun = 'floor' | 'wall' | 'ceiling';

/** A water or waste pipe drawn by the Plumbing trade (spec §4.5). */
export interface Pipe {
  id: string;
  kind: PipeKind;
  /** Nominal diameter in mm. */
  diameter: number;
  /** Plan polyline in cm; a single point for a riser. */
  points: Point[];
  /** Where the run is laid: in the floor, along the walls, or under the ceiling. */
  run: PipeRun;
  /** Height above the floor surface in cm; negative is in the screed. Omitted: the run's default. */
  elevation?: number;
  /** A vertical stack through the storey at its first point. */
  riser?: boolean;
}

/** A wall corner, referenced through one of the endpoints that meet there. */
export interface CornerRef { wallId: string; end: 'start' | 'end' }
/** 0 = wall centreline; ±1 = the face on the ±normal side of start→end, normal = (-dy, dx). */
export type FaceSide = 0 | 1 | -1;

interface ConstraintBase {
  id: string;
  /** A driven (reference) dimension only reports its value; it never moves geometry. */
  driven?: boolean;
  /** Dimension line offset from the measured geometry, cm. */
  offset?: number;
}

/**
 * Parametric wall constraints. Values are signed where a sign keeps the configuration the
 * user created (the UI shows magnitudes): distances along an axis or normal, and angles
 * in degrees counter-clockwise with plan Y pointing up (like wallAngle), from A to B.
 */
export type Constraint = ConstraintBase & (
  | { kind: 'length'; wallId: string; side: FaceSide; value: number }
  | { kind: 'pointDistance'; a: CornerRef; b: CornerRef; axis: 'aligned' | 'x' | 'y'; value: number }
  | { kind: 'pointLine'; point: CornerRef; wallId: string; side: FaceSide; value: number }
  | { kind: 'lineDistance'; wallA: string; sideA: FaceSide; wallB: string; sideB: FaceSide; value: number }
  | { kind: 'angle'; wallA: string; wallB: string; flipB: boolean; value: number }
  | { kind: 'horizontal' | 'vertical'; wallId: string }
  | { kind: 'parallel' | 'perpendicular'; wallA: string; wallB: string }
  | { kind: 'fix'; target: CornerRef | { wallId: string }; at: Point[] }
);
export type ConstraintKind = Constraint['kind'];
export type DimensionConstraint = Extract<Constraint, { value: number }>;
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
/** A constraint before the store gives it an id. */
export type NewConstraint = WithoutId<Constraint>;

export interface TextAnnotation {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  rotation: number;
}

export interface GuideLine {
  id: string;
  orientation: 'horizontal' | 'vertical';
  position: number; // world coordinate (x for vertical, y for horizontal)
}

export interface BackgroundImage {
  dataUrl: string;
  position: Point;
  scale: number;
  opacity: number;
  rotation: number;
  locked: boolean;
}

/** A placed 2D entourage symbol (person, car, tree, …) for presentation plans */
export interface EntourageItem {
  id: string;
  defId: string; // id of a built-in EntourageDef or a project CustomEntourageDef
  position: Point; // center, world cm
  width: number; // real-world width in cm
  rotation: number; // degrees
  opacity?: number; // 0–1, default 1
  locked?: boolean;
}

/** User-uploaded PNG entourage symbol, stored on the project */
export interface CustomEntourageDef {
  id: string;
  name: string;
  dataUrl: string; // PNG as data URL
  aspect: number; // height / width
}

export interface Floor {
  id: string;
  name: string;
  level: number;
  /** Floor surface above ground in cm; omitted in legacy projects (level × 300). */
  elevation?: number;
  /** Room slab depth below the floor surface in cm; defaults to 5. */
  slabThickness?: number;
  walls: Wall[];
  rooms: Room[];
  doors: Door[];
  windows: Window[];
  furniture: FurnitureItem[];
  stairs: Stair[];
  columns: Column[];
  backgroundImage?: BackgroundImage;
  guides: GuideLine[];
  measurements: Measurement[];
  annotations: Annotation[];
  textAnnotations: TextAnnotation[];
  groups: ElementGroup[];
  entourage?: EntourageItem[];
  /** Parametric dimensions and geometric constraints on this floor's walls. */
  constraints?: Constraint[];
  /**
   * Ceiling height overrides in cm, keyed by saved room id (spec §4.4). Rooms are
   * derived from walls, so a room gets an entry only once it is saved in `rooms`.
   * Mirrored into the room's `details.ceilingHeight` for the native package; read the
   * effective value with `effectiveRoomCeiling()` (utils/ceilingHeights.ts).
   */
  roomCeilingHeights?: Record<string, number>;
  /** Plumbing runs (spec §4.5). */
  pipes?: Pipe[];
  /** "This switch controls these lights" (spec §4.5): drawn as dashed arcs in Electrical. At most one per switch. */
  switchLinks?: SwitchLink[];
}

/** A switch and the furniture items (lights, fans, outlets) it controls. */
export interface SwitchLink {
  id: string;
  /** The switch: a furniture item on the same floor. */
  switchId: string;
  /** The controlled furniture items, never empty in a saved project. */
  targetIds: string[];
}

export interface CustomModelDef {
  id: string;
  name: string;
  assetName: string; // filename within projectPackage.assets, without assets/
  sourceFilename: string;
  sha256: string; // digest of original GLB bytes, checked again before loading
  byteLength: number;
  width: number; // cm
  depth: number; // cm
  height: number; // cm
  attribution?: string;
  license?: string;
  sourceUrl?: string;
}

/** Sibling planner blocks retained through import and export. Apple capture keys never qualify. */
export const INTERCHANGE_BLOCK_KEYS = ['openkitchen3d', 'openlandscape3d', 'opencatio3d'] as const;
export type InterchangeBlockKey = typeof INTERCHANGE_BLOCK_KEYS[number];

/** Prepared-RoomPlan data the web model cannot hold; utils/interchange.ts re-emits it verbatim. */
export interface InterchangeState {
  version: 1;
  /** Top-level sibling blocks exactly as imported, keyed by INTERCHANGE_BLOCK_KEYS. */
  blocks: Record<string, unknown>;
  /** Object identifier → that object's `attributes` (openkitchen3dRole, sku, plantId, opencatio3dKind, …). */
  attributes?: Record<string, Record<string, unknown>>;
  /** The file's top-level `defaults` object. */
  defaults?: Record<string, unknown>;
  /** The file's top-level `planNotes`. */
  planNotes?: string;
}

/** One alternative arrangement of the whole plan (all floors). The active
 * alternative's floors live in `Project.floors`, so its own `floors` is empty;
 * the others keep their floors here until they are switched to. */
export interface PlanAlternative {
  id: string;
  name: string;
  floors: Floor[];
  activeFloorId: string;
  /** When this alternative was last worked on (set when switching away). */
  updatedAt: Date;
  /** Small JPEG data URL of the plan, captured when switching away. */
  thumbnail?: string;
  /** Short version code shown in the badge: 'A', 'B', … for new alternatives, 'A1',
   * 'A2', … for branches (utils/planAlternatives CODE). Never changes on rename;
   * older files get one when read (ensureAlternativeCodes). */
  code?: string;
  /** Code of the alternative this one was branched from. */
  parentCode?: string;
}

export interface Project {
  customModels?: CustomModelDef[];
  attachmentNames?: Record<string, string>;
  projectPackage?: ProjectPackageState;
  interchange?: InterchangeState;
  id: string;
  name: string;
  description?: string;
  floors: Floor[];
  activeFloorId: string;
  createdAt: Date;
  updatedAt: Date;
  customEntourage?: CustomEntourageDef[];
  /** Missing means the plan has no alternatives. When present it lists every
   * alternative, including the active one named by `activeAlternativeId`. */
  alternatives?: PlanAlternative[];
  activeAlternativeId?: string;
  /** Section cut lines. Project-level because a cut passes through every storey;
   * shared by all plan alternatives so they can be compared at the same cut. */
  sections?: PlanSection[];
}

/**
 * A section cut drawn on the plan (cm, plan coordinates, y down).
 * With dir = (end − start) / |end − start| and leftNormal = (−dir.y, dir.x),
 * the section looks along `look * leftNormal`.
 */
export interface PlanSection {
  id: string;
  /** Short code shown in the markers and the viewer title: 'A', 'B', … then 'AA'. */
  code: string;
  start: Point;
  end: Point;
  look: 1 | -1;
  /** Storeys the markers show on; missing = every storey the line crosses. Unknown ids are ignored. */
  floorIds?: string[];
}
