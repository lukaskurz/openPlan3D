---
name: furnishing
description: Furnishing or rearranging rooms (living room, bedroom, dining, children's room, home office, hall, open-plan spaces): walkways, clearances around beds, tables, sofas and wardrobes, TV distance, rug sizes, door swings, desk ergonomics, and checking walkways.
---
# Furnishing and circulation

Sizes in cm. Most values are common practice (Neufert-style planning values and DIN 18011, which is withdrawn but still used); they are rules of thumb, not norms. For kitchens and bathrooms read their own guides; for barrier-free homes read the accessibility guide.

## 1. Order of work
1. Fixed things first: doors and their swings, windows and sill heights, radiators, outlets, the TV or projector wall, the routes between doors. Keep a clear line from each door to the windows and the other doors.
2. Anchor pieces: bed, sofa or seating group, dining table, desk, wardrobe, each on the wall or in the zone it needs.
3. Secondary pieces: nightstands, armchairs, side and coffee tables, shelves, dressers.
4. Rugs, lamps, plants and decor last.
5. Check walkways (section 7) and fix them before you answer.

## 2. Walkways and doors
- Main walkways (door to door, door to window, through a living room): at least 90, better 100–120 where people pass each other.
- Secondary paths (to a seat, along a bed, behind a dining chair nobody sits on): at least 60; 45–50 only for a short squeeze behind furniture.
- Keep each door's full swing clear (a 80–90 door sweeps a quarter circle of that radius), and 10–15 beside the latch-side frame for the light switch. Nothing that a door hits when it opens.
- Tall furniture (wardrobes, shelves) not in front of windows or radiators; low pieces under a window only if they stay below the sill (often about 85–90). Keep 10–15 in front of a radiator.
- Don't block outlets and switches with tall furniture; leave about 5–10 between a tall piece and a side wall with a door frame.

## 3. Bedroom
- Bed sizes (Austria/Germany): single 90 or 100 × 200; double 140, 160 or 180 × 200 (160 and 180 are usual for couples); length 210–220 for tall people. In the catalog, width is the side with the headboard and depth is the length: set `bed_queen` to width 160–180 and depth 200–210, and `bed_twin` to width 90–100 and depth 200 (the catalog defaults are not real bed sizes).
- Headboard against a solid wall, preferably not under a window and not on the wall shared with a noisy room.
- Free beside each long side of a double bed: at least 60, better 70–90; for a single bed one side may touch the wall. At the foot: at least 60 to pass, 90 if a wardrobe opens opposite.
- Nightstands 40–60 wide, top about level with the mattress (55–65), on both sides of a double bed.
- Wardrobe: 60 deep (sliding doors 65–70); in front at least 90 for hinged doors (door leaves are about 45–60), 70 for sliding doors. About 60–80 of hanging width per person minimum, more is better.
- Dresser or desk opposite or beside the bed with 90 in front.

## 4. Living room
- Sofa: 80–100 deep; 200–240 for three people, about 60 of width per seat. Back against a wall, or free in the room with at least 90 behind it if people walk there.
- Coffee table: 40–50 from the sofa front (reach without standing), height about the seat height (40–45), length about ⅔ of the sofa.
- Seating group: seats facing each other at most about 250–300 apart for conversation; armchairs at an angle to the sofa.
- TV: viewing distance about 1–1.5 × the screen diagonal for 4K, 2–2.5 × for full HD. A 65-inch screen (165 diagonal) works at about 200–250. Screen centre at seated eye height, about 100–110. Not opposite a window (glare) and not with a window right behind it.
- Projector: screen wall free of windows and lights; keep shelves and pendants out of the beam (the ceiling projector hangs on the ceiling).
- Shelves 30–40 deep; tall bookshelves fixed to walls, not in front of windows.
- Room dividers (`slat_divider`, `shelf_divider`) zone open spaces without closing them; keep 90 around their ends.

## 5. Dining
- Per person 60 wide and 40 deep at the table; table 80–100 wide (90 is comfortable with dishes in the middle).
- Sizes: 4 people 120 × 80 or round Ø 90–100; 6 people 160–180 × 90 or round Ø 120–130; 8 people 200–240 × 90–100.
- Behind a chair: 60–75 to pull it out and sit down; 90–100 from table edge to wall if someone walks behind seated people; 120 for a comfortable passage. So a table needs about 75 (nobody passes) to 120 (main route) of free floor on each side with chairs.
- Pendant centred on the table (lighting guide); table near the kitchen, ideally with daylight.

## 6. Children's room, home office, hall
- Desk: 70–80 deep (80 with a large monitor), at least 120 wide (140–160 comfortable), 72–76 high or height-adjustable; at least 100 free behind the desk edge for the chair. Daylight from the side (from the left for right-handers), never with the back to a window or the screen facing a window. Screen 50–80 from the eyes, its top at or below eye height.
- Children's room: bed along a wall, a play area of about 120 × 120 or more kept free, desk by the window as above; furniture that grows (adjustable desk and chair).
- Hall: at least 100–120 wide where people pass; wardrobe or coat rack 40–60 deep near the entrance; a bench and a mirror; nothing in the swing of the entrance door.

## 7. Rugs
- Living room: all front legs of the seating on the rug; the rug extends 15–20 past each sofa end; leave 20–45 of floor between rug and walls. Typical 200 × 300 or 250 × 350.
- Dining: the table plus 60–75 on every side, so pulled-out chairs stay on the rug (about 200 × 300 for a 6-seat table).
- Bedroom: from under the lower ⅔ of the bed, 45–60 beyond the sides and the foot; or two runners along the bed sides.
- Catalog: `rug` (200×300, set width/depth), `round_rug`, `runner_rug`. Rugs lie under furniture, so they don't count as overlaps.

## 8. Open-plan spaces
- Zone with furniture, not walls: a rug and a pendant mark the dining zone, the sofa back marks the living zone (with 90 behind it if it's a route), an island or a shelf divider separates the kitchen.
- Keep the main route along one side of the zones, not through the middle of a seating group or between a sofa and its TV.
- Line pieces up with each other and with the room axes; one large piece reads calmer than several small ones.

## 9. How to do it in openPlan3D
1. get_plan: room corners, doors (wall, offset, width), windows, existing furniture and the brief (who lives there, what they want). Use search_catalog for every id; batch all items of a room into one place_furniture call.
2. Rotation: 0 has the back towards the top of the plan (smaller y) and faces down; 90 has the back to the right; 180 the back down; 270 the back to the left. Against a wall face at the top: centre y = wall face + depth/2; at the bottom: wall face − depth/2; similar in x for side walls (wall face ± depth/2, using the item's depth because rotation turns it).
3. Override width and depth for real sizes (beds, tables, sofas, rugs). Table lamps and TVs on furniture: elevation is the height of the surface they stand on.
4. Fix every warning from place_furniture (overlap, sticking out of the room, through a wall, blocking a door) with update_elements before you answer.

## 10. Check before you answer
- check_plan walkway with minimum 90 for the main routes; then with minimum 60 for secondary paths. It lists every gap on the whole floor between floor-standing items, and between them and walls, that is narrower than the minimum (wall, ceiling and raised items and rugs are ignored; touching items don't count). Not every gap is a path: a nightstand 5 from the bed or a chair tucked under a table is fine. Fix the gaps that are real routes, or say why a narrower one is acceptable.
- No door swing blocked; no tall furniture in front of a window or radiator; switches and outlets not hidden.
- view_3d of each furnished room (room: name), and an eye-level view from the door (from: the doorway, to: the room centre) for living rooms: things face the right way, beds have their headboards on the wall, the sofa faces the TV.
- In your reply: the idea of the layout in a sentence or two, the sizes you chose, and any trade-off (for example a walkway of 80 instead of 90).
