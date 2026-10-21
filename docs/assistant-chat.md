# In-app Assistant

October 2, 2026. The ✦ Assistant button next to the tool strip opens a chat
docked on the right of the plan (Round 2 of the iPad redesign). The assistant
reads the plan, answers questions and edits it.

October 20, 2026: every turn runs on Claude Opus 5.5 (`claude-opus-5-5`) at
`xhigh` effort, with 64k tokens per call and up to 60 calls per message
(`ASSISTANT_CONFIG` in `definitions.ts`). Before, questions and edits ran on
Sonnet 5.5 and only messages with a photo or PDF switched to Opus; each switch
lost the prompt cache and the earlier reasoning. Replies to design questions
may now be as long as the question needs; edits are still confirmed in a
sentence or two.

## How a message is handled

1. The browser sends the conversation to `POST /api/assistant/chat`.
2. The server adds the API key, the fixed system prompt and the eight plan
   tools ([`src/lib/assistant/definitions.ts`](../src/lib/assistant/definitions.ts)),
   calls the Messages API with streaming and prompt caching, and streams the
   reply straight back. It accepts only conversations shaped like this
   assistant's and always sends its own prompt and tools, so the endpoint
   can't be used as a general proxy. A tool the model invents gets an error
   result, and the conversation carrying it is still accepted.
3. When the model calls a tool, the **browser** runs it against the open plan
   ([`planTools.ts`](../src/lib/assistant/planTools.ts)) and sends the result
   back in the next request. The plan never leaves the device except as tool
   results inside the conversation.
4. The first editing tool starts a **preview** (`beginPreview` in
   `stores/project.ts`). The changes are drawn on the plan with dashed
   outlines, and autosave waits. **Apply** turns everything since the preview
   started into one undo step; **Not now**, or pressing undo, puts the plan
   back exactly as it was. The model is told which one happened with the next
   message.

Tools: `get_plan`, `search_catalog`, `add_room`, `add_walls`, `add_openings`,
`place_furniture`, `update_elements`, `delete_elements`, `add_pipes`,
`link_switch`, `switch_floor`, `add_floor`, `check_plan`, `make_tool`,
`show_tool`, `view_drawing`, `trace_drawing`, `view_plan`, `view_3d`,
`read_skill`, `update_brief`, `review_proposal`. The browser runs them through
[`tools.ts`](../src/lib/assistant/tools.ts). Placement tools reply
with warnings for overlaps, items outside rooms, items through walls and
blocked doors, and the prompt asks the model to fix them before it answers.

- **Heights and trades.** `get_plan` gives the floor's default ceiling height
  and each room's (marked when it is the room's own), floor finishes, wall
  colours, each item's trade and how it is fixed (wall items: host wall, the
  way they face and mounting height; ceiling items: drop and bottom height),
  pipes and switch links. `place_furniture` snaps wall items (outlets,
  switches, sconces) to the wall face nearest the point, or to `wallId`, and
  takes `elevation` (mounting height) and `drop` (ceiling items); heights are
  checked against the room's ceiling. `update_elements` also sets a room's
  `ceilingHeight` (`null` resets it) and `floorMaterial`, a wall's `color`
  (both faces) and a pipe's points, kind, diameter, run and elevation.
  `add_pipes` draws water and waste runs and risers, `link_switch` says what a
  switch controls. Wall and ceiling items don't warn about the furniture
  under them; they warn instead when they sit in a door or window opening,
  overlap on the wall, face outside, reach above the ceiling, or (ceiling
  items) leave less than 200 cm headroom with no table, bed or counter under
  them.
