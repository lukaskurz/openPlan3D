# Assistant test set

October 20, 2026; 8 cases for trades, light, the 3D view and the brief added
October 21. A runnable evaluation of the in-app Assistant
([assistant-chat.md](assistant-chat.md)). Each case starts from a known plan,
sends one message (two for `brief-remember`) through the real conversation loop
([`session.ts`](../src/lib/assistant/session.ts) `send`) with the own-key path
(the Messages API called directly, as the browser does with a person's key),
applies the proposal if there is one, and scores the result twice:
deterministic checks on the final plan, and a grader call to Claude Opus 5.5
against a short rubric. It runs in Node under vitest, separately from
`npm test`.

Files are in [`tooling/assistant-eval/`](../tooling/assistant-eval/):
`cases.ts` (the cases), `helpers.ts` (starting plans and plan checks),
`run.eval.ts` (the runner), `recorder.ts` (watches the API calls),
`grader.ts`, `pricing.ts` (the price table), `fake.ts` (the dry run's fake
API) and `compare.mjs`.

## What it covers

24 cases, English and German, on three starting plans: an empty plan, a
two-room flat (living room 5.0 × 4.0 m, bedroom 4.0 × 4.0 m) and a 75 m²
apartment (living room, kitchen, hall with the entrance, bathroom, storage,
bedroom; every room opens off the hall).

| Case | What is asked |
|---|---|
| `q-living-area` | Size and windows of the living room (no edits expected) |
| `q-gap-de` | Space between bed and wardrobe, in German (no edits expected) |
| `edit-move-sofa` | Move the sofa against the right wall, facing the room |
| `edit-rename-door-de` | Rename a room and widen a door to 100 cm |
| `furnish-bedroom` | Double bed, two nightstands, wardrobe |
| `furnish-living-de` | Sofa facing the TV, coffee table, dining for four |
| `rearrange-living` | Fix a bad layout: sofa faces TV, doors clear, keep every item |
| `light-kitchen-dining-de` | Pendants over the dining table at the right height, spots over the worktop |
| `electrical-kitchen` | Outlets above the worktop and for appliances, a switch by the door |
| `bathroom-de` | Shower, WC, basin, washer, lights and an outlet, respecting the zones |
| `hall-barrier-free-de` | Wheelchair check of the hall: door widths and corridor width, fixed |
| `build-flat-de` | Draw a five-room flat from inside dimensions and wall thicknesses |
| `furnish-flat` | Furnish living room, bedroom, kitchen and bathroom at once |
| `ambiguous-nicer` | "Make it nicer." |
| `make-walkway-tool` | A reusable walkway check with an 80 cm minimum |
| `decline-taxes-de` | Tax return help, which it should decline politely |
| `light-dining-pendant` | Two pendants 65 cm above the table, warm white, dimmed to half |
| `light-living-layers` | General, accent and reading light in the living room, warm |
| `spots-kitchen-worktop` | Recessed spots along the worktop at 4000 K with a 36° beam |
| `electrical-switches` | Switches inside the living-room and bedroom doors, linked to the ceiling lights; outlets either side of the bed |
| `plumbing-bathroom` | Cold, hot and waste pipes to shower, basin and WC from a riser |
| `brief-remember` | Two messages: a decision goes into the brief, then a kitchen redo honours it |
| `view3d-check` | Is the pendant (40 cm above the table) too low? Look and fix it |
| `skill-bathroom-zones-de` | Bathroom lights and a hair-dryer outlet; read the guide, respect the zones |

The last eight start from the apartment with a few items placed for them
(`livingSet`, `bathroomFixtures`, ceiling lights and a bed, a pendant hung
too low). On October 21 the trade cases also gained checks on the new fields:
`light-kitchen-dining-de` checks that pendants are warm white and that spots
are light fixtures rather than plan symbols, `electrical-kitchen` that outlets
are hosted by a wall, and `bathroom-de` that a light hangs over the basin at
150 cm or higher. Totals from runs before that date are not comparable for
those three cases.

Checks read the final project directly, not the tools' text, so they keep
working as the tools change. Items are found by catalog name and category, not
fixed ids. Among them: furniture inside its room, no overlaps (the placement
tools' 3 cm margin), nothing through walls, door swings clear, nothing tall in
front of windows, walkways of at least 60 cm (the `check_plan` walkway check,
leaving out chairs at tables, coffee tables and nightstands, and gaps measured
through a wall), backs of beds and wardrobes against walls, the sofa facing the
TV, every room reachable from the entrance, room areas inside the walls within
3% for the rebuilt flat, pendants ceiling-mounted with their bottom 55–80 cm
above the table top, outlets wall-mounted at sensible heights (at least two at
95–125 cm over the worktop), a switch at 85–115 cm by the kitchen door, no
outlets within 60 cm of the shower, and, for questions, a plan that did not
change.

The newer cases read the trade data the same way. Light checks use the
fixture's photometry as the 3D view resolves it (`resolveFixtureLight`: the
item's `light` overrides over the catalog's defaults), so a plan symbol such as
`sym_ceiling_light` counts as a light without photometry and fails them:
colour temperature, dimming (0.35–0.65 for "about half"), beam angle, and
total lumens times dimming per m² of the room (100–300 lm/m² for the living
room). Switches must be inside the room within 60 cm of the door edge, on the
wall at 95–115 cm, with a switch link (`Floor.switchLinks`) to that room's
ceiling light. Pipes count for a fixture when a run of the right kind starts or
ends within 40 cm of it; waste pipes must be in the floor or wall and at least
40 mm. The brief is read from `Project.brief`. Two checks read the tool calls
instead of the plan: `view3d-check` wants a `view_3d` call and
`skill-bathroom-zones-de` a `read_skill` call for the bathroom or electrical
guide.

[`tests/assistant-eval-cases.test.ts`](../tests/assistant-eval-cases.test.ts)
checks the checks without a model, as part of `npm test`: for the eight new
cases and cases 8–10, the starting plan must fail and a hand-made good answer
must pass every check, and six answers with one deliberate mistake each (no
switch link, an outlet in zone 2, default colour temperature, pendants 40 cm
above the table, a WC without pipes, an island) must fail the check meant for
it.

## Running it

```bash
ANTHROPIC_API_KEY=sk-ant-… npm run eval:assistant
```

The key is used the same way as a person's own key in the panel. Settings,
all optional:

| Variable | Default | |
|---|---|---|
| `EVAL_CASES` | all | Comma-separated case ids |
| `EVAL_REPEATS` | 1 | Runs per case |
| `EVAL_MAX_USD` | 15 | No new case starts once the run has spent this much (it says so) |
| `EVAL_REVIEW` | on | `off` switches off the reviewer (`reviewEnabled` in `reviewer.ts`) |
| `EVAL_LABEL` | `run` | Goes into the result file names |
| `EVAL_DRY` | | `1` runs against a scripted fake API, without a key and at no cost |
| `EVAL_COMPARE` | | `a.json,b.json` prints a comparison instead of running cases |

Without `ANTHROPIC_API_KEY` (and without `EVAL_DRY`) every case is skipped
with a message, and the run passes.

Cases run one at a time in one worker (the session is a module singleton),
each with up to 15 minutes. Each case resets the plan, starts a new
conversation, builds its starting plan, sends the prompt (and any follow-up
messages, applying a pending proposal before each, as the person would),
applies a pending proposal, runs the checks and the grader. The grader sees
all the messages, numbered. The runner records the final reply,
errors shown in the chat, every tool call with its input and result (the
assistant's and the reviewer's), the number of model calls, wall time, token
usage and cost, by wrapping `fetch` and reading a copy of each event stream.

Results go to `tooling/assistant-eval/results/<timestamp>-<label>.json`
(everything, including both plan readouts) and a `.md` summary next to it:
per case checks passed, grade, calls, cost and seconds, then totals. The files
are rewritten after every case, so a stopped run keeps what it finished. The
folder is git-ignored.

The dry run proves the harness without spending anything:

```bash
EVAL_DRY=1 npx vitest run --config vitest.eval.config.ts
```

It runs `q-living-area` and `furnish-bedroom` (or `EVAL_CASES`) through the
real loop against a fake API that reads the plan, places a nightstand and
answers, with a fixed grade, and asserts that calls, tool results, the applied
proposal, checks, grade and costs were all recorded. Its checks mostly fail;
that is expected.

## Grading

One request per case to `claude-opus-5-5` (`max_tokens` 8000, adaptive
thinking, effort `high`, a JSON schema output): every rubric criterion scored
1–5 with a one-line reason, an overall score 1–5 and a short summary. The
grader sees the person's message, `get_plan` before and after, the tool calls,
the reply, errors shown in the chat and the check results; it is told that
failed checks are measured facts. A refusal or a truncated answer is recorded
as a grader error, not a score. The grader has no fallback model, so every
score comes from the same model.

## Cost

Prices are in [`pricing.ts`](../tooling/assistant-eval/pricing.ts) (per
million tokens: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 /
$0.50, cache reads and 5-minute cache writes as listed there). A model
missing from the table costs $0 and is listed under `unpricedModels`.

Measured on October 20 with the Sonnet assistant, one run each of
`furnish-bedroom`, `furnish-living-de` and `rearrange-living`: $0.08–0.10 per
case with the reviewer off, $0.13–0.21 with it on (the reviewer alone
$0.04–0.09 per review), grader included. The assistant now runs on Opus 5.5 at
`xhigh`, so expect more per case; measure again before relying on the figures
below.

An earlier estimate for one pass over the first 16 cases, not a measurement: the
assistant's fixed prompt and tools are about 3,500 tokens (cached after the
first call), a plan readout of the apartment about 1,000. The assistant
(Sonnet 5.5) costs roughly $0.5–1 (from the September figures in
assistant-chat.md: $0.02 for a question up to $0.13 for drawing a flat). The
grader costs about $0.05–0.10 per case (4–8k tokens in, 1.5–4k out), $1–1.5
in all. The reviewer (Opus 5.5 at high effort, up to two reviews of several
calls each per message) is the largest and least certain part, roughly $1.5–5
over the eleven or so editing cases. So about $3–8 per pass with the reviewer
on and $1.5–3 with it off; a pass takes 10–25 minutes. The default budget of
$15 covers two or three passes. Run two or three cases first
(`EVAL_CASES=…`) to see real figures; the summary prints them per case.

