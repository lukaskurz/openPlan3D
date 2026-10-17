<script lang="ts">
  import { prefersTouch } from '$lib/utils/inputDevice';
  import { t } from '$lib/i18n';
  import { onDestroy } from 'svelte';
  import { listenSideViewKeys } from '$lib/utils/sideViewKeys';
  import { beyondItems, sectionFrame, wallElevationSection, type BeyondItem } from '$lib/utils/sectionCut';
  /**
   * ElevationView — integrated face-on view + editor for a single wall.
   * Fills the canvas area (replaces the plan canvas while active — sidebars stay).
   * Shows the wall as a rectangle (length × height) with its doors and windows,
   * a heavier floor line and a light 0.5 m grid. Openings can be selected and
   * dragged: horizontally to move them along the wall, and windows vertically
   * to change their sill height.
   *
   * Selection is the app's global selection: clicking a door/window sets
   * selectedElementId (so the PropertiesPanel shows its properties); clicking
   * empty wall selects the wall itself. A slim header bar cycles through walls.
   * Escape (or the TopBar Plan/Elevation toggle) returns to the plan view.
   */
  import { currentProject, activeFloor, elevationWallId, selectedElementId, selectedElementIds, selectedRoomId, updateDoor, updateWindow, updateFurniture, beginUndoGroup, endUndoGroup } from '$lib/stores/project';
  import type { FurnitureItem } from '$lib/models/types';
  import { effectiveElevation } from '$lib/utils/mounting';
  import { getFurnitureSize } from '$lib/utils/furnitureCatalog';
  import { wallDistanceAt, wallPositionAtDistance } from '$lib/utils/wallHostedItems';
  import { wallPathProfile } from '$lib/utils/wallProfiles';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import type { Door, Window as Win } from '$lib/models/types';
  import { openingOnWall } from '$lib/utils/wallProfiles';
  import { getWallStartHeight, getWallEndHeight, getWallHeightAt } from '$lib/models/types';

  const DEFAULT_WALL_HEIGHT = 240; // cm — fallback when a wall has no height
  const DEFAULT_DOOR_HEIGHT = 210; // cm
  const DEFAULT_SILL = 90;         // cm
  const GRID_STEP = 50;            // cm (0.5 m)

  let units = $derived($projectSettings.units);

  // The store edits walls in place, so hand on a fresh copy: a $derived that returned the same
  // object would look unchanged, and the length, heights and drawing below would keep showing the
  // wall as it was before a Properties edit until the elevation was reopened.
  let wall = $derived.by(() => {
    const id = $elevationWallId;
    const f = $activeFloor;
    if (!id || !f) return null;
    const found = f.walls.find((w) => w.id === id);
    return found ? { ...found } : null;
  });

  let wallIndex = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return -1;
    return f.walls.findIndex((w) => w.id === wall!.id);
  });
  let wallCount = $derived($activeFloor?.walls.length ?? 0);

  let doors = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return [] as Door[];
    return f.doors.filter((d) => d.wallId === wall!.id);
  });

  let windows = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return [] as Win[];
    return f.windows.filter((w) => w.wallId === wall!.id);
  });

  /** Wall-hosted items (outlets, switches, sconces) on this wall. */
  let hostedItems = $derived.by(() => {
    const f = $activeFloor;
    if (!wall || !f) return [] as FurnitureItem[];
    return f.furniture.filter((item) => item.wallId === wall!.id);
  });

  /**
   * Furniture standing in front of this face (within a metre of it), seen as in a section
   * placed just inside the wall: drawn as faint outlines for reference, not editable here.
   * Straight walls only (the section uses the wall's chord).
   */
  let nearbyCache: BeyondItem[] = [];
  let nearbyItems = $derived.by(() => {
    const f = $activeFloor, project = $currentProject;
    // Dragging an opening changes nothing in front of the wall: skip the room detection per frame.
    if (dragging) return nearbyCache;
    if (!wall || !f || !project || wall.curvePoint) return (nearbyCache = []);
    const hosted = new Set(hostedItems.map((item) => item.id));
    return (nearbyCache = beyondItems(project, sectionFrame(wallElevationSection(wall, 1, 100)), f, 0, { clipDepth: 200 })
      .filter((shape): shape is BeyondItem => shape.kind === 'item' && !hosted.has(shape.itemId)));
  });

  /** Wall length in cm (samples curved walls like the properties panel does) */
  let wallLen = $derived.by(() => {
    if (!wall) return 0;
    if (wall.curvePoint) {
      let len = 0;
      let px = wall.start.x, py = wall.start.y;
      for (let i = 1; i <= 32; i++) {
        const t = i / 32, mt = 1 - t;
        const nx = mt * mt * wall.start.x + 2 * mt * t * wall.curvePoint.x + t * t * wall.end.x;
        const ny = mt * mt * wall.start.y + 2 * mt * t * wall.curvePoint.y + t * t * wall.end.y;
        len += Math.hypot(nx - px, ny - py);
        px = nx; py = ny;
      }
      return len;
    }
    return Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  });

  let startH = $derived(wall ? getWallStartHeight(wall) : DEFAULT_WALL_HEIGHT);
  let endH = $derived(wall ? getWallEndHeight(wall) : DEFAULT_WALL_HEIGHT);
  let maxH = $derived(Math.max(startH, endH, 1));

  /** Global selection, narrowed to an opening on this wall (drives highlight + dims) */
  let selectedOpeningId = $derived.by(() => {
    const id = $selectedElementId;
    if (!id) return null;
    return doors.some((d) => d.id === id) || windows.some((w) => w.id === id) || hostedItems.some((item) => item.id === id) ? id : null;
  });

  let hoverOpeningId = $state<string | null>(null);
  let dragging = $state(false);

  function selectElement(id: string | null) {
    selectedElementId.set(id);
    selectedElementIds.set(new Set());
    selectedRoomId.set(null);
  }

  /** Show a different wall (cycling or fallback) and select it */
  function showWall(id: string) {
    hoverOpeningId = null;
    elevationWallId.set(id);
    selectElement(id);
  }

  function cycleWall(dir: 1 | -1) {
    const f = $activeFloor;
    if (!f || f.walls.length === 0) return;
    const i = f.walls.findIndex((w) => w.id === $elevationWallId);
    const next = f.walls[(((i < 0 ? 0 : i) + dir) % f.walls.length + f.walls.length) % f.walls.length];
    showWall(next.id);
  }

  // Track the shown wall's index so we can advance gracefully if it is deleted
  let lastWallIndex = 0;
  $effect(() => {
    if (wallIndex >= 0) lastWallIndex = wallIndex;
  });

  // If the shown wall disappears (deleted / undone): advance to the nearest
  // remaining wall, or drop back to the plan view when none are left.
  $effect(() => {
    const id = $elevationWallId;
    const f = $activeFloor;
    if (!id || !f) return;
    if (!f.walls.some((w) => w.id === id)) {
      if (f.walls.length > 0) {
        showWall(f.walls[Math.max(0, Math.min(lastWallIndex, f.walls.length - 1))].id);
      } else {
        elevationWallId.set(null);
      }
    }
  });

  function backToPlan() {
    elevationWallId.set(null);
  }

  // Escape returns to the plan view; Undo/Redo first closes the elevation's drag group.
  $effect(() => {
    if (!$elevationWallId) return;
    return listenSideViewKeys(backToPlan, () => endDrag());
  });

  // ── Canvas + geometry ─────────────────────────────────────────────
  let canvas = $state<HTMLCanvasElement | null>(null);
  let cw = $state(0);
  let ch = $state(0);

  const PAD_L = 72, PAD_R = 64, PAD_T = 36, PAD_B = 64;

  /** Screen-space layout: cm → px mapping for the wall face */
  let geom = $derived.by(() => {
    if (!wall || wallLen <= 0 || cw < PAD_L + PAD_R + 40 || ch < PAD_T + PAD_B + 40) return null;
    const availW = cw - PAD_L - PAD_R;
    const availH = ch - PAD_T - PAD_B;
    const scale = Math.min(availW / wallLen, availH / maxH);
    const ox = PAD_L + (availW - wallLen * scale) / 2;
    const floorY = PAD_T + (availH - maxH * scale) / 2 + maxH * scale;
    return { scale, ox, floorY };
  });

  interface OpeningRect {
    id: string;
    kind: 'door' | 'window' | 'item';
    /** Wall items only: hung on the far face of the wall (side −1), drawn faint. */
    far?: boolean;
    /** left edge along wall, cm */ x: number;
    /** bottom above floor, cm */ y: number;
    w: number;
    h: number;
  }

  function openingRects(): OpeningRect[] {
    if (!wall) return [];
    const rects: OpeningRect[] = [];
    for (const [kind, items] of [['door', doors], ['window', windows]] as const) {
      for (const item of items) {
        const bottom = kind === 'door' ? 0 : (item as Win).sillHeight ?? DEFAULT_SILL;
        const rect = openingOnWall(wallLen, startH, endH, item.position, item.width, bottom, item.height ?? DEFAULT_DOOR_HEIGHT);
        if (rect) rects.push({ id: item.id, kind, x: rect.left, y: rect.bottom, w: rect.right - rect.left, h: rect.top - rect.bottom });
      }
    }
    return rects;
  }

  /** Smallest drawn height of a wall item, cm (outlets and switches are flat plan symbols). */
  const MIN_ITEM_HEIGHT = 8;

  /**
   * Wall-hosted items as rectangles in wall coordinates. The elevation looks at the wall's
   * side +1 (its start on the left), so items facing side −1 are on the far face.
   */
  function hostedRects(): OpeningRect[] {
    if (!wall) return [];
    const path = wallPathProfile(wall);
    const toView = path.length > 0 ? wallLen / path.length : 1;
    return hostedItems.map((item) => {
      const size = getFurnitureSize(item);
      const centre = wallDistanceAt(wall!, item.wallPosition ?? 0.5) * toView;
      return { id: item.id, kind: 'item' as const, far: item.wallSide === -1, x: centre - size.width / 2, y: effectiveElevation(item, 0), w: size.width, h: Math.max(size.height, MIN_ITEM_HEIGHT) };
    });
  }

  /** Topmost opening or wall item under a point given in wall cm coordinates (x along wall, y up from floor) */
  function hitOpening(x: number, y: number): OpeningRect | null {
    const rects = [...openingRects(), ...hostedRects()];
    // Windows are drawn after doors, so test them first (topmost wins)
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
    }
    return null;
  }

  /** Clamp an opening's center position t so it stays inside the wall,
   *  matching the 2D editor's positionOnWall() clamp of [0.1, 0.9]. */
  function clampPosition(t: number, width: number): number {
    const half = width / 2 / Math.max(1, wallLen);
    let lo = Math.max(0.1, half);
    let hi = Math.min(0.9, 1 - half);
    if (lo > hi) { lo = 0.5; hi = 0.5; }
    return Math.max(lo, Math.min(hi, t));
  }

  // ── Drag state ────────────────────────────────────────────────────
  let drag: {
    id: string;
    kind: 'door' | 'window' | 'item';
    startPx: number;
    startPy: number;
    startPos: number;   // position t at drag start
    startSill: number;  // window sill at drag start (cm)
    width: number;      // opening width (cm)
    winH: number;       // window height (cm)
    startX: number;     // wall item: centre along the wall at drag start (cm)
    startElevation: number; // wall item: mounting height at drag start (cm)
    grouped: boolean;   // beginUndoGroup() called
  } | null = null;

  function toWallCoords(e: PointerEvent): { x: number; y: number } | null {
    if (!geom) return null;
    return { x: (e.offsetX - geom.ox) / geom.scale, y: (geom.floorY - e.offsetY) / geom.scale };
  }

  function onPointerDown(e: PointerEvent) {
    if (!wall || !geom) return;
    e.preventDefault();
    const p = toWallCoords(e);
    if (!p) return;
    const hit = hitOpening(p.x, p.y);
    // Cancelling the press also stops the browser moving focus, so take it as the plan canvas
    // does. A properties field being edited then blurs, committing to the element it shows before
    // the selection below changes (the hit test above used what was drawn), and stops keeping
    // Escape from returning to the plan.
    canvas?.focus({ preventScroll: true });
    if (hit) {
      // Global selection: the PropertiesPanel now shows this opening
      selectElement(hit.id);
      const door = hit.kind === 'door' ? doors.find((d) => d.id === hit.id) : undefined;
      const win = hit.kind === 'window' ? windows.find((w) => w.id === hit.id) : undefined;
      drag = {
        id: hit.id,
        kind: hit.kind,
        startPx: e.offsetX,
        startPy: e.offsetY,
        startPos: (door?.position ?? win?.position) ?? 0.5,
        startSill: win?.sillHeight ?? DEFAULT_SILL,
        width: hit.w,
        winH: win?.height ?? (hit.kind === 'item' ? hit.h : 0),
        startX: hit.x + hit.w / 2,
        startElevation: hit.y,
        grouped: false,
      };
      dragging = true;
      canvas?.setPointerCapture(e.pointerId);
    } else {
      // Empty wall area — selection falls back to the wall itself
      selectElement(wall.id);
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!wall || !geom) return;
    if (drag) {
      const dxCm = (e.offsetX - drag.startPx) / geom.scale;
      const dyCm = (drag.startPy - e.offsetY) / geom.scale; // up is positive
      if (!drag.grouped) {
        // Ignore sub-2px jitter so a plain click never creates an undo entry
        if (Math.hypot(e.offsetX - drag.startPx, e.offsetY - drag.startPy) < 2) return;
        beginUndoGroup();
        drag.grouped = true;
      }
      if (drag.kind === 'item') {
        // Along the wall (kept on it) and up or down (kept under the wall's top), like a window.
        const path = wallPathProfile(wall);
        const toPath = wallLen > 0 ? path.length / wallLen : 1;
        const half = Math.min(drag.width / 2, wallLen / 2);
        const centre = Math.max(half, Math.min(wallLen - half, drag.startX + dxCm));
        const wallPosition = wallPositionAtDistance(wall, centre * toPath);
        const top = getWallHeightAt(wall, wallPosition);
        const elevation = Math.max(0, Math.min(Math.max(0, top - drag.winH), Math.round(drag.startElevation + dyCm)));
        updateFurniture(drag.id, { wallPosition, elevation });
        return;
      }
      const newPos = clampPosition(drag.startPos + dxCm / Math.max(1, wallLen), drag.width);
      if (drag.kind === 'door') {
        updateDoor(drag.id, { position: newPos });
      } else {
        const half = drag.width / 2 / wallLen;
        const currentWallH = Math.min(getWallHeightAt(wall, newPos - half), getWallHeightAt(wall, newPos + half));
        const maxSill = Math.max(0, currentWallH - drag.winH);
        // Preserve the exact fractional clearance after snapping the requested height.
        const newSill = Math.max(0, Math.min(maxSill, Math.round(drag.startSill + dyCm)));
        updateWindow(drag.id, { position: newPos, sillHeight: newSill });
      }
      return;
    }
    const p = toWallCoords(e);
    hoverOpeningId = p ? (hitOpening(p.x, p.y)?.id ?? null) : null;
  }

  function endDrag(e?: PointerEvent) {
    if (drag) {
      if (drag.grouped) {
        endUndoGroup(drag.kind === 'door' ? 'Moved door (elevation)' : drag.kind === 'item' ? 'Moved wall item (elevation)' : 'Moved window (elevation)');
      }
      drag = null;
      dragging = false;
      try { if (e) canvas?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
  }

  // Closing elevation can remove the canvas before pointerup is delivered.
  onDestroy(() => endDrag());

  let cursor = $derived(dragging ? 'grabbing' : hoverOpeningId ? 'move' : 'default');

  // ── Drawing ───────────────────────────────────────────────────────

  function drawDimH(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, label: string) {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y); ctx.lineTo(x2, y);
    ctx.moveTo(x1, y - 4); ctx.lineTo(x1, y + 4);
    ctx.moveTo(x2, y - 4); ctx.lineTo(x2, y + 4);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const cx = (x1 + x2) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - tw / 2 - 3, y - 8, tw + 6, 16);
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, y);
  }

  function drawDimV(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, label: string) {
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y1); ctx.lineTo(x, y2);
    ctx.moveTo(x - 4, y1); ctx.lineTo(x + 4, y1);
    ctx.moveTo(x - 4, y2); ctx.lineTo(x + 4, y2);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif';
    const cy = (y1 + y2) / 2;
    ctx.save();
    ctx.translate(x, cy);
    ctx.rotate(-Math.PI / 2);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-tw / 2 - 3, -8, tw + 6, 16);
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  $effect(() => {
    // Reactive dependencies: geometry, openings, selection, hover, units
    const c = canvas;
    const g = geom;
    const sel = selectedOpeningId;
    const hov = hoverOpeningId;
    const u = units;
    const rects = openingRects();
    const items = hostedRects();
    const nearby = nearbyItems;
    if (!c) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    c.width = Math.max(1, Math.round(cw * dpr));
    c.height = Math.max(1, Math.round(ch * dpr));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!wall || !g) return;

    const { scale, ox, floorY } = g;
    const xAt = (cm: number) => ox + cm * scale;
    const yAt = (cmUp: number) => floorY - cmUp * scale;
    const wallRight = xAt(wallLen);
    const yStart = yAt(startH);
    const yEnd = yAt(endH);

    // Wall face (trapezoid polygon)
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(ox, floorY);
    ctx.lineTo(wallRight, floorY);
    ctx.lineTo(wallRight, yEnd);
    ctx.lineTo(ox, yStart);
    ctx.closePath();
    ctx.fill();

    // 0.5 m grid (light), clipped to the wall face polygon
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ox, floorY);
    ctx.lineTo(wallRight, floorY);
    ctx.lineTo(wallRight, yEnd);
    ctx.lineTo(ox, yStart);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = GRID_STEP; x < wallLen; x += GRID_STEP) {
      ctx.moveTo(xAt(x), floorY);
      ctx.lineTo(xAt(x), yAt(getWallHeightAt(wall, x / wallLen)));
    }
    for (let y = GRID_STEP; y < maxH; y += GRID_STEP) {
      ctx.moveTo(ox, yAt(y));
      ctx.lineTo(wallRight, yAt(y));
    }
    ctx.stroke();
    ctx.restore();

    // Furniture in front of the face, faint and dashed (reference only).
    if (nearby.length) {
      ctx.save();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      for (const item of nearby) {
        ctx.strokeRect(xAt(item.u0), yAt(item.z1), (item.u1 - item.u0) * scale, (item.z1 - item.z0) * scale);
        if (item.hang) {
          ctx.beginPath();
          ctx.moveTo(xAt(item.hang.u), yAt(item.hang.z0));
          ctx.lineTo(xAt(item.hang.u), yAt(item.hang.z1));
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Openings (doors first, then windows on top — same order as hit testing)
    for (const r of rects) {
      const px = xAt(r.x);
      const py = yAt(r.y + r.h);
      const pw = r.w * scale;
      const ph = r.h * scale;
      if (r.kind === 'door') {
        ctx.fillStyle = '#fef3c7';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);
        // Door handle hint
        ctx.fillStyle = '#b45309';
        ctx.beginPath();
        ctx.arc(px + pw - 8, py + ph / 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(px, py, pw, ph);
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);
        // Window mullions (cross)
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px + pw / 2, py); ctx.lineTo(px + pw / 2, py + ph);
        ctx.moveTo(px, py + ph / 2); ctx.lineTo(px + pw, py + ph / 2);
        ctx.stroke();
      }
      if (r.id === hov && r.id !== sel) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
      }
    }

    // Wall items (outlets, switches, sconces) at their mounting height; those on the far face faint.
    for (const r of items) {
      const px = xAt(r.x);
      const py = yAt(r.y + r.h);
      const pw = Math.max(4, r.w * scale);
      const ph = Math.max(4, r.h * scale);
      ctx.save();
      ctx.globalAlpha = r.far ? 0.35 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, pw, ph);
      ctx.restore();
      if (r.id === hov && r.id !== sel) {
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        ctx.strokeRect(px - 2, py - 2, pw + 4, ph + 4);
      }
    }

    // Wall outline + heavier floor line
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox, floorY);
    ctx.lineTo(wallRight, floorY);
    ctx.lineTo(wallRight, yEnd);
    ctx.lineTo(ox, yStart);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(ox - 24, floorY);
    ctx.lineTo(wallRight + 24, floorY);
    ctx.stroke();

    // Overall wall dimensions
    drawDimH(ctx, ox, wallRight, floorY + 28, formatLength(wallLen, u));
    if (startH === endH) {
      drawDimV(ctx, ox - 28, yStart, floorY, formatLength(startH, u));
    } else {
      drawDimV(ctx, ox - 28, yStart, floorY, formatLength(startH, u));
      drawDimV(ctx, wallRight + 28, yEnd, floorY, formatLength(endH, u));
    }

    // Selected opening: highlight + width / height / sill dimensions
    const selRect = sel ? [...rects, ...items].find((r) => r.id === sel) : undefined;
    if (selRect) {
      const px = xAt(selRect.x);
      const py = yAt(selRect.y + selRect.h);
      const pw = selRect.w * scale;
      const ph = selRect.h * scale;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(px - 3, py - 3, pw + 6, ph + 6);
      ctx.setLineDash([]);
      // Width above the opening
      drawDimH(ctx, px, px + pw, py - 14, formatLength(selRect.w, u));
      // Height to the right of the opening
      drawDimV(ctx, px + pw + 14, py, py + ph, formatLength(selRect.h, u));
      // Sill height for windows (from floor up to the sill)
      if ((selRect.kind === 'window' || selRect.kind === 'item') && selRect.y > 0) {
        drawDimV(ctx, px + pw + 38, py + ph, floorY, formatLength(selRect.y, u));
      }
    }
  });
