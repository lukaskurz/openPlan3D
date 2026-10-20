---
name: kitchen
description: Designing, laying out or furnishing a kitchen: choosing a layout (single run, galley, L, U, island, peninsula), work zones and triangle, worktop and wall-cabinet heights, clearances, placing sink, hob, oven, fridge and dishwasher, kitchen lighting and outlets.
---
# Kitchen layout

Sizes in cm. Sources: German kitchen practice (AMK, the German kitchen industry association), the NKBA work triangle, and DIN 18011 (withdrawn, but still the usual reference for clearances). The plumbing and the shaft decide where the sink can go; check them first.

## 1. Work zones and order
- Five zones in a row: storage (fridge, pantry) → crockery and cutlery → sink and dishwasher → main prep surface → hob and oven. For right-handers they run from right to left; mirror it for left-handers (ask who cooks most).
- Main prep surface between sink and hob: at least 60, ideally 90–120.
- Beside the hob at least 30–40 free worktop on both sides; never at the end of a run, against a wall or next to a tall unit or the fridge.
- Beside the sink at least 60 for setting down dishes; the dishwasher directly next to the sink (its hose goes to the sink trap), not in the corner, where its open door would hit handles.
- Beside the fridge's opening side about 30–40 of worktop to set things down; fridge at the end of a run and not right next to the hob or oven.
- Work triangle (sink, hob, fridge; NKBA): each leg 120–270, all three together at most about 790 (European sources often say 400–700); no main walkway through the triangle, no island cutting a leg.
- Hob not under a window (curtains, hood) and not right beside a door; the sink under the window works well.

## 2. Heights and depths
| What | Size |
|---|---|
| Worktop height | elbow height minus 10–15. By body height (AMK): 150–160 → 80–85; 160–170 → 85–90; 170–180 → 90–95; 180–190 → 95–100; 190–200 → 100–105. Standard kitchens are about 86–91 |
| Worktop depth | 60 (60–65; 65–70 gives more room). Base unit carcass 56 |
| Wall cabinets | 35 deep (30–40), bottom 50–60 above the worktop (about 140–150 from the floor); the top shelf should be reachable (about 180–190, RoT) |
| Hood | at least as wide as the hob; 65 above an electric or induction hob, 65–75 above gas (follow the manufacturer) |
| Oven in a tall unit | door top at about chest height; the oven tray at about elbow height (RoT) |
| Island or bar seating | overhang 25–30 at worktop height (knees), 30–35 at bar height (about 110); 60 wide per stool |

## 3. Clearances
- Between two runs, or a run and an island: at least 120 (DIN 18011), 100–110 as an absolute minimum for one cook, 120–150 for two cooks or where oven and dishwasher doors open opposite each other.
- In front of a run against a wall or a table: at least 120 where people work, 90 where people only pass.
- Behind stools at an island: 90–110 to pass.
- Open dishwasher and oven doors stick out about 60: the space in front stays free and the doors don't block a walkway or a door swing.
- Corner: leave a filler of about 5–10 so drawers and doors at the corner can open past the handles.

## 4. Layouts
| Layout | When | Rules |
|---|---|---|
| Single run | narrow rooms, kitchenettes | 240–360 long; fridge at one end, sink in the middle, hob with 30–40 beside it at the other end |
| Galley | rooms about 240–300 wide | runs 120–150 apart; sink and hob on one side, fridge and tall units on the other, or sink on one side and hob opposite but offset |
| L | most family kitchens | sink and hob on different legs or on one leg with 90–120 between; fridge at the end of a leg; keep the corner for storage, not appliances |
| U | rooms at least 240 wide inside (60 + 120 + 60) | three working sides; avoid appliances in both corners |
| Island | kitchen-living rooms; room depth about 400+ (60 run + 120 + island 90–120 + 120) | island ≥ 90 deep (≥ 100–120 with hob or sink and seating), ≥ 180 long; 120 all around; a hob on an island needs a hood above or a downdraft; sink or hob on the island needs water, waste and power through the floor |
| Peninsula | open kitchens without room for an island | like an L with a free end; 100–120 to pass at the end; can carry seating on the living side |

## 5. Light, outlets, water
- Light: ≥ 500 lx on the worktop from under-cabinet lights shielded to the front; ambient downlights about 100 from the wall with wall cabinets (just in front of the fronts) or about 60 without; island pendants 75–90 above the counter. Read the lighting guide.
- Outlets above the worktop at about 115 (or 20 above the worktop), at least two doubles, more on long runs; none above the hob. Own circuits for oven, hob (400 V cooker connection), dishwasher, microwave and steam oven; outlets for fridge and freezer; one for the hood. RAL-RG 678: 5 / 10 / 12 outlets for levels 1 / 2 / 3, one more with a dining corner. Read the electrical guide.
- Sink waste DN 50 in the wall at about 45–55, angle valves at about 50–55 with a dishwasher valve. If the sink is far from the shaft, flag it. Read the plumbing guide.

## 6. How to do it in openPlan3D
1. get_plan: room size, ceiling height, doors and windows (and their sills), the shaft or existing water connections. Ask or assume who cooks and their body height, and say what you assumed.
2. search_catalog category Kitchen: `counter` (120×60×85, set width for 30–120 modules), `sink_k` (60×45; set depth 60 so its front lines up with the counters), `stove` (60×60×85, hob with oven under it), `oven` (60×60×85), `dishwasher` (60×60×85), `fridge` (70×70×180; set width 60 for a built-in one), `wine_fridge`. There are no wall cabinets, hoods, tall oven units or island pieces: make an island from `counter` with a larger width and depth; approximate wall cabinets only if asked, as `counter` items 35 deep at elevation 145 (they are 85 tall, so their top lands at 230 instead of about 220), and say they are approximations. The catalog worktop is always 85 high; recommend the right height in your reply.
3. Build each run as modules side by side, backs against the wall face. Wall at the top of the plan (smaller y): rotation 0, centre y = wall face + depth/2. Wall on the right: rotation 90; at the bottom: 180; on the left: 270. Neighbouring centres are (width₁ + width₂)/2 apart. Put the whole run in one place_furniture call, in the zone order above, with appliances inside the run (not on top of a counter).
4. An island or peninsula: one or two counters, rotated to its long axis, 120 from the runs.
5. Then lights and outlets (lighting and electrical guides) and the sink and dishwasher pipes (plumbing guide), if the person asked for them.

## 7. Check before you answer
- check_plan walkway with minimum 120 and look at the gaps in the kitchen (it reports the whole floor): fix anything narrower between runs, island and walls; then minimum 90 for the passages around it.
- place_furniture warnings: no overlaps between modules, nothing blocking a door or sticking out of the room; no tall unit or fridge in front of a window.
- Hob has worktop on both sides; sink has the dishwasher next to it; fridge at a run end; the triangle legs are within 120–270.
- view_3d of the kitchen (room: name) and an eye-level view from the door: fronts in line, appliances where intended, nothing blocking a window.
- In your reply: the layout, the worktop height you recommend for the person, and what you approximated.
