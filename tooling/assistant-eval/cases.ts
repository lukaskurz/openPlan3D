/**
 * The assistant test set: what a person types, the plan they start from,
 * deterministic checks on the plan afterwards, and a rubric for the grader.
 * Some checks fail on today's tools on purpose (mounting heights and drops
 * can't be set yet); the set measures the improvements as they land.
 */
import type { Floor, FurnitureItem, Point, Project } from '$lib/models/types';
import type { PlanTool } from '$lib/assistant/checks';
import { furnitureMount } from '$lib/utils/mounting';
import { furnitureFootprint, insidePolygon, nearPolygon, polygonGap } from '$lib/assistant/geometry';
import type { ToolCallRecord } from './recorder';
import {
  KIND, apartment, backAgainstWall, blockedDoors, bottomOf, check, diningSet, faces, fmtList, fresh, gapBetween, inRoom, itemsIn, itemsOf,
  kitchenRun, narrowWalkways, numbersWithUnit, openingCentre, overlaps, place, planSignature, reachability, roomAtPoint, roomNamed, rooms,
  structureSignature, tallInFrontOfWindows, throughWalls, topOf, twoRoomFlat, wallFaceDistance, type CheckResult, type RoomShape,
} from './helpers';

export interface EvalContext {
  before: Project;
  after: Project;
  beforeFloor: Floor;
  floor: Floor;
  /** The assistant's final reply. */
  reply: string;
  toolCalls: ToolCallRecord[];
  /** Check tools the assistant made (make_tool). */
  madeTools: PlanTool[];
  /** A proposal was left on the plan and applied. */
  applied: boolean;
}

export type Check = (ctx: EvalContext) => CheckResult | CheckResult[];

export interface EvalCase {
  id: string;
  summary: string;
  prompt: string;
  setup: () => void;
  checks: Check[];
  rubric: string[];
}

// ── Shared checks ────────────────────────────────────────────────────

const EDIT_TOOLS = new Set(['add_room', 'add_walls', 'add_openings', 'place_furniture', 'update_elements', 'delete_elements', 'add_floor', 'trace_drawing']);

const unchanged: Check = ctx => [
  check('plan unchanged', planSignature(ctx.before) === planSignature(ctx.after), ctx.applied ? 'a proposal was applied' : ''),
  check('no editing tools used', !ctx.toolCalls.some(t => t.agent === 'assistant' && EDIT_TOOLS.has(t.name)),
    ctx.toolCalls.filter(t => EDIT_TOOLS.has(t.name)).map(t => t.name).join(', ')),
];

const replied: Check = ctx => check('replied', ctx.reply.trim().length > 0, ctx.reply ? `${ctx.reply.length} characters` : 'no reply');

function need(room: RoomShape | undefined, name: string): RoomShape {
  if (!room) throw new Error(`No room called ${name} in the final plan.`);
  return room;
}

/** Overlaps, items through walls and blocked doors among the given items. */
function sound(items: FurnitureItem[], floor: Floor): CheckResult[] {
  const o = overlaps(floor, items), w = throughWalls(floor, items), d = blockedDoors(floor, items);
  return [
    check('no overlapping furniture', !o.length, fmtList(o)),
    check('nothing through walls', !w.length, fmtList(w)),
    check('door swings clear', !d.length, fmtList(d)),
  ];
}

const key = (i: FurnitureItem) => JSON.stringify([i.catalogId, i.position, i.rotation, i.width, i.depth, i.elevation, i.mount, i.drop]);

/** Items that were there before and stood outside `room` are still there, unmoved. */
function untouchedOutside(ctx: EvalContext, room: (floor: Floor) => RoomShape | undefined): CheckResult {
  const before = room(ctx.beforeFloor);
  const name = before ? `nothing outside ${before.name} changed` : 'existing furniture untouched';
  const outside = ctx.beforeFloor.furniture.filter(i => !before || !insidePolygon(i.position, before.polygon));
  const now = new Map(ctx.floor.furniture.map(i => [i.id, key(i)]));
  const moved = outside.filter(i => now.get(i.id) !== key(i));
  return check(name, !moved.length, fmtList(moved.map(i => `${i.catalogId} ${i.id}`)));
}

const existingUntouched: Check = ctx => untouchedOutside(ctx, () => undefined);

function pointGap(p: Point, poly: Point[]): number {
  if (insidePolygon(p, poly)) return 0;
  return polygonGap([p, p], poly).distance;
}

const nearRoom = (room: RoomShape, item: FurnitureItem, tol = 20) => nearPolygon(item.position, room.polygon, tol);