- **Light output.** Light fixtures (`isLightFixture`) report what they give in
  `get_plan` and `search_catalog`: lumens, colour temperature, beam angle for
  spots, tilt and dimming, with "(set: …)" naming the fields the item
  overrides. `place_furniture` and `update_elements` take a `light` object
  with any of those fields, checked against `FIXTURE_LIGHT_RANGES` (beam angle
  5–140°, as the 3D view renders it); null clears a field, `light: null` all
  of them, and items that give no light, or a beam on a fixture that shines
  all round, are refused. The values come from
  [`fixturePhotometry.ts`](../src/lib/utils/fixturePhotometry.ts), which holds
  the catalog defaults without three, so the assistant and the Inspector don't
  load the 3D engine for them. The lighting guide says how to size lumens from
  a room's lumen budget and pick colour temperature, beam and tilt.
- **Looking in 3D.** `view_3d` renders the active floor, proposal included,
  from a room overview at 45° (near walls cut away), an eye-level view from
  one plan point towards another, or the whole floor
  ([`view3d.ts`](../src/lib/assistant/view3d.ts)). The 3D viewer registers a
  capture function while it is mounted
  ([`viewer3dCapture.ts`](../src/lib/stores/viewer3dCapture.ts)); if the
  person is in 2D the tool opens 3D, waits up to 15 s for the scene and its
  models, takes the picture with its own camera and offscreen renderer, and
  goes back to 2D with the selection restored. The person's own 3D camera is
  never moved.
- **Design guides.** Each guide is a markdown file in
  [`src/lib/assistant/skills/`](../src/lib/assistant/skills/) with a name and
  a one-line description. The prompt lists the descriptions; `read_skill`
  returns the whole guide, so the knowledge costs nothing until a request
  needs it. Guides: lighting, electrical, plumbing, kitchen, bathroom,
  furnishing, accessibility and rebuild-drawing. To add one, drop a file in
  the folder; the prompt and the tool's list pick it up.
- **Project brief.** `Project.brief` holds short notes on who the plan is for
  and what the person decided, wants and doesn't want. It is saved with the
  project (and in project packages, though not in the native `plan.json`),
  shared by all alternatives, and separate from the description printed on
  drawings. `get_plan` shows it first, `update_brief` replaces it as part of
  the proposal, and the person can read and edit it at the top of the panel
  ([`AssistantBrief.svelte`](../src/lib/components/chrome/AssistantBrief.svelte));
  editing waits while the assistant works or a proposal is pending.
- **Reviewer.** October 20, 2026. After a bigger change the proposal is
  checked by a second agent before the person sees it
  ([`reviewer.ts`](../src/lib/assistant/reviewer.ts)). The Assistant can ask
  for it with `review_proposal` (with what to check especially); if it
  finishes without asking and the proposal adds, changes or removes at least
  4 elements, the browser runs the review anyway. The reviewer runs on Opus
  5.5 at high effort with its own prompt and only the read-only tools that
  leave the view alone (`get_plan`, `search_catalog`, `check_plan`,
  `view_drawing`, `view_plan`, `view_3d` and `read_skill`). Outlets and
  switches are 2D symbols only, so it checks electrical work from `get_plan`. It
  gets what the person asked, the Assistant's summary and the ids in the
  proposal, and replies with at most 8 problems, each with the ids and a
  fix, or "No problems found.". Its reply goes back to the Assistant (as the
  tool's result, or as a bracketed note after an automatic review), which
  fixes what holds up and answers again; that answer replaces the first one
  in the panel. "No problems found." after an automatic review ends the turn
  without another call. At most 2 reviews per message; a failed review is
  reported to the Assistant instead of failing the message. The browser
  sends reviewer calls with `agent: "reviewer"`; the server builds them from
  its own reviewer prompt and tools and refuses any other agent or a
  reviewer conversation that uses an editing tool. Logs mark them
  `"agent":"reviewer"`. In a 4 × 5 m bedroom test the review took about 30 s
  and caught walkways under 60 cm next to the wardrobe.

- **Floors.** `get_plan` describes the floor on screen and lists the others;
  `switch_floor` changes the floor the person sees, `add_floor` adds one (empty,
  outer walls or all walls). A new floor is part of the proposal.
- **Curved walls.** Walls take a quadratic control point (`curves` in
  `add_walls`, `curve`/`straighten` in `update_elements`); openings on curved
  walls are measured along the curve.
- **Thinking.** The model thinks adaptively. Requests set `display: "updates"`
  (beta `thinking-display-updates-2026-08-18`), so the short progress notes it
  writes between tool calls arrive as thinking text and show in the panel while
  a long turn runs. Thinking blocks are kept in the conversation and sent back unchanged, so reasoning carries across tool
  rounds. Trimming older turns invalidates their blocks, so requests set
  `prefix_mismatch_behavior: "drop_block"` (beta
  `thinking-binding-controls-2026-08-01`) and those blocks are dropped
  instead of failing.
- **Refusal fallback.** Requests set `fallbacks: "default"` (beta
  `server-side-fallback-2026-07-01`): a declined request is retried on
  Anthropic's recommended fallback model. After a mid-reply switch only the
  text from before it is kept (`keptBlocks` in `stream.ts`).
- **Rebuilding a drawing.** The rebuild-drawing guide walks the model through reading an
  architect's drawing: add up the dimension chains from an origin, draw walls
  on their centre lines with real thicknesses, treat glazed balcony openings as
  doors, then check. `get_plan` gives each room's area inside the walls (to
  compare with the printed areas) and names rooms with no door or opening.
  Three tools let it look ([`drawings.ts`](../src/lib/assistant/drawings.ts)):
  `view_drawing` zooms into the newest attached PDF or photo with a grid in
  page fractions; `trace_drawing` lays a page under the plan at real scale
  from two points a known distance apart (the floor's background image, as
  "Trace a photo or drawing" does); `view_plan` renders an area of the plan in
  cm, walls over the traced drawing, to read positions and to check the result.
  Their pictures go back as image blocks in the tool result; older ones become
  a note at the next message. PDFs are rendered with pdf.js in the browser.
  The original files are kept in memory only, so after a reload the person
  attaches the drawing again.
