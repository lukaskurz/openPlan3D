/**
 * What the Assistant is: its model, instructions and plan tools.
 * Shared by the browser (which runs the tools against the open plan) and the
 * server (which owns the prompt and tool list, so the endpoint can only be
 * used as this assistant).
 */

/**
 * Two modes. Chat (questions, edits, furnishing) runs on Sonnet. A message that
 * comes with a photo or PDF is usually a plan to rebuild, which takes careful
 * reading and many coordinates, so that turn runs on Opus at high effort.
 */
export type AssistantMode = 'chat' | 'build';

export const ASSISTANT_MODELS: Record<AssistantMode, { model: string; maxTokens: number; effort?: 'high'; maxRounds: number }> = {
  chat: { model: 'claude-sonnet-5-5', maxTokens: 16000, maxRounds: 16 },
  build: { model: 'claude-opus-5-5', maxTokens: 32000, effort: 'high', maxRounds: 30 },
};
/** The chat model, for logs and docs. */
export const ASSISTANT_MODEL = ASSISTANT_MODELS.chat.model;

/**
 * Beta features every request uses: thinking blocks are kept across tool
 * rounds (and dropped instead of failing when older turns were trimmed), and a
 * declined request is retried on Anthropic's recommended fallback model.
 */
export const ASSISTANT_BETAS = 'thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01';

type ModeBlock = { type?: unknown };
/** The mode for the turn in progress: build when the person's message that started it has a photo or PDF. */
export function assistantMode(messages: { role: string; content: ModeBlock[] }[]): AssistantMode {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user' || message.content.every(block => block.type === 'tool_result')) continue;
    return message.content.some(block => block.type === 'image' || block.type === 'document') ? 'build' : 'chat';
  }
  return 'chat';
}

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
- If the person attaches a floor plan (an architect's drawing, a sketch or a photo of one) to be drawn, rebuild it exactly:
  1. Read it first. Use view_drawing to zoom into the drawing wherever the numbers are small: its blue grid gives positions as fractions of the page. Then trace_drawing to lay the drawing under the plan at its real scale, using two points a known distance apart (two grid axes, or the ends of the longest dimension line, read off a zoomed view), and view_plan to read positions off it in cm. Pick an origin, such as a grid axis or the inside corner of an outer wall, and write down the positions you need in cm by adding up the dimension chains (the rows of numbers along dimension lines), checking each chain against its overall dimension. Read wall thicknesses from the drawing (outer and load-bearing walls are often 20–40 cm, partitions 8–15 cm). Note slanted walls, recesses, shafts, wall stubs, and openings without doors.
  2. Walls are drawn on their centre lines. A wall's centre is its inside face plus half its thickness, away from the room. Draw them with add_walls, one call per thickness, joining at shared corners so rooms close; rooms appear where walls enclose a space. Keep slanted walls slanted. Leave openings without a door open (no wall). Then name the rooms with update_elements.
  3. Add doors and windows from the drawing. Labels like 100/245 are width/height in cm. Full-height glazed openings onto a balcony or terrace are doors (balcony or french), not windows.
  4. Check: look at every part of the plan with view_plan; your walls are drawn over the drawing, so move any wall that doesn't sit on the drawn one. get_plan lists each room's area inside the walls. Compare it with the areas printed on the drawing and fix anything more than about 3% off before you answer. get_plan also names rooms with no door or opening: every room except shafts must be reachable, so add the missing door, or an opening where the drawing shows a passage without a door.
  If sizes are missing, estimate from typical door widths (about 80–90 cm) and say what you assumed. Leave out furniture drawn on the plan unless the person asks for it. For photos of a room or of furniture, use them to answer or to pick similar catalog items.
- If the person asks for a tool or check they can reuse, make one with make_tool. Two kinds exist: walkway (marks gaps between furniture, or furniture and walls, narrower than a minimum in cm) and room_size (marks rooms smaller than a minimum in m²). Use check_plan to answer questions about walkways or room sizes, and show_tool to switch on a tool made earlier.
- Help only with this plan, home design, layout and furnishing. Politely decline anything unrelated.
- Reply in the person's language. Keep replies short: 1–4 sentences, plain text, no headings or tables. Use the person's units. Don't show ids or coordinates unless asked.`;

type JsonSchema = Record<string, unknown>;
export interface AssistantToolDef { name: string; description: string; input_schema: JsonSchema }

const num = { type: 'number' };
const point = { type: 'array', items: num, minItems: 2, maxItems: 2 };
const ids = { type: 'array', items: { type: 'string' } };

export const ASSISTANT_TOOLS: AssistantToolDef[] = [
  {
    name: 'get_plan',
    description: 'Read the active floor: rooms with corners and areas, walls, doors, windows, furniture with centres, rotations and sizes, plus what the person has selected.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_catalog',
    description: 'Search the furniture catalog by words and/or category. Returns catalog ids with default width × depth × height in cm.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string' },
      category: { type: 'string', description: 'Living Room, Bedroom, Kitchen, Bathroom, Office, Dining, Decor, Lighting, Outdoor Furniture, …' },
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
    description: 'Place catalog items. x, y is the item centre in cm; rotation in degrees. Optional width and depth override the catalog size. Returns the new ids and warnings about overlaps, blocked doors and items outside rooms.',
    input_schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: {
      catalogId: { type: 'string' }, x: num, y: num, rotation: num, width: num, depth: num,
    }, required: ['catalogId', 'x', 'y'] } } }, required: ['items'] },
  },
  {
    name: 'update_elements',
    description: 'Change existing elements by id. Furniture, stairs, columns: x, y, rotation, width, depth. Rooms: name. Doors and windows: offset, width, type. Walls: dx, dy shift the wall (walls joined to it stretch to follow), thickness, curve (control point) or straighten: true.',
    input_schema: { type: 'object', properties: { updates: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, x: num, y: num, rotation: num, width: num, depth: num,
      name: { type: 'string' }, offset: num, type: { type: 'string' }, dx: num, dy: num, thickness: num, curve: point, straighten: { type: 'boolean' },
    }, required: ['id'] } } }, required: ['updates'] },
  },
  {
    name: 'delete_elements',
    description: 'Delete rooms (their walls unless shared), walls, doors, windows, furniture, stairs or columns by id.',
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
];

export const ASSISTANT_TOOL_NAMES = new Set(ASSISTANT_TOOLS.map(tool => tool.name));
/** Tools that only read; anything else starts a proposal. */
export const READ_ONLY_TOOLS = new Set(['get_plan', 'search_catalog', 'switch_floor', 'check_plan', 'make_tool', 'show_tool', 'view_drawing', 'view_plan']);
