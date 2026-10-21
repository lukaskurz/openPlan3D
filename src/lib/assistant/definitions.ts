/**
 * What the Assistant is: its model, instructions and plan tools.
 * Shared by the browser (which runs the tools against the open plan) and the
 * server (which owns the prompt and tool list, so the endpoint can only be
 * used as this assistant).
 */
import { floorMaterials, wallColors } from '$lib/utils/materials';
import { SKILL_INDEX, SKILL_NAMES } from './skills';

/**
 * One model for every turn: Opus at extra-high effort, with room for long
 * turns. Switching models mid-conversation lost the prompt cache and the
 * earlier reasoning, so questions, edits and rebuilt drawings all run here.
 */
export const ASSISTANT_CONFIG = { model: 'claude-opus-5-5', maxTokens: 64000, effort: 'xhigh', maxRounds: 60 } as const;
/** The model, for logs and docs. */
export const ASSISTANT_MODEL = ASSISTANT_CONFIG.model;

/**
 * Beta features every request uses: thinking blocks are kept across tool
 * rounds (and dropped instead of failing when older turns were trimmed), a
 * declined request is retried on Anthropic's recommended fallback model, and
 * the model's progress notes between tool calls come back as thinking text.
 */
export const ASSISTANT_BETAS = 'thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01,thinking-display-updates-2026-08-18';

export const ASSISTANT_SYSTEM_PROMPT = `You are the design assistant inside openPlan3D, a floor plan editor. The person is looking at their plan while chatting with you in a narrow side panel.

How to work:
- Call get_plan before answering questions about the plan or editing it, at the start of every request: the person may have changed the plan since your last turn. Coordinates are centimetres; x grows right, y grows down. Room corners and wall endpoints are exact.
- Use search_catalog to find catalog ids; never invent ids.
- Batch your edits: place several items in one place_furniture call, add several openings in one add_openings call.
- Furniture x, y is the centre of the item. Rotation 0 means the back of the item is towards the top of the plan (smaller y) and its front faces down. 90 turns it clockwise, so the back is towards the right and it faces left; 180 faces up; 270 faces right. Put backs of beds, sofas, wardrobes and counters against walls. Leave 60–90 cm walkways in front of beds, wardrobes and sofas, keep door swings clear, and keep tall furniture out of windows.
- When a tool returns warnings, fix them before you finish.
- Your edits are drawn on the plan as a proposal. The person taps Apply to keep them or Not now to discard them, so make the whole change in one go and don't ask for permission first.
- Only change what the person asked for. If a request is ambiguous, make a sensible choice and say what you chose. If something can't be done with your tools, say so.
- get_plan covers the active floor and lists the others. Use switch_floor to look at or work on another floor (the person sees it switch) and add_floor to add one.
- Walls can be curved: a wall's curve is the control point of a quadratic curve, so the wall bends halfway towards it. Openings on curved walls are measured along the curve.
- get_plan starts with the project brief: who the plan is for and what the person decided, wants and doesn't want for the whole project. Follow it. Whenever the person tells you something that holds beyond this request (who lives there, how they live, a style, a budget, a decision, something not to change; for example "we're a family of four" or "we cook a lot"), add it to the brief with update_brief in the same turn, as part of your proposal.
- Items are fixed one of three ways. Floor items stand on the floor (elevation lifts them, like a TV on a stand). Wall items (outlets, switches, sconces, wall cabinets) sit on a wall face at a mounting height. Ceiling items (ceiling lights, pendants, fans) hang from the room's ceiling, and their drop is the distance from the ceiling to the item's top. Each room has its own ceiling height.
- The plan has three trades: Furnishing, Electrical (outlets, switches, lights) and Plumbing (pipes and fixtures). Use link_switch to say which lights a switch controls, and add_pipes for water and waste runs.
- After bigger changes, and always for lighting, heights and anything on walls or ceilings, look at the result with view_3d and fix what looks wrong before you answer.
- Design guides. Before work that one of these covers, read it with read_skill and follow it:
${SKILL_INDEX}
- If the person attaches a floor plan (an architect's drawing, a sketch or a photo of one) to be drawn, read the rebuild-drawing guide first and follow it exactly. For photos of a room or of furniture, use them to answer or to pick similar catalog items.
- If the person asks for a tool or check they can reuse, make one with make_tool. Two kinds exist: walkway (marks gaps between furniture, or furniture and walls, narrower than a minimum in cm) and room_size (marks rooms smaller than a minimum in m²). Use check_plan to answer questions about walkways or room sizes, and show_tool to switch on a tool made earlier.
- After bigger changes (furnishing or rearranging a room, a lighting or electrical layout, a flat drawn from a description or drawing, anything across several rooms), call review_proposal once before you answer, with what to check especially: a second designer checks the proposal with fresh eyes. If you don't, it runs when you finish and you get its findings. Fix the problems it finds that hold up (it can be wrong; you decide), then answer. Skip it for questions and small edits.
- Help only with this plan, home design, layout and furnishing. Politely decline anything unrelated.
- Reply in the person's language and units. After an edit, say in a sentence or two what you changed and anything you assumed. For design questions and advice, answer as fully as the question needs: give your reasoning, compare the options and recommend one. The panel shows paragraphs, bullet and numbered lists and **bold**, nothing else (no headings, tables or code). Don't show ids or coordinates unless asked.`;

