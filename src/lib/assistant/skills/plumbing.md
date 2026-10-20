---
name: plumbing
description: Planning or drawing water and waste pipes (add_pipes): supply and waste runs, stacks and risers, pipe diameters, waste slopes, connection heights for WC, basin, shower, bath, kitchen sink, washing machine, and where wet rooms should go.
---
# Water supply and waste

Waste water decides the layout: it flows by gravity, needs slope and large pipes, and has to reach a vertical stack. Supply pipes are thin, under pressure and can go almost anywhere. So plan the stack first, the waste runs second, the supply last. Heights in cm from the finished floor, pipe sizes in mm. Germany: DIN EN 12056 with DIN 1986-100 (drainage), DIN EN 806 and DIN 1988 (drinking water). Austria uses the same EN standards with its own national supplements (ÖNORM). Values marked "typical" vary by manufacturer and installer; the plumber has the final say.

## 1. Waste pipes
| Fixture | Typical connection size | Pipe in openPlan3D |
|---|---|---|
| Washbasin, bidet | DN 40 | 40 |
| Shower tray, bathtub, kitchen sink, dishwasher, washing machine | DN 50 | 50 |
| Level-access shower drain | DN 50 (DN 70 for large or linear drains) | 50 |
| WC | DN 100 (DN 90 allowed for some low-flush WCs) | 110 |
| Stack (Fallleitung) | DN 100 | 110 |
The app's waste sizes 40, 50 and 110 are the outside diameters of the usual HT/KG plastic pipes (DN 40, 50, 100).
- Slope: at least 1 % for connection pipes (DIN 1986-100); 2 % is the usual practice. 1 % is 1 cm drop per metre, so a 3 m run at 2 % drops 6 cm.
- An unvented single connection pipe should stay within about 4 m length, 3 bends of 90° and 1 m of fall (DIN EN 12056-2, system I, as used in Germany). Longer runs need a vent or a bigger pipe; say so rather than drawing a long run as if it were fine.
- Pipes never get smaller in the direction of flow. Use 45° bends rather than 90°; a WC joins a stack or a collector pipe with a 45° or 88.5° branch.
- Keep the WC closest to the stack (ideally within about 1 m, typical); the other fixtures can be further away on DN 40/50.
- The stack runs straight down through every floor in a shaft and is vented over the roof (DN 100) or with an air admittance valve. Shafts are typically 20×20 to 40×60, holding the waste stack, cold and hot risers and often the ventilation duct. Avoid offsets in a stack; avoid running waste pipes over bedrooms and living rooms below without sound insulation.
- Waste in the floor: floors in Austrian and German flats are typically 10–15 thick above the slab (screed 5–7 plus insulation and a fill layer). A DN 50 pipe with slope eats that up in 2–3 m, so floor runs only work for short distances (shower or bath to the wall). Longer runs go in a pre-wall installation (Vorwandinstallation, 15–25 deep, full or about 112–120 high) along the wall to the shaft.
- Moving a WC far from the existing stack is the most expensive change in a renovation. A small pumping unit (Hebeanlage) is the last resort, not the plan.

## 2. Supply pipes
- Typical sizes (multilayer composite pipe, outside diameter): 16 for a single fixture, 20 for a room or a group of fixtures, 25–26 for the main and the risers. Copper equivalents are 15, 18 and 22. The app offers 16, 20 and 25.
- Cold and hot run in pairs. Facing the fixture, hot is on the left and cold on the right. Where they run side by side horizontally, hot goes above cold.
- Cold water must stay cold (≤ 25 °C): keep cold pipes away from hot and heating pipes or insulate them. Hot pipes are insulated.
- Hot water should arrive quickly: keep the water heater close to the bathroom and kitchen. Germany applies the 3-litre rule (DVGW W 551; in Austria ÖNORM B 5019 covers hot-water hygiene): the pipe from the heater or the circulation loop to the furthest tap holds at most 3 litres, about 25 m of 16 pipe or 15 m of 20 pipe. Beyond that, a circulation loop or a local heater.
- Each flat has a main shut-off valve and a meter where the supply enters, usually in or next to the shaft; then a distribution manifold or a branch line to each wet room.
- The WC and the washing machine need cold only; the dishwasher cold (or hot, if the manufacturer allows); everything else cold and hot.