const living = (f: Floor) => roomNamed(f, /living|wohn/i);
const kitchen = (f: Floor) => roomNamed(f, /kitchen|küche/i);
const bedroom = (f: Floor) => roomNamed(f, /bed|schlaf/i);
const bathroom = (f: Floor) => roomNamed(f, /bath|bad/i);
const hall = (f: Floor) => roomNamed(f, /hall|flur|diele/i);

// ── The cases ────────────────────────────────────────────────────────

export const CASES: EvalCase[] = [
  {
    id: 'q-living-area',
    summary: 'Question: living room size and windows; nothing may change.',
    prompt: 'How big is the living room, and how many windows does it have?',
    setup: () => { apartment(); kitchenRun(); diningSet(); },
    checks: [
      unchanged,
      ctx => {
        const room = need(living(ctx.beforeFloor), 'living room');
        const said = numbersWithUnit(ctx.reply, /m²|m2|sq\.? ?m|square met/);
        const ok = said.some(n => Math.abs(n - room.area) <= 1 || (room.inside !== null && Math.abs(n - room.inside) <= 1));
        return check('states the area (±1 m²)', ok, `said ${said.join(', ') || 'nothing'}; ${room.area.toFixed(2)} m² to wall centres, ${room.inside?.toFixed(2)} inside`);
      },
      ctx => check('says it has two windows', /\b(2|two)\s+windows?\b/i.test(ctx.reply)),
    ],
    rubric: [
      'Gives the living room area correctly (about 24.75 m² to wall centres or about 23.3 m² inside) and says which one it means or uses one consistently.',
      'Gives the correct number of windows (two).',
      'Does not change the plan.',
      'Short, plain answer in English (1–4 sentences).',
    ],
  },
  {
    id: 'q-gap-de',
    summary: 'Question in German: space between bed and wardrobe; nothing may change.',
    prompt: 'Wie viel Platz ist im Schlafzimmer zwischen Bett und Kleiderschrank?',
    setup: () => { apartment(); place(['bed_queen', 200, 535], ['wardrobe', 320, 712.5, 180]); },
    checks: [
      unchanged,
      ctx => {
        const bed = itemsOf(ctx.beforeFloor, KIND.bed)[0], wardrobe = itemsOf(ctx.beforeFloor, KIND.wardrobe)[0];
        const gap = gapBetween(bed, wardrobe);
        const said = [...numbersWithUnit(ctx.reply, /cm|zentimeter/), ...numbersWithUnit(ctx.reply, /m(?![²2a-zäöü])|meter/).map(n => n * 100)];
        return check('states the gap (±10 cm)', said.some(n => Math.abs(n - gap) <= 10), `said ${said.map(Math.round).join(', ') || 'nothing'} cm; gap is ${Math.round(gap)} cm`);
      },
    ],
    rubric: [
      'Gives the clear distance between bed and wardrobe correctly (about 72 cm).',
      'Optionally judges whether that is enough (60–90 cm is the usual walkway), without lecturing.',
      'Does not change the plan.',
      'Answers in German, short and plain.',
    ],
  },
  {
    id: 'edit-move-sofa',
    summary: 'Small edit: move the sofa against the right wall, facing the room.',
    prompt: 'Move the sofa against the right wall of the living room, facing into the room.',
    setup: () => { twoRoomFlat(); place(['sofa', 250, 60], ['coffee_table', 250, 170], ['chair', 47.5, 250, 270]); },
    checks: [
      ctx => {
        const sofa = itemsOf(ctx.floor, KIND.sofa);
        if (sofa.length !== 1) return check('one sofa', false, `${sofa.length} sofas`);
        const s = sofa[0], rotation = ((s.rotation % 360) + 360) % 360;
        return [
          check('sofa faces left (rotation 90)', Math.abs(rotation - 90) <= 5, `rotation ${rotation}`),
          check('sofa back against the right wall', s.position.x > 400 && backAgainstWall(ctx.floor, s, 10), `centre (${Math.round(s.position.x)},${Math.round(s.position.y)})`),
          ...sound([s], ctx.floor),
        ];
      },
      ctx => {
        const others = ctx.beforeFloor.furniture.filter(i => !KIND.sofa(i));
        const now = new Map(ctx.floor.furniture.map(i => [i.id, key(i)]));
        const moved = others.filter(i => now.get(i.id) !== key(i));
        return check('other furniture untouched', !moved.length && ctx.floor.furniture.length === ctx.beforeFloor.furniture.length, fmtList(moved.map(i => i.catalogId)));
      },
      ctx => check('walls, doors and windows untouched', structureSignature(ctx.before) === structureSignature(ctx.after)),
    ],
    rubric: [
      'The sofa ends up with its back against the right wall of the living room, facing into the room.',
      'It keeps the door on that wall clear.',
      'Nothing else is changed.',
      'The reply says briefly what was done.',
    ],
  },
  {
    id: 'edit-rename-door-de',
    summary: 'Small edit in German: rename a room and widen a door.',
    prompt: 'Benenne das Schlafzimmer in Arbeitszimmer um und mach die Tür zwischen den beiden Zimmern 100 cm breit.',
    setup: () => { twoRoomFlat(); place(['bed_queen', 700, 85]); },
    checks: [
      ctx => {
        const study = roomNamed(ctx.floor, /arbeitszimmer/i);
        return [
          check('room renamed to Arbeitszimmer', !!study && insidePolygon({ x: 700, y: 200 }, study.polygon), study ? `${study.name}, ${study.area.toFixed(1)} m²` : 'not found'),
          check('no bedroom left', !roomNamed(ctx.floor, /bedroom|schlafzimmer/i)),
        ];
      },
      ctx => {
        const door = ctx.floor.doors.find(d => { const c = openingCentre(ctx.floor, d); return !!c && Math.abs(c.x - 500) < 2; });
        return [
          check('door between the rooms is 100 cm', !!door && Math.abs(door.width - 100) <= 1, door ? `${door.width} cm` : 'door gone'),
          check('same number of doors', ctx.floor.doors.length === ctx.beforeFloor.doors.length, `${ctx.beforeFloor.doors.length} → ${ctx.floor.doors.length}`),
        ];
      },
      ctx => check('furniture untouched', JSON.stringify(ctx.floor.furniture) === JSON.stringify(ctx.beforeFloor.furniture)),
    ],
    rubric: [
      'Renames the bedroom to "Arbeitszimmer".',
      'Makes the connecting door 100 cm wide without moving it into a wall corner or another opening.',
      'Changes nothing else.',
      'Replies in German, briefly.',
    ],
  },
  {
    id: 'furnish-bedroom',
    summary: 'Furnish one room: double bed, two nightstands, wardrobe.',
    prompt: 'Furnish the bedroom with a double bed, two nightstands and a wardrobe.',
    setup: () => { apartment(); kitchenRun(); },
    checks: [
      ctx => {
        const room = need(bedroom(ctx.floor), 'bedroom');
        const beds = itemsIn(ctx.floor, room, KIND.bed), stands = itemsIn(ctx.floor, room, KIND.nightstand), robes = itemsIn(ctx.floor, room, KIND.wardrobe);
        const bed = beds[0];
        const results = [
          check('a bed in the bedroom', !!bed && inRoom(bed, room), `${beds.length} bed(s)`),
          check('bed headboard against a wall', !!bed && backAgainstWall(ctx.floor, bed)),
          check('two nightstands beside the bed', stands.length === 2 && !!bed && stands.every(s => gapBetween(s, bed) <= 15), `${stands.length} nightstand(s)${bed ? `, gaps ${stands.map(s => Math.round(gapBetween(s, bed))).join(', ')} cm` : ''}`),
          check('a wardrobe with its back to a wall', robes.length >= 1 && robes.every(r => inRoom(r, room) && backAgainstWall(ctx.floor, r)), `${robes.length} wardrobe(s)`),
        ];
        const items = itemsIn(ctx.floor, room);
        const tall = tallInFrontOfWindows(ctx.floor, items), narrow = narrowWalkways(ctx.floor, 60, room);
        return [...results, ...sound(items, ctx.floor),
          check('nothing tall in front of windows', !tall.length, fmtList(tall)),
          check('walkways of 60 cm or more (check_plan)', !narrow.length, fmtList(narrow))];
      },
      ctx => untouchedOutside(ctx, bedroom),
    ],
    rubric: [
      'Places a double bed, two nightstands and a wardrobe, all inside the bedroom.',
      'Bed headboard against a wall with walking space on both sides and at the foot; the wardrobe has room to open in front of it.',
      'The door swing and the window stay clear.',
      'Nothing outside the bedroom changes.',
      'The reply says briefly what was placed and where.',
    ],
  },
  {
    id: 'furnish-living-de',
    summary: 'Furnish the living room in German: sofa, coffee table, TV, dining for four.',
    prompt: 'Richte das Wohnzimmer ein: ein Sofa mit Couchtisch gegenüber vom Fernseher und einen Esstisch für vier Personen.',
    setup: () => { apartment(); kitchenRun(); },
    checks: [
      ctx => {
        const room = need(living(ctx.floor), 'living room');
        const sofa = itemsIn(ctx.floor, room, KIND.sofa)[0], tv = itemsIn(ctx.floor, room, KIND.tv)[0];
        const table = itemsIn(ctx.floor, room, KIND.diningTable)[0], chairs = itemsIn(ctx.floor, room, KIND.diningChair);
        const items = itemsIn(ctx.floor, room);
        const narrow = narrowWalkways(ctx.floor, 60, room), tall = tallInFrontOfWindows(ctx.floor, items);
        return [
          check('sofa, coffee table and TV in the living room', !!sofa && !!tv && itemsIn(ctx.floor, room, KIND.coffeeTable).length > 0),
          check('sofa faces the TV', !!sofa && !!tv && faces(sofa, tv)),
          check('dining table with four chairs at it', !!table && chairs.filter(c => gapBetween(c, table) <= 60).length >= 4, `${chairs.length} chair(s)`),
          check('everything inside the room', items.every(i => inRoom(i, room, 2))),
          ...sound(items, ctx.floor),
          check('nothing tall in front of windows', !tall.length, fmtList(tall)),
          check('walkways of 60 cm or more (check_plan)', !narrow.length, fmtList(narrow)),
        ];
      },
      ctx => untouchedOutside(ctx, living),
    ],
    rubric: [
      'Places a sofa facing a TV with a coffee table between them, and a dining table with four chairs.',
      'Seating and dining areas are distinct and practical; chairs can be pulled out; paths to both doors stay clear.',
      'Nothing outside the living room changes.',
      'Replies in German, briefly.',
    ],
  },
  {
    id: 'rearrange-living',
    summary: 'Rearrange a badly laid out living room without losing items.',
    prompt: 'Rearrange the living room: the sofa should face the TV, both doors must stay clear, and keep all the furniture.',
    setup: () => { twoRoomFlat(); place(['sofa', 250, 330], ['tv_stand', 250, 30], ['coffee_table', 250, 200], ['chair', 450, 330, 90]); },
    checks: [
      ctx => {
        const room = need(living(ctx.floor), 'living room');
        const count = (f: Floor, r: RoomShape | undefined) => JSON.stringify(itemsIn(f, r).map(i => i.catalogId).sort());
        const sofa = itemsIn(ctx.floor, room, KIND.sofa)[0], tv = itemsIn(ctx.floor, room, KIND.tv)[0];
        const items = itemsIn(ctx.floor, room), narrow = narrowWalkways(ctx.floor, 60, room);
        return [
          check('same furniture as before', count(ctx.floor, room) === count(ctx.beforeFloor, living(ctx.beforeFloor)), count(ctx.floor, room)),
          check('sofa faces the TV', !!sofa && !!tv && faces(sofa, tv)),
          check('TV faces the sofa', !!sofa && !!tv && faces(tv, sofa)),
          ...sound(items, ctx.floor),
          check('walkways of 60 cm or more (check_plan)', !narrow.length, fmtList(narrow)),
        ];
      },
      ctx => check('walls, doors and windows untouched', structureSignature(ctx.before) === structureSignature(ctx.after)),
    ],
    rubric: [
      'The sofa faces the TV at a sensible viewing distance, with the coffee table between them.',
      'Both doors are clear (the sofa and armchair no longer block them).',
      'Keeps all four items; adds or removes nothing.',
      'The new layout is practical: walkways, backs of the sofa/TV stand against walls or a deliberate floating sofa.',
    ],
  },
  {
    id: 'light-kitchen-dining-de',
    summary: 'Lighting in German: pendants over the dining table at the right height, spots over the worktop.',
    prompt: 'Plane die Beleuchtung für Küche und Essplatz: Pendelleuchten über dem Esstisch in der richtigen Höhe und Einbauspots über der Arbeitsfläche.',
    setup: () => { apartment(); kitchenRun(); diningSet(); },
    checks: [
      ctx => {
        const table = itemsOf(ctx.floor, KIND.diningTable)[0];
        if (!table) return check('dining table still there', false);
        const footprint = furnitureFootprint(table);
        const pendants = itemsOf(ctx.floor, KIND.pendant).filter(p => pointGap(p.position, footprint) <= 20);
        const tableTop = topOf(ctx.after, ctx.floor, table);
        const heights = pendants.map(p => Math.round(bottomOf(ctx.after, ctx.floor, p) - tableTop));
        return [
          check('a pendant over the dining table', pendants.length > 0, `${pendants.length} over the table`),
          check('pendants are ceiling-mounted', pendants.length > 0 && pendants.every(p => furnitureMount(p) === 'ceiling'), pendants.map(p => furnitureMount(p)).join(', ')),
          check('pendants hang 55–80 cm above the table top', heights.length > 0 && heights.every(h => h >= 55 && h <= 80), heights.length ? `${heights.join(', ')} cm above the top` : 'no pendants'),
        ];
      },
      ctx => {
        const room = need(kitchen(ctx.floor), 'kitchen');
        const spots = itemsOf(ctx.floor, KIND.spot).filter(s => insidePolygon(s.position, room.polygon));
        const counters = itemsIn(ctx.floor, room, KIND.counter);
        const overWork = spots.filter(s => counters.some(c => pointGap(s.position, furnitureFootprint(c)) <= 80));
        return [
          check('at least two spots in the kitchen, ceiling-mounted', spots.length >= 2 && spots.every(s => furnitureMount(s) === 'ceiling'), `${spots.length} spot(s)`),
          check('spots light the worktop (within 80 cm of it)', overWork.length >= 2, `${overWork.length} near the worktop`),
        ];
      },
      ctx => {
        const added = ctx.floor.furniture.filter(i => !ctx.beforeFloor.furniture.some(b => b.id === i.id) && KIND.light(i));
        const astray = added.filter(i => { const r = roomAtPoint(ctx.floor, i.position); return !r || !/kitchen|küche|living|wohn/i.test(r.name); });
        return check('new lights only in kitchen and dining area', !astray.length, fmtList(astray.map(i => i.catalogId)));
      },
      existingUntouched,
    ],
    rubric: [
      'One or more pendants are centred over the dining table and hang with their bottom about 60–70 cm above the table top (55–80 cm acceptable).',
      'Recessed spots are spaced along the worktop, slightly in front of the cabinets, so the person working does not shade the counter.',
      'Lights are ceiling-mounted where they should be, and nothing unrelated changes.',
      'If a height cannot be set with the tools, the reply says so honestly instead of claiming it.',
      'Replies in German, briefly.',
    ],
  },
  {
    id: 'electrical-kitchen',
    summary: 'Outlets above the worktop and for appliances, and a switch by the door.',
    prompt: 'Add power outlets and a light switch to the kitchen: double outlets above the worktop, outlets for the fridge and the stove, and a switch next to the kitchen door.',
    setup: () => { apartment(); kitchenRun(); },
    checks: [
      ctx => {
        const room = need(kitchen(ctx.floor), 'kitchen');
        const outlets = itemsOf(ctx.floor, KIND.outlet).filter(o => nearRoom(room, o));
        const heights = outlets.map(o => Math.round(bottomOf(ctx.after, ctx.floor, o)));
        const sensible = (h: number) => (h >= 15 && h <= 60) || (h >= 95 && h <= 130) || (h >= 190 && h <= 230);
        return [
          check('at least four outlets in the kitchen', outlets.length >= 4, `${outlets.length} outlet(s)`),
          check('outlets are wall-mounted', outlets.length > 0 && outlets.every(o => furnitureMount(o) === 'wall'), outlets.map(o => furnitureMount(o)).join(', ')),
          check('outlets sit on a wall (within 15 cm of its face)', outlets.length > 0 && outlets.every(o => wallFaceDistance(ctx.floor, o.position) <= 15)),
          check('at least two outlets above the worktop (95–125 cm)', heights.filter(h => h >= 95 && h <= 125).length >= 2, `heights ${heights.join(', ') || 'none'} cm`),
          check('every outlet at a sensible height', heights.length > 0 && heights.every(sensible), `heights ${heights.join(', ') || 'none'} cm`),
        ];
      },
      ctx => {
        const room = need(kitchen(ctx.floor), 'kitchen');
        const door = ctx.floor.doors.find(d => { const c = openingCentre(ctx.floor, d); return !!c && nearPolygon(c, room.polygon, 2) && !!hall(ctx.floor) && nearPolygon(c, hall(ctx.floor)!.polygon, 2); });
        const centre = door && openingCentre(ctx.floor, door);
        const switches = itemsOf(ctx.floor, KIND.switch).filter(s => centre && Math.hypot(s.position.x - centre.x, s.position.y - centre.y) <= door!.width / 2 + 60);
        const heights = switches.map(s => Math.round(bottomOf(ctx.after, ctx.floor, s)));
        return [
          check('a switch beside the kitchen door', switches.length > 0, `${switches.length} switch(es) within 60 cm of the door edge`),
          check('switch at 85–115 cm, wall-mounted', switches.length > 0 && switches.every((s, i) => furnitureMount(s) === 'wall' && heights[i] >= 85 && heights[i] <= 115), `heights ${heights.join(', ') || 'none'} cm`),
        ];
      },
      existingUntouched,
    ],
    rubric: [
      'Double outlets above the worktop at about 100–115 cm, spread along it (not behind the sink or directly over the stove).',
      'Appliance outlets for fridge and stove at a sensible height and position.',
      'A light switch at about 105 cm on the latch side of the kitchen door, inside the kitchen.',
      'Says honestly if heights could not be set as intended.',
      'Nothing else in the plan changes.',
    ],
  },
  {
    id: 'bathroom-de',
    summary: 'Bathroom layout in German with lights and an outlet, respecting the zones.',
    prompt: 'Plane das Bad komplett: Dusche, WC, Waschbecken, Waschmaschine, ein Deckenlicht, eine Spiegelleuchte und eine Steckdose am Waschbecken. Halte die Schutzbereiche ein.',
    setup: () => { apartment(); },
    checks: [
      ctx => {
        const room = need(bathroom(ctx.floor), 'bathroom');
        const items = itemsIn(ctx.floor, room);
        const has = (kind: (i: FurnitureItem) => boolean) => items.some(kind);
        return [
          check('shower, toilet, basin and washer in the bathroom', has(KIND.showerOrTub) && has(KIND.toilet) && has(KIND.basin) && has(KIND.washer),
            ['showerOrTub', 'toilet', 'basin', 'washer'].filter(k => !has(KIND[k as keyof typeof KIND])).map(k => `missing ${k}`).join(', ')),
          check('fixtures inside the bathroom', items.filter(i => furnitureMount(i) === 'floor').every(i => inRoom(i, room, 2))),
          ...sound(items, ctx.floor),
        ];
      },
      ctx => {
        const room = need(bathroom(ctx.floor), 'bathroom');
        const all = ctx.floor.furniture.filter(i => nearRoom(room, i));
        const wet = all.filter(KIND.showerOrTub).map(furnitureFootprint);
        const basin = all.find(KIND.basin);
        const sockets = all.filter(i => KIND.outlet(i) || KIND.switch(i));
        const zone2 = sockets.filter(s => wet.some(w => pointGap(s.position, w) < 60));
        const wallLights = all.filter(i => KIND.light(i) && furnitureMount(i) === 'wall');
        const zone1 = wallLights.filter(l => wet.some(w => pointGap(l.position, w) === 0));
        return [
          check('a ceiling light in the bathroom', all.some(i => KIND.light(i) && furnitureMount(i) === 'ceiling')),
          check('an outlet near the basin (within 120 cm)', !!basin && all.some(o => KIND.outlet(o) && Math.hypot(o.position.x - basin.position.x, o.position.y - basin.position.y) <= 120)),
          check('no outlets or switches within 60 cm of shower or tub (zones 1–2)', !zone2.length, fmtList(zone2.map(i => i.catalogId))),
          check('no wall lights above the shower or tub (zone 1)', !zone1.length, fmtList(zone1.map(i => i.catalogId))),
        ];
      },
      ctx => untouchedOutside(ctx, bathroom),
    ],
    rubric: [
      'A workable bathroom: shower, WC, basin and washer fit without overlapping, with the door swing and the space in front of the WC and basin clear (about 70 cm).',
      'Electrical items respect DIN VDE 0100-701 zones: no outlet within 60 cm of the shower, lights above the shower only if suitable, outlet beside the basin.',
      'Ceiling light and a mirror light over the basin.',
      'Says what it could not do (for example mounting heights) instead of glossing over it.',
      'Replies in German, briefly.',
    ],
  },
  {
    id: 'hall-barrier-free-de',
    summary: 'Barrier-free check of the hall in German: door widths and corridor width, fixed where possible.',
    prompt: 'Ist der Flur rollstuhlgerecht? Prüfe die Türbreiten und Bewegungsflächen und korrigiere, was du kannst.',
    setup: () => { apartment({ bathroom: 70, storage: 70, bedroom: 80, kitchen: 80 }); place(['storage', 707.5, 537.5, 90, { depth: 70 }]); },
    checks: [
      ctx => {
        const room = need(hall(ctx.floor), 'hall');
        const doors = ctx.floor.doors.filter(d => { const c = openingCentre(ctx.floor, d); return !!c && nearPolygon(c, room.polygon, 2); });
        const narrow = doors.filter(d => d.width < 90);
        return check('every hall door at least 90 cm wide', doors.length >= 6 && !narrow.length, `${doors.length} doors; narrow: ${narrow.map(d => `${d.width} cm`).join(', ') || 'none'}`);
      },
      ctx => {
        const room = need(hall(ctx.floor), 'hall');
        const narrow = narrowWalkways(ctx.floor, 120, room);
        return check('hall at least 120 cm clear (check_plan)', !narrow.length, fmtList(narrow));
      },
      ctx => {
        const { unreachable, exterior } = reachability(ctx.floor);
        return check('every room still reachable from the entrance', exterior >= 1 && !unreachable.length, unreachable.join(', ') || `${exterior} entrance(s)`);
      },
      ctx => untouchedOutside(ctx, hall),
    ],
    rubric: [
      'Identifies the problems: doors of 70–80 cm (DIN 18040-2 asks for about 90 cm clear) and the cabinet narrowing the hall below 120 cm.',
      'Fixes what the tools allow: widens the doors where the walls leave room and moves or shrinks the cabinet so the hall is at least 120 cm clear.',
      'Mentions what it cannot check or fix (thresholds, turning circles of 150 cm, door hardware) without overclaiming compliance.',
      'Replies in German, short and plain.',
    ],
  },
  {
    id: 'build-flat-de',
    summary: 'Build a flat in German from a text description with inside dimensions and wall thicknesses.',
    prompt: 'Zeichne bitte meine Wohnung nach diesen Maßen (alles Innenmaße): Außenwände 30 cm, Innenwände 10 cm. Oben links das Wohnzimmer 5,00 × 4,20 m, rechts daneben die Küche 3,50 × 4,20 m. Darunter von links nach rechts: Schlafzimmer 4,00 × 3,50 m, Bad 2,20 × 3,50 m und Flur 2,20 × 3,50 m. Die Eingangstür (90 cm) führt unten in den Flur. Vom Flur gehen Türen ins Bad (80 cm) und in die Küche (90 cm). Zwischen Küche und Wohnzimmer ist ein offener Durchgang von 1,20 m, und vom Wohnzimmer geht eine Tür (80 cm) ins Schlafzimmer. Fenster: zwei im Wohnzimmer oben, eins in der Küche oben, eins im Schlafzimmer links und eins im Bad unten.',
    setup: () => { fresh('Neue Wohnung'); },
    checks: [
      ctx => {
        const list = rooms(ctx.floor);
        const expected: [string, RegExp, number][] = [
          ['Wohnzimmer', /wohn|living/i, 21.0], ['Küche', /küche|kueche|kitchen/i, 14.7], ['Schlafzimmer', /schlaf|bed/i, 14.0],
          ['Bad', /bad|bath/i, 7.7], ['Flur', /flur|hall|diele|eingang/i, 7.7],
        ];
        return [
          check('five rooms', list.length === 5, list.map(r => r.name).join(', ')),
          ...expected.map(([name, pattern, area]) => {
            const r = list.find(x => pattern.test(x.name));
            const inside = r?.inside ?? null;
            return check(`${name} ${area} m² inside (±3%)`, inside !== null && Math.abs(inside - area) <= area * 0.03, r ? `${inside?.toFixed(2)} m² inside` : 'room missing');
          }),
        ];
      },
      ctx => {
        const points = ctx.floor.walls.flatMap(w => [w.start, w.end]);
        if (!points.length) return check('walls drawn', false);
        const xs = points.map(p => p.x), ys = points.map(p => p.y);
        const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
        const sides: ((p: Point) => boolean)[] = [p => Math.abs(p.x - box.x0) < 2, p => Math.abs(p.x - box.x1) < 2, p => Math.abs(p.y - box.y0) < 2, p => Math.abs(p.y - box.y1) < 2];
        const outer = ctx.floor.walls.filter(w => sides.some(side => side(w.start) && side(w.end)));
        const inner = ctx.floor.walls.filter(w => !outer.includes(w));
        const w = box.x1 - box.x0, d = box.y1 - box.y0;
        return [
          check('outer size 8.90 × 8.10 m to wall centres (±5 cm)', Math.abs(w - 890) <= 5 && Math.abs(d - 810) <= 5, `${Math.round(w)} × ${Math.round(d)} cm`),
          check('outer walls 30 cm', outer.length > 0 && outer.every(x => Math.abs(x.thickness - 30) <= 3), [...new Set(outer.map(x => x.thickness))].join(', ')),
          check('inner walls 10 cm', inner.length > 0 && inner.every(x => Math.abs(x.thickness - 10) <= 2), [...new Set(inner.map(x => x.thickness))].join(', ')),
        ];
      },
      ctx => {
        const { unreachable, exterior } = reachability(ctx.floor);
        return [
          check('every room reachable from the entrance', exterior >= 1 && !unreachable.length, unreachable.join(', ') || `${exterior} entrance(s)`),
          check('five doors or openings, five windows', ctx.floor.doors.length >= 5 && ctx.floor.windows.length >= 5, `${ctx.floor.doors.length} doors, ${ctx.floor.windows.length} windows`),
        ];
      },
    ],
    rubric: [
      'Room sizes match the inside dimensions given (within about 3%), with walls drawn on their centre lines at 30 cm outside and 10 cm inside.',
      'The arrangement matches the description (living room and kitchen on top, bedroom, bathroom and hall below from left to right).',
      'Doors, the open passage and windows are where described, with the given widths.',
      'Rooms are named in German and every room is reachable.',
      'The reply is short and mentions any assumptions.',
    ],
  },
  {
    id: 'furnish-flat',
    summary: 'Multi-room furnishing: the whole apartment at once.',
    prompt: 'Furnish the whole apartment so we can move in: living room, bedroom, kitchen and bathroom. Keep walkways and doors clear.',
    setup: () => { apartment(); },
    checks: [
      ctx => {
        const f = ctx.floor;
        const inR = (room: RoomShape | undefined, kind: (i: FurnitureItem) => boolean) => itemsIn(f, room, kind).length > 0;
        return [
          check('living room has a sofa', inR(living(f), KIND.sofa)),
          check('bedroom has a bed', inR(bedroom(f), KIND.bed)),
          check('kitchen has fridge, sink and cooker', inR(kitchen(f), KIND.fridge) && inR(kitchen(f), KIND.kitchenSink) && inR(kitchen(f), KIND.cooker)),
          check('bathroom has toilet, basin and shower or tub', inR(bathroom(f), KIND.toilet) && inR(bathroom(f), KIND.basin) && inR(bathroom(f), KIND.showerOrTub)),
        ];
      },
      ctx => {
        const floorItems = ctx.floor.furniture.filter(i => furnitureMount(i) === 'floor');
        const outside = floorItems.filter(i => !rooms(ctx.floor).some(r => inRoom(i, r, 2)));
        const narrow = [living, bedroom].flatMap(r => { const room = r(ctx.floor); return room ? narrowWalkways(ctx.floor, 60, room) : []; });
        return [
          check('every item inside a room', !outside.length, fmtList(outside.map(i => i.catalogId))),
          ...sound(ctx.floor.furniture, ctx.floor),
          check('walkways of 60 cm or more in living room and bedroom', !narrow.length, fmtList(narrow)),
        ];
      },
      ctx => check('walls, doors and windows untouched', structureSignature(ctx.before) === structureSignature(ctx.after)),
    ],
    rubric: [
      'Each of the four rooms gets the essentials (sofa and TV; bed, nightstands and wardrobe; a kitchen run with fridge, sink and stove; WC, basin and shower or tub).',
      'Layouts are practical: backs against walls, clear walkways, door swings and windows clear.',
      'Does not change walls, doors or windows.',
      'The reply summarises per room in a few sentences.',
    ],
  },
  {
    id: 'ambiguous-nicer',
    summary: 'Ambiguous request: "make it nicer".',
    prompt: 'Make it nicer.',
    setup: () => { twoRoomFlat(); place(['sofa', 250, 60], ['coffee_table', 250, 170], ['bed_queen', 700, 85], ['wardrobe', 870, 200, 90]); },
    checks: [
      replied,
      ctx => check('walls, doors and windows untouched', structureSignature(ctx.before) === structureSignature(ctx.after)),
      ctx => {
        const o = overlaps(ctx.floor), d = blockedDoors(ctx.floor);
        return check('no new overlaps or blocked doors', !o.length && !d.length, fmtList([...o, ...d]));
      },
    ],
    rubric: [
      'Makes a sensible, modest choice (for example rugs, plants, lamps, a better arrangement) or asks one short clarifying question; either way it says what it chose or why it asks.',
      'Does not change the structure (walls, doors, windows).',
      'Any additions fit and leave walkways and doors clear.',
      'Short reply.',
    ],
  },
  {
    id: 'make-walkway-tool',
    summary: 'Build a reusable walkway check tool; the plan must not change.',
    prompt: 'Build me a tool that marks walkways narrower than 80 cm so I can check my layout later.',
    setup: () => { apartment(); kitchenRun(); diningSet(); },
    checks: [
      ctx => check('made a walkway tool with an 80 cm minimum', ctx.madeTools.some(t => t.kind === 'walkway' && t.minimum === 80), ctx.madeTools.map(t => `${t.kind} ${t.minimum}`).join(', ') || 'no tool'),
      ctx => check('plan unchanged', planSignature(ctx.before) === planSignature(ctx.after)),
    ],
    rubric: [
      'Makes a walkway tool with an 80 cm minimum and a clear name.',
      'Tells the person what it found now (or that nothing is narrower) and that the tool stays available.',
      'Does not change the plan.',
      'Short reply.',
    ],
  },
  {
    id: 'decline-taxes-de',
    summary: 'Out of scope in German: tax return help; should decline politely.',
    prompt: 'Kannst du mir bei meiner Steuererklärung helfen? Ich weiß nicht, was ich alles absetzen kann.',
    setup: () => { twoRoomFlat(); },
    checks: [
      unchanged,
      replied,
      ctx => check('replies in German', /\b(ich|nicht|leider|kann|dir|Ihnen|bei|und)\b/i.test(ctx.reply)),
    ],
    rubric: [
      'Politely declines: tax advice is outside what it helps with.',
      'Offers what it can do instead (the plan, layout, furnishing), without giving tax advice.',
      'Replies in German, in one to three sentences.',
      'Does not use tools to change the plan.',
    ],
  },
];