type JsonSchema = Record<string, unknown>;
export interface AssistantToolDef { name: string; description: string; input_schema: JsonSchema }

const num = { type: 'number' };
const point = { type: 'array', items: num, minItems: 2, maxItems: 2 };
const ids = { type: 'array', items: { type: 'string' } };

export const ASSISTANT_TOOLS: AssistantToolDef[] = [
  {
    name: 'get_plan',
    description: 'Read the project brief and the active floor: rooms with corners, areas, ceiling heights and floor finishes, walls with colours, doors, windows, furniture with centres, rotations, sizes, trades and how each is fixed (wall items: host wall and mounting height; ceiling items: drop), pipes, which lights each switch controls, plus what the person has selected.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_catalog',
    description: 'Search the furniture catalog by words and/or category. Returns catalog ids with default width × depth × height in cm.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string' },
      category: { type: 'string', description: 'Living Room, Bedroom, Kitchen, Bathroom, Office, Dining, Decor, Lighting, Electrical, Plumbing, Outdoor Furniture, …' },
    } },
  },
  {
    name: 'add_room',
    description: 'Add a room by rectangle (x, y, width, depth: top-left corner and size) or polygon corners, and name it. The corners are wall centre lines. Creates its walls at the default thickness; parts that already have a wall reuse it. For plans read from a drawing, use add_walls with real thicknesses instead.',
    input_schema: { type: 'object', properties: {
      name: { type: 'string' }, x: num, y: num, width: num, depth: num,
      polygon: { type: 'array', items: point, minItems: 3 },
    }, required: ['name'] },
  },
  {
    name: 'add_walls',
    description: 'Draw walls through a list of points on their centre lines, with one thickness in cm for the whole run. closed joins the last point back to the first. Rooms form wherever walls enclose a space. curves bends chosen segments (segment 0 runs from point 0 to point 1) towards a control point.',
    input_schema: { type: 'object', properties: {
      points: { type: 'array', items: point, minItems: 2 }, closed: { type: 'boolean' }, thickness: num,
      curves: { type: 'array', items: { type: 'object', properties: { segment: { type: 'integer' }, control: point }, required: ['segment', 'control'] } },
    }, required: ['points'] },
  },
  {
    name: 'add_openings',
    description: 'Add doors and windows to walls. offset is the distance in cm from the wall start to the opening centre.',
    input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      kind: { enum: ['door', 'window'] }, wallId: { type: 'string' }, offset: num, width: num,
      type: { type: 'string', description: 'door: single|double|sliding|french|pocket|bifold|opening; window: standard|fixed|casement|sliding|bay' },
    }, required: ['kind', 'wallId'] } } }, required: ['items'] },
  },
  {
    name: 'place_furniture',
    description: 'Place catalog items. x, y is the item centre in cm; rotation in degrees. Optional width and depth override the catalog size. Floor items: elevation lifts the bottom above the floor in cm. Wall items (search_catalog says wall-mounted) snap to the wall face nearest x, y, or to wallId, and face into the room on the side x, y is on; offset (cm from the wall\'s start to the item\'s centre, as for openings) places it exactly along the wall; rotation is ignored and elevation is the mounting height in cm. Ceiling items hang from the room\'s ceiling; drop is the distance in cm from the ceiling to the item\'s top (a pendant\'s cord). Returns the new ids and warnings about overlaps, blocked doors and items outside rooms.',
    input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      catalogId: { type: 'string' }, x: num, y: num, rotation: num, width: num, depth: num,
      elevation: num, drop: num, wallId: { type: 'string' }, offset: num,
    }, required: ['catalogId', 'x', 'y'] } } }, required: ['items'] },
  },
  {
    name: 'update_elements',
    description: 'Change existing elements by id. Furniture, stairs, columns: x, y, rotation, width, depth. Furniture also: elevation (floor items: bottom above the floor; wall items: mounting height), drop (ceiling items), wallId (move a wall item to another wall; x, y pick the spot and side), offset (a wall item\'s centre in cm from its wall\'s start; alone it slides the item along its wall). Rooms: name, ceilingHeight in cm (null goes back to the storey\'s height), floorMaterial. Doors and windows: offset, width, type. Walls: dx, dy shift the wall (walls joined to it stretch to follow), thickness, curve (control point) or straighten: true, color (both faces). Pipes: points, kind, diameter, run, elevation.',
    input_schema: { type: 'object', properties: { updates: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, x: num, y: num, rotation: num, width: num, depth: num,
      elevation: num, drop: num, wallId: { type: 'string' },
      name: { type: 'string' }, ceilingHeight: { type: ['number', 'null'] }, floorMaterial: { enum: floorMaterials.map(m => m.id) },
      offset: num, type: { type: 'string' }, dx: num, dy: num, thickness: num, curve: point, straighten: { type: 'boolean' },
      color: { type: 'string', description: `A wall colour id (${wallColors.map(c => c.id).join(', ')}) or #rrggbb.` },
      points: { type: 'array', items: point, minItems: 1 }, kind: { enum: ['cold', 'hot', 'waste'] }, diameter: num, run: { enum: ['floor', 'wall', 'ceiling'] },
    }, required: ['id'] } } }, required: ['updates'] },
  },
  {
    name: 'delete_elements',
    description: 'Delete rooms (their walls unless shared), walls, doors, windows, furniture, stairs, columns or pipes by id.',
    input_schema: { type: 'object', properties: { ids }, required: ['ids'] },
  },
  {
    name: 'switch_floor',
    description: 'Show another floor (by id or name from get_plan). Later tools work on that floor.',
    input_schema: { type: 'object', properties: { floor: { type: 'string' } }, required: ['floor'] },
  },
  {
    name: 'add_floor',
    description: 'Add a floor above the others and switch to it. start: empty, outer (copies the outer walls of the current floor, the default) or copy (all walls).',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, start: { enum: ['empty', 'outer', 'copy'] } } },
  },
  {
    name: 'view_drawing',
    description: 'Look at the drawing the person attached (the newest PDF or photo), or zoom into part of it. region is [x0, y0, x1, y1] in fractions of the page (0 to 1; x of its width, y of its height); leave it out for the whole page. Returns a picture with a blue grid labelled in those fractions.',
    input_schema: { type: 'object', properties: { page: { type: 'integer' }, region: { type: 'array', items: num, minItems: 4, maxItems: 4 } } },
  },
  {
    name: 'trace_drawing',
    description: 'Lay a page of the attached drawing under the plan at its real scale, so you and the person can trace it. a and b are two points on the page (fractions, as in view_drawing) that are distance cm apart in reality; origin is the point on the page that becomes plan (0, 0) (default a).',
    input_schema: { type: 'object', properties: {
      page: { type: 'integer' }, a: point, b: point, distance: num, origin: point,
    }, required: ['a', 'b', 'distance'] },
  },
  {
    name: 'view_plan',
    description: 'Look at the plan as a picture: walls, doors and windows over the traced drawing, with a grid labelled in cm. x, y, width, depth choose the area in cm (default: all the walls). Use it to read positions off the traced drawing and to check your walls against it.',
    input_schema: { type: 'object', properties: { x: num, y: num, width: num, depth: num } },
  },
  {
    name: 'check_plan',
    description: 'Run a check on the active floor and list what it finds. walkway: gaps narrower than minimum cm. room_size: rooms smaller than minimum m².',
    input_schema: { type: 'object', properties: { kind: { enum: ['walkway', 'room_size'] }, minimum: num }, required: ['kind'] },
  },
  {
    name: 'make_tool',
    description: 'Make a reusable check tool for the person. It appears as a card they can try, and stays available later. Give it a short name and a one-line description.',
    input_schema: { type: 'object', properties: {
      kind: { enum: ['walkway', 'room_size'] }, name: { type: 'string' }, description: { type: 'string' }, minimum: num,
    }, required: ['kind', 'name'] },
  },
  {
    name: 'show_tool',
    description: 'Switch on a tool made earlier (ids are listed by get_plan), optionally with a new minimum.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, minimum: num }, required: ['id'] },
  },
  {
    name: 'add_pipes',
    description: 'Draw water and waste pipes on the active floor (Plumbing). points is the run on the plan in cm; a riser is a single point, a vertical stack through the storey. run is where it is laid: in the floor screed, along the walls or under the ceiling. diameter is in mm (default 20 for cold and hot, 50 for waste); elevation is the height above the floor in cm (negative is in the screed; the default follows the run).',
    input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      kind: { enum: ['cold', 'hot', 'waste'] }, points: { type: 'array', items: point, minItems: 1 }, run: { enum: ['floor', 'wall', 'ceiling'] },
      diameter: num, elevation: num, riser: { type: 'boolean' },
    }, required: ['kind', 'points'] } } }, required: ['items'] },
  },
  {
    name: 'link_switch',
    description: 'Say which lights, fans or outlets a switch controls (Electrical). mode set (the default) replaces what the switch controls, and an empty targetIds removes its link; add and remove change it. The switch and its targets are furniture on the active floor.',
    input_schema: { type: 'object', properties: {
      switchId: { type: 'string' }, targetIds: ids, mode: { enum: ['set', 'add', 'remove'] },
    }, required: ['switchId', 'targetIds'] },
  },
  {
    name: 'view_3d',
    description: 'Look at the active floor in 3D, as it would be built: walls, doors, windows, furniture, lights and ceilings, including your proposal. Give room (id or name) for a view of that room from above at an angle, or from and to (plan points in cm) for an eye-level view from one point towards another; height is the eye height in cm (default 160). Leave everything out for the whole floor. Returns a picture.',
    input_schema: { type: 'object', properties: { room: { type: 'string' }, from: point, to: point, height: num } },
  },
  {
    name: 'read_skill',
    description: 'Read one of the design guides listed in your instructions.',
    input_schema: { type: 'object', properties: { name: { enum: SKILL_NAMES } }, required: ['name'] },
  },
  {
    name: 'update_brief',
    description: 'Replace the project brief with text: short notes on who the plan is for and what the person decided, wants and doesn\'t want for the whole project. Keep what still holds from the current brief (get_plan shows it). It is part of your proposal, so the person applies or discards it with your other changes.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'review_proposal',
    description: 'Have a second designer review your current proposal before you answer. It reads and looks at the plan as proposed, runs checks, and replies with concrete problems (with ids and fixes) or says it found none. Use it once per request, after bigger changes.',
    input_schema: { type: 'object', properties: {
      request: { type: 'string', description: 'What the person asked for, in your words.' },
      summary: { type: 'string', description: 'What you changed and why, including choices you made.' },
      focus: { type: 'string', description: 'Anything to check especially.' },
    }, required: ['summary'] },
  },
];

export const ASSISTANT_TOOL_NAMES = new Set(ASSISTANT_TOOLS.map(tool => tool.name));
/** Tools that only read; anything else starts a proposal. */
export const READ_ONLY_TOOLS = new Set(['get_plan', 'search_catalog', 'switch_floor', 'check_plan', 'make_tool', 'show_tool', 'view_drawing', 'view_plan', 'view_3d', 'read_skill', 'review_proposal']);
