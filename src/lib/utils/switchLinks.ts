import type { FurnitureItem, Point, SwitchLink } from '$lib/models/types';
import { getCatalogItem, furnitureTrade } from './furnitureCatalog';

/**
 * Switch links (spec §4.5): "this switch controls these lights". One link per switch,
 * created when its first target is added and removed with its last. Drawn as dashed
 * arcs from the switch to each target, only while working on Electrical. Pure helpers.
 */

/** Catalog ids that are light switches. */
export function isSwitch(item: Pick<FurnitureItem, 'catalogId'>): boolean {
  return item.catalogId === 'sym_switch' || item.catalogId.startsWith('sym_switch_');
}

/** Catalog ids that are outlets. */
export function isOutlet(item: Pick<FurnitureItem, 'catalogId'>): boolean {
  return item.catalogId === 'sym_outlet' || item.catalogId.startsWith('sym_outlet_');
}

/** What a switch can control: any electrical item other than a switch (lights, fans, outlets…). */
export function isSwitchTarget(item: Pick<FurnitureItem, 'catalogId' | 'mount'>): boolean {
  return !isSwitch(item) && !!getCatalogItem(item.catalogId) && furnitureTrade(item) === 'electrical';
}

/** The link of a switch, if it has one. */
export function linkOfSwitch(links: readonly SwitchLink[] | undefined, switchId: string): SwitchLink | undefined {
  return links?.find(link => link.switchId === switchId);
}

/** The links that control an item (normally at most one). */
export function linksControlling(links: readonly SwitchLink[] | undefined, targetId: string): SwitchLink[] {
  return (links ?? []).filter(link => link.targetIds.includes(targetId));
}

/**
 * The links after toggling `targetId` on the switch's link: added when missing (the link is
 * created on demand), removed when present (the link is dropped once it is empty). Returns
 * a new array; links are copied where they change.
 */
export function toggledSwitchLinks(links: readonly SwitchLink[], switchId: string, targetId: string, newId: () => string): SwitchLink[] {
  if (switchId === targetId) return [...links];
  const existing = links.find(link => link.switchId === switchId);
  if (!existing) return [...links, { id: newId(), switchId, targetIds: [targetId] }];
  const targetIds = existing.targetIds.includes(targetId)
    ? existing.targetIds.filter(id => id !== targetId)
    : [...existing.targetIds, targetId];
  return targetIds.length
    ? links.map(link => link === existing ? { ...link, targetIds } : link)
    : links.filter(link => link !== existing);
}

/**
 * The links once the ids in `removed` are gone (deleted furniture or links): links with a
 * deleted id or switch are dropped, deleted targets are taken out, and links left without
 * targets are dropped. Returns the same array when nothing changes.
 */
export function switchLinksWithout(links: SwitchLink[], removed: ReadonlySet<string>): SwitchLink[] {
  let changed = false;
  const next: SwitchLink[] = [];
  for (const link of links) {
    if (removed.has(link.id) || removed.has(link.switchId)) { changed = true; continue; }
    const targetIds = link.targetIds.filter(id => !removed.has(id));
    if (targetIds.length !== link.targetIds.length) changed = true;
    if (!targetIds.length) continue;
    next.push(targetIds.length === link.targetIds.length ? link : { ...link, targetIds });
  }
  return changed ? next : links;
}

/**
 * The arc drawn from a switch to a target: a quadratic curve whose control point sits
 * off the chord's midpoint, a fifth of the chord's length to its left, so links from one
 * switch fan out instead of overlapping walls.
 */
export function linkArc(from: Point, to: Point): { from: Point; control: Point; to: Point } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const bend = 0.2;
  return { from, control: { x: (from.x + to.x) / 2 - dy * bend, y: (from.y + to.y) / 2 + dx * bend }, to };
}

/** A point on a quadratic arc at t (0..1). */
export function arcPoint(arc: { from: Point; control: Point; to: Point }, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt * mt * arc.from.x + 2 * mt * t * arc.control.x + t * t * arc.to.x,
    y: mt * mt * arc.from.y + 2 * mt * t * arc.control.y + t * t * arc.to.y,
  };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to an arc, by sampling it into 24 segments. */
export function arcDistance(p: Point, arc: { from: Point; control: Point; to: Point }, samples = 24): number {
  let best = Infinity, prev = arc.from;
  for (let i = 1; i <= samples; i++) {
    const next = arcPoint(arc, i / samples);
    best = Math.min(best, segmentDistance(p, prev, next));
    prev = next;
  }
  return best;
}

/** The arcs of the floor's links: one per target that still exists, with its link id. */
export function switchLinkArcs(links: readonly SwitchLink[] | undefined, furniture: readonly Pick<FurnitureItem, 'id' | 'position'>[]): { linkId: string; targetId: string; arc: { from: Point; control: Point; to: Point } }[] {
  if (!links?.length) return [];
  const byId = new Map(furniture.map(item => [item.id, item]));
  const arcs: { linkId: string; targetId: string; arc: { from: Point; control: Point; to: Point } }[] = [];
  for (const link of links) {
    const from = byId.get(link.switchId);
    if (!from) continue;
    for (const targetId of link.targetIds) {
      const to = byId.get(targetId);
      if (to) arcs.push({ linkId: link.id, targetId, arc: linkArc(from.position, to.position) });
    }
  }
  return arcs;
}

/**
 * The link whose arc passes within `tolerance` cm of a point (the closest one), or null.
 * Tap tolerance is given in world units by the caller (screen px / zoom).
 */
export function hitTestSwitchLink(p: Point, links: readonly SwitchLink[] | undefined, furniture: readonly Pick<FurnitureItem, 'id' | 'position'>[], tolerance: number): string | null {
  let best: string | null = null, bestDistance = tolerance;
  for (const { linkId, arc } of switchLinkArcs(links, furniture)) {
    const distance = arcDistance(p, arc);
    if (distance <= bestDistance) { bestDistance = distance; best = linkId; }
  }
  return best;
}

/** Link accent colour (the app accent). */
export const LINK_COLOR = '#2563eb';

/**
 * Draw the links as dashed arcs in screen space. `toScreen` maps plan cm to canvas px.
 * The selected link and the link of `activeSwitchId` are drawn thicker.
 */
export function drawSwitchLinks(
  ctx: CanvasRenderingContext2D,
  links: readonly SwitchLink[] | undefined,
  furniture: readonly Pick<FurnitureItem, 'id' | 'position'>[],
  toScreen: (x: number, y: number) => Point,
  opts: { selectedId?: string | null; activeSwitchId?: string | null } = {},
): void {
  const arcs = switchLinkArcs(links, furniture);
  if (!arcs.length) return;
  const activeLink = opts.activeSwitchId ? linkOfSwitch(links, opts.activeSwitchId)?.id : undefined;
  ctx.save();
  ctx.strokeStyle = LINK_COLOR;
  ctx.fillStyle = LINK_COLOR;
  ctx.lineCap = 'round';
  for (const { linkId, arc } of arcs) {
    const strong = linkId === opts.selectedId || linkId === activeLink;
    const a = toScreen(arc.from.x, arc.from.y), c = toScreen(arc.control.x, arc.control.y), b = toScreen(arc.to.x, arc.to.y);
    ctx.lineWidth = strong ? 3 : 1.5;
    ctx.globalAlpha = strong ? 1 : 0.8;
    ctx.setLineDash(strong ? [8, 5] : [6, 5]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, strong ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
