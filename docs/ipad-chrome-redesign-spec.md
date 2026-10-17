# iPad chrome redesign: implementation spec

Status: agreed design, ready to build (2026-10-17).
Mockup: [openPlan3D iPad Toolbar Mockup](https://claude.ai/artifact/C1fH7dimZNZeBFA8ozj9fv), two artboards (iPad landscape 1180 × 820, iPad portrait 820 × 1180). The link is private to its owner; share it from its Share menu before handing it to someone else. Where this document and the mockup disagree, this document wins.

## 1. Goals

- Make the editor work by touch on an 11" iPad (Air, 5th gen) in both orientations, without hurting mouse use.
- Give every screen area one job, so people learn where to look:

| Zone | Question it answers | Contents |
|---|---|---|
| Top left | What am I editing? | Menu, version (plan alternative) |
| Top centre | What can I add? | Fixed tools, then the current trade's tools |
| Top right | How am I looking at it? | 2D / 3D, Show (visibility) |
| Left edge | Where am I vertically? | Floor rail: storeys, and the current storey's ceiling / floor |
| Bottom centre | What am I doing right now? | Action slot: selection actions, tool hint and options, or status |
| Bottom left | Time | Undo, redo, history |
| Bottom right | Precision | Scale, settings (snapping) |

- Nothing on the plan may sit on top of what is being edited: selection actions dock at the bottom instead of floating next to the selection.
- Electrical, plumbing and ceiling-mounted items become first-class: they have a mount (floor, wall, ceiling) and a height, and each trade can be worked on without the others getting in the way.
- Elevation stops being a top-level mode. Sections (cut lines) and wall elevations share one viewer, opened from the plan.

Non-goals: phone layouts (< 640 px) beyond not breaking; redesigning the inspector sheet's content; real wire routing.

## 2. Layout

All controls are at least 44 × 44 px. Floating groups use the existing `op-float` style (surface-raised, 1 px border, `--shadow-lg`, 12 px radius). Corner buttons are 52 × 52 px. The chrome inset stays `--chrome-inset` (16 px).

### 2.1 Landscape (≥ 1001 px wide)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [≡] [⑂ A ▾]        [✋ ➤ 📏 ✂]  [🛋▾ │ ▦ 🚪 ⌐ 🛋]  [✦]      [▢2D│⬡3D] [◫▾] │
│                                                                           │
│ ┌──┐                                                                      │
│ │+ │                                                                      │
│ │1 │                          plan                                        │
│ │┌G┐                                                                     │
│ ││⌒│ ceiling                                                              │
│ ││▁│ floor                                                                │
│ │└─┘                                                                     │
│ └──┘                                                                      │
│ [↶ ↷ 🕘]            [ action slot (status / hint / actions) ]  [1:50 │ ⚙] │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Top bar**: one row. Left and right groups pin to the corners. The two tool bars are centred on the window as a pair (`left: 50%; transform: translateX(-50%)`), independent of the corner groups' widths. The Assistant button sits 8 px to the right of the pair and is not part of the centring (absolutely positioned against the pair).
- **Floor rail**: vertically centred on the left edge, about 60 px wide.
- **Bottom bar**: a 3-column grid `minmax(0,1fr) auto minmax(0,1fr)`, areas `left center right`, so the action slot is truly centred.

### 2.2 Portrait (≤ 1000 px wide)

- Top bar: the corner groups stay in the first row. **The tool bars move to a second row**, still centred (top = 16 + 52 + 12 px). `EditorChrome` already measures the top row and sets `is-stacked` when the centre doesn't fit. Keep that measurement and apply it to the centred pair.
- Bottom bar: grid areas `'center center' 'left right'`: the action slot gets its own row above the two corner clusters (row gap 10 px).
- Popovers anchored to the top tool bars open below the second row.
- The inspector stays a bottom sheet (already implemented: `planInsetBottom`, selection pans into view). The action slot sits above the sheet when both are visible.
- Zoom-to-fit must account for the second tool row and the taller bottom area (extend `visibleCanvasHeight` / the fit's chrome margins).

## 3. Components

File names refer to `src/lib/components/chrome/` unless noted. "New" means a new component; otherwise the existing one changes.

### 3.1 Version button (ProjectCluster)

- The alternatives button shows a branch icon, a **version badge** (the alternative's short code, e.g. `A`, `B`, `A1`) and a chevron. No full name on the button.
- Tapping opens the **Versions menu**: one row per alternative (badge, display name, "branched from X" when it is a branch), the current one highlighted; then "Branch X into X2" and "New alternative C".
- Renaming stays in the existing alternatives UI (long press / More); only the display name is editable, never the code.

### 3.2 Fixed tool bar (new; replaces part of ToolStrip)

Always the same four tools, in this order: **Pan** (current `view` group), **Select**, **Measure**, **Section** (new tool, §5.4). Icon-only 44 px buttons; the active one is filled with `--color-accent`.

### 3.3 Trade tool bar (new; replaces the rest of ToolStrip)

- First button: **trade button**, icon only (52 × 44), tinted `--color-accent-subtle` so it never reads as a tool, with a 10 px chevron in its bottom-right corner. Icons: Furnishing = sofa, Electrical = bolt, Plumbing = pipe elbow.
- Tapping opens the **Trade menu** below it: rows with icon, name and one-line description, check on the current one. Header "Working on".
- Then a divider, then the tools for the current trade and surface:

| Trade | Floor surface | Ceiling surface |
|---|---|---|
| Furnishing | Wall, Door/Window, Stairs/Column, Furniture | Ceiling height, Light, Fan, Smoke detector |
| Electrical | Outlet, Switch, Light, Link | Light, Fan, Link |
| Plumbing | Pipe, Fixture, Floor drain | Pipe (ceiling run) |

  The mockup shows the Furnishing ceiling set for every trade on the ceiling; build the table above.
- Existing tool groups in `tools.ts` (`ToolGroup`) map onto these buttons; the trade decides which groups are offered. Keyboard shortcuts keep working regardless of the trade that is shown (pressing W switches to Furnishing and the Wall tool).

### 3.4 2D / 3D switch (ViewCluster)

- A two-segment control: `[▢ 2D | ⬡ 3D]`, icon plus label, active segment filled. Replaces the Plan / Elevation / 3D segmented control.
- **Elevation is removed from this control.** Wall elevations open from the wall's selection actions (§3.8) and from section markers (§5.4).

### 3.5 Show menu (ViewCluster's view menu)

- A 52 × 52 icon button with the **layers icon** (three stacked sheets) and a corner chevron; label for assistive tech "Show on the plan".
- Rows with switches (44 px rows): Dimensions, Room names, Measurements, Rules (constraints), Drawings (traced underlay), Section markers, Grid, Rulers, Minimap, Floor below, Furniture. These write the existing stores (`layerVisibility`, `planDisplay`, `projectSettings.showDimensions`); add `sections` and `underlay` to `layerVisibility`.
- The theme choice currently in this menu moves to Settings.

### 3.6 Floor rail (FloorRail)

- Top to bottom: **+** (the existing `floors-add` menu), a short divider, then the storeys from highest to lowest (`orderedFloors`, reversed), so the rail mirrors the building.
- Storeys other than the current one: compact 52 × 44 letter buttons (`1`, `G`, `B`). Tapping switches storey and **keeps the current surface**.
- The current storey is an outlined, tinted group: its letter as a header, then two icon buttons stacked **Ceiling above Floor**, the active one filled. This grouping is what tells people that ceiling and floor belong to a storey.
- Tapping the current storey's letter header opens the existing `floor-settings` popover (name, elevation, delete).

### 3.7 Bottom-left cluster (BottomBar)

Undo, Redo, History as 44 px icon buttons (no "History" text). **Remove the zoom −, % and + controls** (pinch replaces them; the scale readout in §3.9 takes over fit and presets). The history timeline behaviour stays.

### 3.8 Action slot (new; replaces StatusPill and the floating SelectionBar)

One centred slot whose content follows a strict priority:

1. **Overlay modes** (elevation pick, door join, calibration): their hint, plus a Cancel button. (Door join already does this in StatusPill.)
2. **Selection**: the selection's action bar. A dimension chip (accent outline, e.g. `Dining table · 180 × 80`, `Wall · 5.50 m`, `Double outlet · 30 cm`, `Section A–A`) that opens numeric entry, a divider, then 56 px icon-over-label actions. Per kind:
   - Furniture: Rotate, Flip, Look, Lock, More (existing SelectionBar actions).
   - Wall: Split, **Elevation**, Look, More.
   - Ceiling item: Height (hang distance), Look, More.
   - Wall-mounted item: Height, Circuit (electrical), More.
   - Section marker: Open, Look other way, Delete.
   - Multi-selection: the existing multi actions.
3. **Active tool other than Pan/Select**: the tool's hint, its options (moved from ToolTray: wall chain options, outlet height / single-double, pipe kind and diameter, light hang height…), and a **Done** button.
4. **Otherwise**: the status line: `5 rooms · 51.0 m² · Ground floor`, or per trade/surface, e.g. `Ceiling · Ground floor · 10 lights · 2.40–2.60 m`.

The SelectionBar component keeps its action logic but loses `selectionAnchor` positioning. `selectionAnchor` remains for the canvas (e.g. to pan selections into view).

### 3.9 Bottom-right cluster (new ScaleControl; SnapControl moves)

- **Scale readout**: a ruler glyph and `1:50` (tabular numbers). Tapping opens presets `1:20 · 1:50 · 1:100 · 1:200` and "Fit plan to screen". Pinch zoom updates the label continuously (rounded to the nearest preset-like value: 1:47, 1:50, 1:73…). See §4.6 for the maths.
- **Settings** (sliders icon): a popover with Snapping (grid step, angle step, snap to walls and objects; the current SnapControl content) and an "All settings" row that opens the Settings dialog.

### 3.10 Popovers

All popovers use the single `popover` store in `stores/chrome.ts` (which already has `history`, `floors-add`, `floor-settings`…). Add names: `'versions' | 'trade' | 'show' | 'scale' | 'settings'`. Opening one closes the others; tapping the plan or pressing Escape closes them. They open toward the screen centre from their anchor.

## 4. Data model

All new fields are optional, so existing projects load unchanged. Update `projectValidation.ts`, `interchange.ts`, `projectPackage.ts` and the exports for every field below, with tests.

### 4.1 Trade and surface (UI state)

```ts
type Trade = 'furnishing' | 'electrical' | 'plumbing';
type Surface = 'floor' | 'ceiling';
export const activeTrade = writable<Trade>('furnishing');   // stores/planView.ts
export const activeSurface = writable<Surface>('floor');
```

Not saved in the project file; keep them in `sessionStorage` per project so a reload returns to the same place.

Each placed item has a trade, derived from its catalog definition (§4.3). In the plan:

- Items of the active trade **on the active surface** are drawn normally and are hit-testable.
- Everything else is drawn at 18 % opacity and is **not** hit-testable. Walls and rooms are always drawn, but are only editable in Furnishing / floor.
- In the ceiling surface, floor-standing furniture is drawn at 18 % (for orientation), ceiling-mounted items of all trades are drawn, and each room shows a ceiling-height chip.

### 4.2 Mount and height on items

```ts
interface FurnitureItem {
  // existing: elevation?: number  // bottom above the floor, cm
  mount?: 'floor' | 'wall' | 'ceiling';   // missing = from the catalog, else 'floor'
  /** Ceiling items: distance from the ceiling to the item's top, cm (a pendant's cord). */
  drop?: number;
  /** Wall items: the hosting wall and position along it (0..1), like doors and windows. */
  wallId?: string;
  wallPosition?: number;
  /** Electrical: which side of the wall the face points to. */
  wallSide?: 1 | -1;
}
```

- **Floor**: unchanged; `elevation` is the bottom above the floor.
- **Wall**: hosted like an opening. It moves with the wall, and is deleted or rehosted when the wall is split or deleted (reuse the opening cascade code). `elevation` is the mounting height (defaults: outlet 30 cm, switch 105 cm). Drawn as a wall symbol in plan, and at its height in elevations, sections and 3D.
- **Ceiling**: the effective elevation is computed: `ceilingHeight(room at position) − drop − height`. Changing a room's ceiling height moves its ceiling items. `elevation` is not stored for ceiling items.

### 4.3 Catalog

```ts
interface FurnitureDef {
  // existing: category, symbol?, elevation?
  trade?: Trade;            // default from category: Electrical → electrical, Plumbing → plumbing, Lighting → electrical, else furnishing
  mount?: 'floor' | 'wall' | 'ceiling';
  defaultDrop?: number;     // ceiling items
}
```

Set `mount: 'ceiling'` on ceiling_light, recessed_light, pendant_light, ceiling fan, ceiling projector (replacing its fixed `elevation: 245`), and the `sym_*` ceiling symbols. Set `mount: 'wall'` on `sym_outlet`, `sym_switch` and wall lights. Smoke detector is new (ceiling, electrical).

### 4.4 Ceiling heights

Promote `ItemDetails.ceilingHeight` (room metadata today) to a real room property used by the 3D viewer, ceiling mounts, sections and the ceiling plan:

```ts
// Room-level override keyed like other room data (rooms are derived, so store by room id on the floor):
interface Floor { roomCeilingHeights?: Record<string, number> }  // cm
```

The default is the floor's storey height (`floorElevations` spacing) minus the slab, or wall height when walls differ. Keep reading `details.ceilingHeight` for imported data and migrate it on load. Dropped ceilings are a per-room value; bulkhead outlines are out of scope.

### 4.5 Electrical links and pipes

```ts
interface Floor {
  /** "This switch controls these lights": drawn as dashed arcs in Electrical. */
  switchLinks?: { id: string; switchId: string; targetIds: string[] }[];
  pipes?: Pipe[];
}
interface Pipe {
  id: string;
  kind: 'cold' | 'hot' | 'waste';
  diameter: number;          // mm
  points: Point[];           // plan polyline, cm
  run: 'floor' | 'wall' | 'ceiling';
  elevation?: number;        // cm above the floor; negative = in the screed
  riser?: boolean;           // vertical stack through storeys
}
```

Colours: cold `#38bdf8`, hot `#f87171`, waste `#a8a29e` (thick, dashed). Pipes and links get undo, delete, multi-select and validation like annotations. Circuits (numbered groups of outlets) can come later; the Circuit action shows the linked switch for now.

### 4.6 Scale

World units are cm; `zoom` is CSS px per cm. The on-screen scale is 1 : N with

```
N = cssPpi / (2.54 × zoom)
```

`cssPpi` is the screen's CSS pixels per inch: 132 for iPad Air 11" (264 ppi ÷ DPR 2), from a small device table keyed by screen size and DPR, falling back to 96 (prefix the label with "≈" when falling back). Presets set `zoom = cssPpi / (2.54 × N)` and keep the view centre.

### 4.7 Versions (plan alternatives)

```ts
interface PlanAlternative {
  // existing: id, name, floors, activeFloorId, updatedAt, thumbnail?
  code?: string;      // 'A', 'B', 'A1', … shown in the version badge
  parentCode?: string;
}
```

- New alternative: the next unused letter (`nextAlternativeLetter` already does this for names).
- Branch from X: the letter part of X plus the next unused number (A → A1, A1 → A2, B → B1). Codes never get longer than letter plus number.
- Migration: alternatives without a code get one from their position (A, B, C…); a name that is exactly a letter becomes that code.
- `name` stays free text, defaulting to "Copy of A" for a branch and "Alternative C" for a new one.

### 4.8 Sections

```ts
interface Project {
  sections?: { id: string; code: string /* 'A' */; start: Point; end: Point; look: 1 | -1; floorIds?: string[] }[];
}
```

Project-level, because a section cuts through every storey. Markers are drawn on every floor the line crosses.

## 5. Behaviour

### 5.1 Switching trade

Closes the trade menu, sets `activeTrade`, switches the tool to Select, clears the selection, and shows a toast ("Electrical"). The plan re-renders with the new dimming. Placing an item from another trade's catalog (e.g. via search) switches trade first.

### 5.2 Switching surface

Floor ↔ Ceiling from the rail. Same clean-up as a trade switch. Toast: "Looking at the ceiling". The ceiling view draws as seen from below; **do not mirror the plan**. Picking a ceiling-only tool (Light, Fan, Smoke detector) while on the floor switches to the ceiling automatically.

### 5.3 3D

Shows the 3D viewer. The fixed and trade tool bars are hidden (3D has its own tool strip); the floor rail stays. The action slot shows the status (`3D · Ground floor`).

### 5.4 Section tool and viewer

- Section tool: drag a line across the plan (snaps to 0/45/90°); release creates the next section code with markers at both ends; arrowheads show the viewing direction. The new section is selected.
- Tapping a marker selects the section. The action slot then offers Open, Look other way and Delete.
- **Open** shows the section in the existing ElevationView container, generalised to arbitrary cut lines:
  - Walls and slabs crossed by the cut are filled.
  - Things beyond the cut, up to the next wall in the viewing direction, are outlined.
  - Ceiling heights, pendants and wall-mounted items are drawn at their real heights.
  - Dimensions: storey height, ceiling heights, room widths along the cut.
- **Wall elevation** = a section placed just inside the wall, looking at it. It opens from the wall's Elevation action and keeps the current ElevationView editing (drag openings, sill heights).

### 5.5 Hints

All hints use the existing touch wording (`prefersTouch()`); no hint may require a keyboard.

## 6. Work packages

Build them in this order; each one can ship on its own. Every package: unit tests for new logic, i18n keys in `en.ts` and `pt.ts` (Portuguese runs 2–3× longer, so no fixed text widths), `npm run check` and `npm test` clean, and a browser check at 1180 × 820 and 820 × 1180 (2× DPR) with touch events for gestures.

1. **Chrome re-layout.** No data model change.
   - Sections 2, 3.1 (codes derived on the fly), 3.2–3.10 without new tools.
   - Fixed bar plus the trade bar showing today's tools under Furnishing.
   - Docked action slot; zoom controls removed; scale readout with the device table; Settings popover.
   - Elevation moves to the wall's actions.
   - Done when nothing floats over the plan, every control is ≥ 44 px, both orientations match the mockup, and the existing tool shortcuts still work.
2. **Mount and ceiling.**
   - §4.2–4.4: catalog mounts, ceiling heights as real data, the ceiling surface on the floor rail, the ceiling view with chips, and 3D placement of ceiling items.
   - Done when a pendant placed over a table hangs at ceiling − drop in 3D and follows a ceiling-height change.
3. **Trades.**
   - §4.1, §4.5: the trade menu and per-trade tool sets, dimming and hit-testing, wall-hosted outlets and switches, switch links, and the pipe tool (drawn in 2D and as tubes in 3D).
   - Done when Electrical / Plumbing editing cannot move furniture, and wall items survive wall moves and splits.
4. **Sections.**
   - §4.8, §5.4: the section tool, markers, the generalised viewer and export of section views (PDF/SVG).
5. **Versions.**
   - §4.7: stored codes, the branch rule, migration and the versions menu actions.

## 7. Open questions

- Is an **All** trade needed (everything editable)? The mockup has none; Furnishing on the floor is the default "normal" plan.
- Trade colour accents (e.g. electrical blue, plumbing cyan) on the trade button and dimmed overlays: worth trying in package 3.
- Phones (< 640 px): the two tool bars won't fit side by side even when stacked; probably the trade bar collapses into the trade button's menu.
- Should the scale readout show only presets (1:50, 1:100) and snap pinch zoom to them when released?