## 3. Connection heights (typical)
| Fixture | Waste | Supply |
|---|---|---|
| Wall-hung WC in a pre-wall frame | outlet centre about 22–23 | cold, inside the frame (cistern); frame 112 high (82 under a window); flush plate at about 100–110; seat 40–42 (46–48 barrier-free) |
| Washbasin (top 85, up to 95) | in the wall at about 55–60 | angle valves at about 55–60, about 15–20 apart, either side of the basin axis |
| Shower | under the tray, or a floor drain (level access needs about 7–10 of floor build-up at the drain plus a 1.5–2 % fall of the tiles) | mixer at about 100–120; exposed thermostats use connections 15 apart; head or rail top at about 200–210 |
| Bathtub (rim about 55–60) | at the floor under the tub, at the tap end | mixer about 15–20 above the rim (about 75) |
| Kitchen sink (top = worktop, 85–95) | in the wall at about 45–55 | angle valves at about 50–55, with a valve for the dishwasher |
| Dishwasher | its hose goes to the sink trap, so keep it next to the sink | from the sink's angle valve |
| Washing machine | trap at about 60–90 (within the machine's drain-hose limits) | tap at about 100–110 |

## 4. Where wet rooms go
- Group bathroom, WC, kitchen and utility room around one shaft, and put wet rooms on different floors above each other, so the stacks run straight.
- Line the fixtures up along one installation wall (the shaft wall or a pre-wall), with the WC nearest the stack. A kitchen across the flat from the shaft needs its own stack or a long, sloped DN 50 run in a pre-wall or the floor; flag it.
- Don't put a waste stack in a wall next to a bedroom without sound insulation.

## 5. How to draw it in openPlan3D
1. get_plan: find the shaft or the existing stack, the wet rooms and their fixtures (`toilet`, `sink_b`, `shower`, `bathtub`, `washer_dryer`, `sink_k`, `dishwasher`). Fixtures are Furnishing items with a water connection. search_catalog "drain supply heater" (symbols only show when you search with words) gives 2D symbols: `sym_water_supply`, `sym_drain`, `sym_water_heater`, `sym_washer_hookup`, `sym_gas_line`.
2. Stack and risers first, one add_pipes call: a riser is a single point with riser: true. Waste stack: kind waste, diameter 110. Cold and hot risers: diameter 25, about 10–15 apart in the same shaft. Put the stacks at the same x, y on every floor (switch_floor and add them there too).
3. Waste runs: points from the fixture's connection to the stack. run: wall for pre-wall runs (set elevation to the connection height, e.g. 22 for the WC, 55 for a basin), floor for short runs in the floor build-up (default elevation, below the floor), ceiling for pipes hung under the ceiling of this floor (for example waste from the floor above in a suspended ceiling). Diameters from the table above. A pipe has one elevation, so it can't show the slope: for a long run, split it into segments that step down 1–2 cm per metre towards the stack, or state the slope in your reply.
4. Supply runs: cold and hot as two parallel pipes about 5–10 apart, hot on the left as you face the fixtures, from the risers to each fixture, run: wall at about the angle-valve height (or floor). diameter 20 for the room line, 16 for the last stretch to each fixture.
5. Put all pipes of a wet room in one add_pipes call, and use update_elements (points, kind, diameter, run, elevation) to fix them.

## 6. Check before you answer
- Every fixture has a waste pipe ending at a stack, and the right supply (cold and hot; cold only for WC and washing machine).
- No waste pipe gets smaller downstream; the WC uses 110; waste runs stay short (about 4 m without a vent) and you stated the slope (≥ 1 %, 2 % usual).
- Long floor runs are flagged as needing floor build-up; waste pipes don't cross door openings in the floor without enough build-up.
- Stacks line up between floors; hot water reaches the furthest tap within the 3-litre rule, or you suggested circulation.
- view_3d of the wet room (room: name) to see that the pipes sit in the walls and floor where you meant them, and view_plan for the runs. In your reply say what the plumber should confirm.
