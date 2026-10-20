---
name: bathroom
description: Designing, laying out or furnishing a bathroom or WC: fixture sizes and clearances for WC, washbasin, shower, bathtub and washing machine, movement areas, small-bathroom layouts, ventilation, bathroom zones and barrier-free basics.
---
# Bathroom and WC layout

Sizes in cm. DIN 18022 (sizes and clearances for kitchens, bathrooms and WCs) has been withdrawn without replacement, but planners in Germany and Austria still use its values; numbers below are typical practice, mostly as summarised by Baunetz Wissen, not binding norm values. Water and waste decide the layout: read the plumbing guide when the shaft position is open or pipes are wanted.

## 1. Fixture sizes
| Fixture | Typical size (width × depth) | Height |
|---|---|---|
| Wall-hung WC | 36–40 × 50–60 from the finished wall (catalog 40 × 65) | seat 40–42; 46–48 barrier-free or for tall people |
| Washbasin | single ≥ 60 × 45–55; double ≥ 120 (140+ for two people at once); hand basin ≥ 45–50 × 35–40 | top 85 (up to 95); children 55–75 |
| Bathtub | 170 × 75 standard; 180 × 80 comfortable | rim about 55–60 |
| Shower tray | ≥ 80 × 80; 90 × 90 comfortable; 75 wide works if 90 deep; walk-in without a door ≥ 120 × 90 (RoT) | — |
| Washing machine, dryer | 60 × 60, plus about 5–10 behind for hoses | 85; stacked about 170–180 |
| Pre-wall installation | adds 15–25 in front of the wall, full height or about 112–120 high (a shelf on top) | — |

## 2. Clearances
- Side clearance: at least 20 from the edge of a WC, basin or bidet to a wall or the next fixture; comfortable 25–30. So a 40-wide WC has its axis at least 40 from a side wall (45–50 comfortable).
- Movement area in front, measured from the wall the fixture is mounted on: WC 120–135, washbasin 100–145, bathtub 120–150 along the tub, shower 130–175. Free floor in front of each fixture at least about 70–75 deep (RoT). Movement areas of neighbouring fixtures may overlap.
- Two basins: axes at least 80–90 apart (RoT).
- Beside a bathtub's long side at least 55 free to step in and out (105 is ideal).
- The door doesn't open onto a fixture or into someone sitting on the WC. In small rooms let it open outward (someone who collapses doesn't block it) or use a sliding or pocket door.
- Mirror: bottom just above the basin splashback (about 100–120), top at 190–200 or more; light from both sides (lighting guide).

## 3. Room sizes and layouts
- Guest WC with WC and hand basin: about 90–100 wide × 150–160 long at least (RoT); the WC on the far short wall, the hand basin on a side wall or beside the WC, the door opening outward.
- Small shower bathroom: from about 160 × 200 or 180 × 180. Small bathroom with tub: about 170 × 200, with the tub across the 170 end wall. Family bathroom with tub and shower: 8–10 m².
- Patterns for small bathrooms:
  1. Everything on one installation wall (WC, basin, shower in a row on the pre-wall or shaft wall): the cheapest pipes, and the other walls stay free.
  2. Washbasin nearest the door, WC in the middle or opposite, shower in the far corner, so the wet area is away from the door.
  3. Narrow room (150–170 wide): fixtures along one long wall, about 75–90 free in front, door on the short wall.
  4. Tub across the end wall; a shower screen over the tub instead of a separate shower when space is short.
  5. Wall-hung WC and basin and a level shower with a glass panel make the room look larger and are easier to clean.
- WC preferably not right in view of the opened door; at least keep the door from swinging into it.
- Washing machine in the bathroom: in a niche or under a worktop, outside zones 0–2, with its own outlet and circuit.

## 4. Electrics, zones and light (summary)
- Zones (Germany DIN VDE 0100-701, Austria OVE E 8101 part 7-701): zone 0 inside the tub or tray; zone 1 above it to 225 (a level shower without tray: 120 around the shower outlet); zone 2 a further 60 band. No outlets or switches in zones 0–2; IPX4 equipment in zones 1–2; the basin outlet at about 105–120 and at least 60 from the tub or shower edge; all circuits on a 30 mA RCD. Details in the electrical guide.
- Light: ≥ 300 lx, IP-rated ambient light, two mirror lights at the sides at about 160, a wide downlight over the shower or tub. Details in the lighting guide.

## 5. Ventilation, heating, sealing
- A window or a fan. A windowless bathroom or WC needs mechanical extraction in both Germany and Austria; typical extract rates are about 40 m³/h for a bathroom and 20 m³/h for a WC (Germany, DIN 18017-3 for ducted systems). The fan runs with the light and runs on afterwards, or on a humidity sensor; supply air comes through a door gap of about 1 or a grille.
- A heated towel rail (about 50–60 wide) or underfloor heating; the radiator not where the door or a fixture blocks it.
- Shower and tub areas are sealed under the tiles (Germany DIN 18534); a level-access shower needs a floor drain and enough floor build-up (plumbing guide).

## 6. Barrier-free basics
120 × 120 free in front of WC, basin and in the shower (150 × 150 for wheelchair users); level-access shower at least 120 × 120 (it may overlap the movement area); door at least 80 clear (90 for wheelchairs), opening outward or sliding, no threshold; WC seat 46–48 with transfer space beside it for wheelchair users; a basin with knee space under it; walls reinforced for grab rails later. Read the accessibility guide for details and for Austria (ÖNORM B 1600).

## 7. How to do it in openPlan3D
1. get_plan: room size, door position and width, windows (sill height matters above a tub or WC), ceiling height, the shaft or existing pipes.
2. search_catalog category Bathroom: `toilet` (40×65), `sink_b` (60×45; set width for a larger or double basin), `bathtub` (170×75; set width/depth for 180×80), `shower` (90×90×210 enclosure; set width/depth for 80×80, 120×90 and so on), `washer_dryer` (60×65). `mirror` (Decor, 60×5×90) is a floor item: place it with its back at the wall face above the basin and elevation about 110. `wall_sconce` (wall item) serves as mirror lights.
3. Backs against the wall face: wall at the top of the plan → rotation 0 and centre y = wall face + depth/2; wall on the right → 90; at the bottom → 180; on the left → 270. If the person plans a pre-wall, stand the WC and basin 15–25 further out and mention it. Space fixtures by their side clearances (20 minimum from edge to edge or wall).
4. Place all fixtures in one place_furniture call and fix every warning (overlaps, blocked door, sticking out of the room).
5. Then, if wanted: pipes (plumbing guide), lights and mirror lights (lighting guide), outlets and switch (electrical guide), and the floor finish with update_elements floorMaterial (tiles).

## 8. Check before you answer
- check_plan walkway with minimum 70 and look at the gaps in the bathroom (it reports the whole floor): free floor in front of every fixture and from the door to each fixture. Small gaps beside a fixture and the wall are expected; judge which gaps are real paths.
- No warning about a blocked door; the door swing doesn't hit the WC, basin or someone standing at them.
- Side clearances of at least 20; WC axis at least 40 from a side wall; shower and tub sizes as intended.
- view_3d of the bathroom (room: name) and an eye-level view from the door: fixtures against the right walls, mirror above the basin, nothing in front of the window that shouldn't be.
- In your reply: the layout idea, the sizes you used, and what the plumber or electrician must confirm (shaft distance, zones).