</script>

{#if wall}
  <!-- Integrated view: fills the screen under the floating chrome; the wall switcher
       floats where the plan tools sit, and the canvas leaves room for the corners. -->
  <div class="absolute inset-0 z-20 flex flex-col" style="background:var(--canvas-bg, #f8f9fa)">
    <div class="absolute top-4 max-[1150px]:top-[80px] left-1/2 -translate-x-1/2 z-40 op-float op-cluster max-w-[calc(100vw-2rem)]" data-elevation-header>
      <button class="op-btn is-square" onclick={() => cycleWall(-1)} disabled={wallCount < 2} title={$t('elevationView.previous')} aria-label={$t('elevationView.previous')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <div class="flex flex-col items-center px-3 min-w-[9rem]">
        <span class="text-sm font-semibold tabular-nums" style="color:var(--color-text-strong)">{$t('elevationView.wall', { index: wallIndex + 1, count: wallCount })}</span>
        <span class="text-xs tabular-nums" style="color:var(--color-text-muted)">{formatLength(wallLen, units)} × {startH === endH ? formatLength(startH, units) : `${formatLength(startH, units)} → ${formatLength(endH, units)}`}</span>
      </div>
      <button class="op-btn is-square" onclick={() => cycleWall(1)} disabled={wallCount < 2} title={$t('elevationView.next')} aria-label={$t('elevationView.next')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </div>
    <div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 op-pill pointer-events-none max-lg:hidden">{$t(prefersTouch() ? 'elevationView.help.touch' : 'elevationView.help')}</div>

    <!-- Elevation canvas: focused only by pressing it (not a Tab stop), so it draws no focus ring -->
    <div class="flex-1 min-h-0 relative mt-[96px] mb-[84px] mx-[84px] max-sm:mx-2" bind:clientWidth={cw} bind:clientHeight={ch}>
      <canvas
        aria-label={$t('elevationView.canvas')}
        bind:this={canvas}
        tabindex="-1"
        class="absolute inset-0 w-full h-full touch-none select-none outline-none"
        style="cursor: {cursor}"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={endDrag}
        onpointercancel={endDrag}
      ></canvas>
    </div>
  </div>
{/if}
