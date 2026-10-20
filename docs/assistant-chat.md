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
   reply straight back. It accepts only conversations that use this
   assistant's tools, so the endpoint can't be used as a general proxy.
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
`place_furniture`, `update_elements`, `delete_elements`, `switch_floor`,
`add_floor`, `check_plan`, `make_tool`, `show_tool`. Placement tools reply
with warnings for overlaps, items outside rooms, items through walls and
blocked doors, and the prompt asks the model to fix them before it answers.

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
- **Rebuilding a drawing.** The prompt walks the model through reading an
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

Local development: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`
(a Claude Console key, billed pay-as-you-go). Restart `npm run dev`. Without
`ASSISTANT_ALLOWED_EMAILS` the local assistant stays open, as before sign-in
existed.

Firebase App Hosting: the key and the list of invited people are secrets
(the repository is public, so emails never go in `apphosting.yaml`, which
only references them). Create both before deploying; a rollout fails while a
referenced secret is missing:

```bash
firebase apphosting:secrets:set anthropic-api-key
firebase apphosting:secrets:set assistant-allowed-emails
```

The second is a comma-separated list of Google account emails. Google must
be enabled as a sign-in provider in Firebase Authentication for project
`openplan3d`, with the app's domain on its authorized domains.

Without a key, or in production without the allowlist, the endpoint returns
503 and the panel says the assistant isn't available on this server.
`ASSISTANT_CHAT_UPSTREAM` overrides the API base URL (tests and local fakes).

## Sign-in and budgets

October 20, 2026. Once the app is shared, the server's key serves only
invited people ([`assistantAuth.ts`](../src/lib/server/assistantAuth.ts),
[`assistantBudget.ts`](../src/lib/server/assistantBudget.ts),
[`account.ts`](../src/lib/assistant/account.ts)).

- **Sign-in.** The panel signs in with Google through Firebase Auth and sends
  the Firebase ID token with every request. The server checks it with
  Google's published keys (node:crypto, no Admin SDK): project, issuer,
  expiry and a verified email, which must be on `ASSISTANT_ALLOWED_EMAILS`.
  No token is 401 (`code: "sign-in"`), an email not on the list 403
  (`code: "not-allowed"`). People with their own API key need neither.
- **Budgets.** Each person may spend `ASSISTANT_DAILY_USD` (default $5) per
  UTC day and `ASSISTANT_MONTHLY_USD` (default $50) per calendar month. Each
  call is priced from the token counts in its stream (cache reads and writes
  included, a stopped reply too) and charged when the stream ends, so one
  call can overrun a little. A person over budget gets 429
  (`code: "budget"`) with `Retry-After` until the reset. Spend is kept in
  one zero-byte object per person in `HANDOFF_BUCKET`
  (`_system/assistant-budget-<sha256 of the email>`, compare-and-swap on its
  metadata, so every instance sees it); without a bucket, in memory. If the
  ledger can't be read, requests are refused rather than left unbounded.
- **`GET /api/assistant/me`** tells the panel which case applies: not
  available, open (local development), sign in, not invited, or allowed with
  today's and this month's spend. The panel shows a sign-in button, a
  not-invited note with Sign out, or the budget line under the input; Sign
  out is in the chats menu.
- **Progress notes.** While a long turn runs, the activity line shows the
  model's latest progress note instead of "Thinking…".

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
- Stop ends the conversation's process; the next message starts a new one with
  the earlier messages as context. Idle processes end after 30 minutes and
  all of them exit with the dev server.
- This is for trying the assistant yourself. A subscription can't serve other
  people's chats, so deployments need the API key above.

## Limits and cost

Per signed-in person (or per client address, the first `X-Forwarded-For`
entry, where sign-in isn't required): 120 model calls per 10 minutes and 600
per day, on top of the dollar budgets above; 300 calls per minute for the whole server, and the
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
cacheRead, cacheWrite, usd}` (token counts and cost only, never content), so real costs can be read
from the server logs.
