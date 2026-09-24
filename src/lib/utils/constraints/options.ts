/** What a dimension can measure from (faces, axis), shared by the inline editor and Properties. */
import type { Constraint, FaceSide, Point, Room, Wall } from '$lib/models/types';
import type { TranslationKey } from '$lib/i18n';
import { wallFaceLabels, wallNormal, type FaceLabel } from './faces';

export type DimensionPatch = Partial<{ side: FaceSide; sideA: FaceSide; sideB: FaceSide; axis: 'aligned' | 'x' | 'y' }>;
export interface DimensionOption { key: TranslationKey; vars?: Record<string, string | number>; patch: DimensionPatch; active: boolean }

const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
const mid = (w: Wall): Point => ({ x: (w.start.x + w.end.x) / 2, y: (w.start.y + w.end.y) / 2 });
function sideTowards(wall: Wall, p: Point): 1 | -1 {
  const n = wallNormal(wall);
  return sign((p.x - wall.start.x) * n.x + (p.y - wall.start.y) * n.y);
}

function faceOption(label: FaceLabel, n: 1 | 2): Pick<DimensionOption, 'key' | 'vars'> {
  if (label.kind === 'room') return label.name.trim() ? { key: 'dimensionEditor.roomFace', vars: { room: label.name.trim() } } : { key: 'dimensionEditor.insideFace' };
  if (label.kind === 'outside') return { key: 'dimensionEditor.outsideFace' };
  return { key: 'dimensionEditor.face', vars: { n } };
}

export function dimensionOptions(c: Constraint, walls: Wall[], rooms: Room[]): DimensionOption[] {
  const wall = (id: string) => walls.find(w => w.id === id);
  switch (c.kind) {
    case 'length': {
      const w = wall(c.wallId);
      if (!w) return [];
      const labels = wallFaceLabels(w, walls, rooms);
      return ([0, 1, -1] as FaceSide[]).map(side => ({
        ...(side === 0 ? { key: 'dimensionEditor.centre' as TranslationKey } : faceOption(labels[side as 1 | -1], side === 1 ? 1 : 2)),
        patch: { side }, active: c.side === side,
      }));
    }
    case 'pointLine': {
      const w = wall(c.wallId), p = wall(c.point.wallId)?.[c.point.end];
      if (!w || !p) return [];
      const near = sideTowards(w, p);
      return [
        { key: 'dimensionEditor.centre', patch: { side: 0 }, active: c.side === 0 },
        { key: 'dimensionEditor.nearFace', patch: { side: near }, active: c.side === near },
        { key: 'dimensionEditor.farFace', patch: { side: (-near) as FaceSide }, active: c.side === -near },
      ];
    }
    case 'lineDistance': {
      const a = wall(c.wallA), b = wall(c.wallB);
      if (!a || !b) return [];
      const sa = sideTowards(a, mid(b)), sb = sideTowards(b, mid(a));
      return [
        { key: 'dimensionEditor.surfaces', patch: { sideA: sa, sideB: sb }, active: c.sideA === sa && c.sideB === sb },
        { key: 'dimensionEditor.centres', patch: { sideA: 0, sideB: 0 }, active: c.sideA === 0 && c.sideB === 0 },
        { key: 'dimensionEditor.outerFaces', patch: { sideA: (-sa) as FaceSide, sideB: (-sb) as FaceSide }, active: c.sideA === -sa && c.sideB === -sb },
      ];
    }
    case 'pointDistance':
      return (['aligned', 'x', 'y'] as const).map(axis => ({
        key: axis === 'aligned' ? 'dimensionEditor.aligned' : axis === 'x' ? 'dimensionEditor.horizontal' : 'dimensionEditor.vertical',
        patch: { axis }, active: c.axis === axis,
      }));
    default: return [];
  }
}