- **Photos.** The + button (or pasting) attaches up to three photos, or photos and one PDF up to 3 MB, per
  message. The browser shrinks them to 1568 px JPEG; the server accepts only
  base64 JPEG/PNG/WebP/GIF image blocks. Only the two newest photo messages are
  resent; older ones become a placeholder.
- **Tools the assistant builds.** A tool is data, not code: a check kind
  (`walkway` gaps narrower than a minimum in cm, or `room_size` rooms smaller
  than a minimum in m²), a name and a minimum
  ([`checks.ts`](../src/lib/assistant/checks.ts)). It shows as a card with
  Try it; the plan marks findings in red and a bar adjusts the minimum. Tools
  are kept in this browser (`o3d_assistant_tools`) and listed to the model by
  `get_plan`, so "show me the walkway check" works later.
- **Conversations are kept** per project in this browser, with a history:
  New chat keeps the current chat, and the clock button lists the project's
  chats (titled by the first message) to switch back to or delete. Each chat is
  stored as `o3d_assistant_chat_<project id>:<chat id>` (photos stripped, about
  1 MB at most), and `o3d_assistant_chats_<project id>` lists them and remembers
  the open one; at most 30 are kept, oldest dropped first. A conversation saved
  before history existed (`o3d_assistant_chat_<project id>`) becomes the first
  chat in the list. A proposal still pending at a reload is gone (previews are
  never saved), so it is shown as not applied and the model is told.
- **Drawing on the plan.** The pen button next to + lets the person scribble
  over the plan ([`sketch.ts`](../src/lib/assistant/sketch.ts),
  `SketchLayer.svelte`); scrolling and pinching still move the plan, Esc or
  Done finishes. The strokes are kept in plan cm, so they stay put while the
  view moves. The sketch goes with the next message as a picture of that part
  of the plan as it is on screen, strokes in red and numbered, plus a text
  block listing each stroke's points in plan cm (simplified, and marked when a
  stroke circles an area), so "put a desk here" has a here. On narrow screens the panel steps aside while
  drawing.
