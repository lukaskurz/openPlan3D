---
name: accessibility
description: Barrier-free, wheelchair-accessible or age-friendly planning (ÖNORM B 1600, DIN 18040-2): door widths, thresholds, turning and movement areas, accessible bathrooms and kitchens, switch heights, planning for growing old in the home.
---
# Barrier-free and age-friendly homes

Sizes in cm. Two norm families matter, and they differ:
- **Germany: DIN 18040-2** (dwellings) has two levels: *barrier-free* (barrierefrei nutzbar, for people with walking aids, older people, prams) and *R* (uneingeschränkt mit dem Rollstuhl nutzbar, fully usable in a wheelchair). The state building codes require some flats in larger buildings to be barrier-free; R only where agreed or funded.
- **Austria: ÖNORM B 1600** (barrier-free building, planning basics), made binding through OIB-Richtlinie 4 in the Länder building codes. For many new residential buildings it requires *adaptable housing* (anpassbarer Wohnbau): the flat must be convertible later with little effort, for example by removing a non-load-bearing wall between bathroom and WC so a turning circle fits. Single-family houses are usually not bound, but a family planning for the long term should follow it anyway.
Values below are as commonly summarised from these norms; where not marked otherwise treat them as typical, and say so. The binding numbers are in the current norm text and the Land's building code.

## 1. Key dimensions
| What | Barrier-free (DE) | Wheelchair R (DE) | Austria (ÖNORM B 1600 / OIB-RL 4), typical |
|---|---|---|---|
| Movement / turning area | 120 × 120 | 150 × 150 | turning circle Ø 150 |
| Interior doors, clear width | ≥ 80 | ≥ 90 | ≥ 80 (90 recommended) |
| Flat entrance door, clear width | ≥ 90 | ≥ 90 | ≥ 90 typical |
| Door clear height | ≥ 205 | ≥ 205 | ≥ 200 typical |
| Thresholds (also balcony and terrace) | ≤ 2, bevelled | none | ≤ 2, better none |
| Corridors in the flat | ≥ 120 | ≥ 120, with 150 × 150 where you turn | ≥ 120, Ø 150 at turns typical |
| Switches, door handles, controls | 85 (axis); 85–105 accepted where no R flat is planned | 85 | 80–110, at least 50 from a room corner |
| Beside the door handle on the pull side | — | about 50 free for the wheelchair (typical) | about 50 typical |
Movement areas may overlap each other, but not with a door swing or furniture.

## 2. Rooms
- **Entrance and hall**: step-free from the street or with a ramp of at most 6 % (with landings); 150 × 150 inside the entrance door for wheelchairs, 120 × 120 otherwise; a bench and a coat rack at reachable height.
- **Living and bedroom**: in front of furniture at least 90 (150 for R). Beside the bed (typical summary of DIN 18040-2): barrier-free 120 along one long side and 90 along the other; R 150 along one side and 120 along the other. At least one window per living room and bedroom low enough to see out while seated (sill about 60 or less, typical).
- **Kitchen**: in front of the worktop 120 (150 for R). For R: worktop, sink and hob side by side with knee space under them, worktop at about 80–85 or height-adjustable, oven and dishwasher raised to a reachable height, wall cabinets low or with pull-down shelves.
- **Bathroom**: 120 × 120 in front of WC, basin and in the shower (150 × 150 for R). Level-access shower at least 120 × 120 (150 × 150 for R; it may be the movement area), with a fold-down seat and a floor drain, no tray edge. WC seat 46–48 for R; for R a transfer space about 90 wide and 70 deep beside the WC (sources differ on whether one or both sides; plan both if the room allows) and the WC front edge about 70 from the back wall (typical). Basin with knee space under it (R: top at most about 80, typical), a mirror reaching down to the basin, a single-lever mixer. The door opens outward or slides, never into the room. Walls reinforced for grab rails, even if they come later.
- **Balcony, terrace**: step-free (≤ 2), with a 120 × 120 (R 150 × 150) area beside the furniture.
- **Stairs** (houses): handrails on both sides, even risers, a lit landing; for ageing in place, room for a stair lift or a future lift shaft.

## 3. Ageing in place (no norm, good practice)
- A bedroom, a bathroom with a level shower and the kitchen on the entrance floor, or the option to make a ground-floor room a bedroom later.
- Doors 90 wide, no thresholds, lever handles; sliding doors where swings get in the way.
- Outlets at 40 or higher instead of 30, switches at 85–105, illuminated switches; a night light along the path bed → WC, switched by a motion sensor.
- About twice the light for a 60-year-old compared with a 20-year-old (licht.de); glare-free light; strong contrast at steps and door frames; slip-resistant floors in the bathroom and kitchen.
- Space and reinforcement for grab rails beside the WC and in the shower; a shower seat; a bath that can become a shower.

## 4. How to do it in openPlan3D
1. get_plan and the brief. If the person says the home must be barrier-free or wheelchair-usable, record it with update_brief (which level, for whom).
2. Doors: the width in add_openings / update_elements is the opening in the wall. Frame and leaf take about 5–10 of it (RoT), so draw about 90 for 80 clear and 100–105 for 90 clear; German standard sizes for these are 885 and 1010 (nominal size of the wall opening, DIN 18101). Bathroom doors: type sliding or pocket, or a hinged door opening outward. No threshold can be drawn; mention thresholds in your reply.
3. Turning areas: there is no turning-circle check. Look at each room, the bathroom and the hall with view_plan and make sure a free square of 120 × 120 (150 × 150 for R) fits in front of every fixture, door and bed side, clear of furniture and door swings.
4. check_plan walkway with minimum 120 (or 150 for R) finds the gaps that are too narrow; it reports every gap on the floor between floor-standing items and walls, so judge which ones are real routes.
5. Switches and outlets: place `sym_switch` with elevation 85 (Germany R) or 85–105 (Austria 80–110), at least 50 from a room corner; outlets at elevation 40 or more. Read the electrical guide for counts.
6. Bathroom and kitchen fixtures: follow the bathroom and kitchen guides, using the larger movement areas here; set the `shower` to 120 × 120 or 150 × 150.

## 5. Check before you answer
- Every door on the route to the rooms the person needs has the required clear width; no threshold is assumed.
- Corridors ≥ 120; 120 × 120 (or 150 × 150) free in front of every door, fixture and at the bed; the bathroom door doesn't swing in.
- Switches at the right height and not in a corner; outlets not at floor level behind furniture.
- view_3d of the bathroom and an eye-level view at wheelchair eye height (height: 120) along the main route, to see that it is clear.
- In your reply: which level (barrier-free or R, German or Austrian rules) you followed, which values are typical rather than normative, and what the architect should confirm.