## Comparing two runs

```bash
node tooling/assistant-eval/compare.mjs tooling/assistant-eval/results/a.json tooling/assistant-eval/results/b.json
# or
EVAL_COMPARE=a.json,b.json npm run eval:assistant
```

It prints per case (repeats averaged) checks passed, grade and its change,
model calls, cost and seconds for both runs, then totals over the cases both
runs have. A typical use is the reviewer on and off:

```bash
EVAL_LABEL=review npm run eval:assistant
EVAL_LABEL=no-review EVAL_REVIEW=off npm run eval:assistant
```

## Limitations

- **Browser-only parts.** Two tools need a browser and don't work in this
  run. `view_3d` waits for the editor's 3D viewer, which never mounts in
  Node, and after 15 seconds answers "The 3D view did not open in time, so
  there is no picture" as a tool error; each call costs those 15 seconds.
  `view3d-check` still counts the call (the check is "it looked"), but the
  model gets no picture and has to judge from the heights in `get_plan`, so
  the case measures the decision and the fix, not reading a 3D picture. To
  test the pictures themselves, try the case in the browser panel. The same
  goes for reviews: the reviewer's `view_plan` and `view_3d` both fail here.
- **Node, not a browser.** `view_plan` draws on a canvas
  (`document.createElement`), which doesn't exist in Node: the tool returns
  "error: the tool failed (document is not defined)" to the model, as a tool
  error, and logs it. The assistant and the reviewer can't look at the plan as
  a picture here and fall back on `get_plan`, so results can differ from the
  browser, especially for reviews. `view_drawing` and `trace_drawing` answer
  that no drawing is attached, since no case attaches one: photos, PDFs and
  sketches (and with them the Opus build mode) are not covered yet.
- Graders vary between runs; small changes in mean grade mean little on one
  pass. Use `EVAL_REPEATS` for decisions, and look at the checks first.
- Checks are strict and simple: a room is found by name, walkways use the
  same geometry as `check_plan`, heights use the mounting rules in
  `utils/mounting.ts`. A clever answer the checks don't foresee can fail a
  check; the grader is told it may say so.
- Only `brief-remember` has a second message, and it always applies the
  first proposal. Undo, discarded proposals and long conversations are not
  exercised.
- Calls go straight to Anthropic with the key, so the server's limits and its
  logging are not involved. A 429 shows as an error in the case's chat errors.