- **Own API key.** The key button in the panel stores an Anthropic key in this
  browser (`o3d_anthropic_key`). With a key, the browser calls the Messages
  API directly (`anthropic-dangerous-direct-browser-access`), with the same
  prompt, tools and caching, billed to that key; openPlan3D's server and its
  limits are not involved.

## Setup

Static hosting (Cloudflare Pages, `BUILD_TARGET=static`): there is no server,
so the Assistant runs only with each person's own Anthropic API key. On
opening, the panel asks the server whether it can run the Assistant
(`GET /api/assistant/chat` answers `{ available }`); on a static site that
request fails, and instead of the input the panel shows a short note and an
**Add API key** button. For a family, create one key per person in the
Anthropic Console, each in its own workspace with a monthly spend limit, so
Anthropic enforces the budget and a key can be revoked on its own.

Local development: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`
(a Claude Console key, billed pay-as-you-go). Restart `npm run dev`.

Firebase App Hosting (Node build): store the key as a secret and reference it
in `apphosting.yaml`:

```bash
firebase apphosting:secrets:set anthropic-api-key
```

```yaml
  - variable: ANTHROPIC_API_KEY
    secret: anthropic-api-key
    availability:
      - RUNTIME
```

Without a key the endpoint returns 503 and, as on a static site, the panel
asks for the person's own key. `ASSISTANT_CHAT_UPSTREAM` overrides the API
base URL (tests and local fakes). A server with a key serves anyone who can
reach it, limited only per client address (below), so don't deploy one with a
key on a public URL.

## Development with your Claude subscription

Set `ASSISTANT_DEV_CLAUDE=1` in `.env` and restart `npm run dev`. The chat
then runs on your own Claude plan through Claude Code instead of an API key:
each conversation gets one `claude -p --input-format stream-json` process
(Opus 5.5 at `xhigh` effort, the same system prompt, no built-in tools and none of your own
MCP servers or settings). Its plan tools come from
[`tooling/assistant-dev-bridge.mjs`](../tooling/assistant-dev-bridge.mjs),
which hands every call to the browser and waits for the result, so the
browser side is exactly the same as in production. The server is
[`assistantDevClaude.ts`](../src/lib/server/assistantDevClaude.ts).

- Needs Claude Code installed and signed in (`claude` on the PATH, or set
  `ASSISTANT_DEV_CLAUDE_BIN`). `ANTHROPIC_API_KEY` is removed from its
  environment so it always uses your subscription.
- Only under `vite dev`; production builds ignore the setting.
- Usage counts against your plan's limits. Each finished message logs
  `{"event":"assistant_chat_dev", turns, apiEquivalentUsd}`, which is what the
  same message would cost through the API.
- A review runs in its own `claude -p` process (the reviewer's prompt, model
  and tools; the bridge gets `BRIDGE_AGENT=reviewer`), which ends once the
  reviewer has answered.
- Stop ends the conversation's process; the next message starts a new one with
  the earlier messages as context. Idle processes end after 30 minutes and
  all of them exit with the dev server.
- This is for trying the assistant yourself. A subscription can't serve other
  people's chats, so deployments need the API key above.

## Limits and cost

Per client address (first `X-Forwarded-For` entry): 120 model calls per 10
minutes and 600 per day; 300 calls per minute for the whole server, and the
counters are kept in memory for each instance. A message usually takes 2–8
model calls; drawing a whole flat takes about 20. Requests are capped at
12 MB (room for photos, a PDF and the drawing tools' pictures), and the browser keeps only the newest plan readout in
the history.

Measured with Sonnet 5.5 at list prices (September 2026 harness, 75 m²
apartment): a question cost about $0.02, a small edit $0.02, furnishing a
room $0.03, rearranging a room $0.04, and drawing and furnishing a whole flat
$0.13. Opus 5.5 costs twice as much per token ($4 / $20 per million input /
output tokens) and `xhigh` thinks more, so expect several times those
figures until the harness is re-run. Each call logs `{"event":"assistant_chat", model, input, output,
cacheRead, cacheWrite}` (token counts only, never content), so real costs can be read
from the server logs.
