/** Keeping constraints valid when the walls they refer to are deleted, split, reversed or copied. */
import type { Constraint, CornerRef, Point } from '$lib/models/types';
import { constraintWalls } from './rows';

export function constraintsWithoutWalls(constraints: Constraint[], removed: Set<string>): Constraint[] {
  return constraints.filter(c => !constraintWalls(c).some(id => removed.has(id)));
}

export function constraintMentionsWall(c: Constraint, wallId: string): boolean {
  return constraintWalls(c).includes(wallId);
}

/**
 * Split `wallId` at `mid` into wallId (start → mid) and newId (mid → end). Corner refs at
 * the old end move to the new piece; line references stay on the first piece, and the two
 * pieces are kept collinear so those still describe the same line. A centreline length
 * becomes the distance across both pieces; a face length can't be kept and is dropped.
 */
export function splitWallConstraints(constraints: Constraint[], wallId: string, newId: string, mid: Point, uid: () => string): { constraints: Constraint[]; dropped: number } {
  let dropped = 0, mentioned = false;
  const moveEnd = (ref: CornerRef): CornerRef => ref.wallId === wallId && ref.end === 'end' ? { wallId: newId, end: 'end' } : ref;
  const result: Constraint[] = [];
  for (const c of constraints) {
    if (!constraintMentionsWall(c, wallId)) { result.push(c); continue; }
    mentioned = true;
    switch (c.kind) {
      case 'length':
        if (c.side === 0) result.push({ id: c.id, driven: c.driven, offset: c.offset, kind: 'pointDistance', a: { wallId, end: 'start' }, b: { wallId: newId, end: 'end' }, axis: 'aligned', value: c.value });
        else dropped++;
        break;
      case 'pointDistance': result.push({ ...c, a: moveEnd(c.a), b: moveEnd(c.b) }); break;
      case 'pointLine': result.push({ ...c, point: moveEnd(c.point) }); break;
      case 'fix':
        if ('end' in c.target) result.push({ ...c, target: moveEnd(c.target) });
        else {
          result.push({ ...c, at: [c.at[0], { ...mid }] });
          result.push({ ...c, id: uid(), target: { wallId: newId }, at: [{ ...mid }, c.at[1]] });
        }
        break;
      default: result.push(c);
    }
  }
  if (mentioned) result.push({ id: uid(), kind: 'parallel', wallA: wallId, wallB: newId });
  return { constraints: result, dropped };
}

/** Reversing a wall swaps its ends and flips its normal; keep every constraint meaning the same. */
export function reverseWallConstraints(constraints: Constraint[], wallId: string): Constraint[] {
  const swap = (ref: CornerRef): CornerRef => ref.wallId === wallId ? { wallId, end: ref.end === 'start' ? 'end' : 'start' } : ref;
  const flip = (side: 0 | 1 | -1) => (side === 0 ? 0 : -side) as 0 | 1 | -1;
  return constraints.map(c => {
    switch (c.kind) {
      case 'length': return c.wallId === wallId ? { ...c, side: flip(c.side) } : c;
      case 'pointDistance': return { ...c, a: swap(c.a), b: swap(c.b) };
      case 'pointLine': {
        const moved = { ...c, point: swap(c.point) };
        return c.wallId === wallId ? { ...moved, side: flip(c.side), value: -c.value } : moved;
      }
      case 'lineDistance': {
        let next = c;
        if (c.wallA === wallId) next = { ...next, sideA: flip(next.sideA), value: -next.value };
        if (c.wallB === wallId) next = { ...next, sideB: flip(next.sideB) };
        return next;
      }
      case 'angle': {
        let next = c;
        if (c.wallA === wallId) next = { ...next, value: wrapDegrees(next.value + 180) };
        if (c.wallB === wallId) next = { ...next, flipB: !next.flipB };
        return next;
      }
      case 'fix':
        if ('end' in c.target) return { ...c, target: swap(c.target) };
        return c.target.wallId === wallId ? { ...c, at: [c.at[1], c.at[0]] } : c;
      default: return c;
    }
  });
}

/** Signed degrees in (-180, 180]. */
export function wrapDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/** Copies of the constraints whose walls were all copied, re-pointed at the copies. */
export function copyConstraints(constraints: Constraint[], wallIds: Map<string, string>, offset: Point, uid: () => string): Constraint[] {
  const id = (wall: string) => wallIds.get(wall)!;
  const ref = (r: CornerRef): CornerRef => ({ wallId: id(r.wallId), end: r.end });
  return constraints.filter(c => constraintWalls(c).every(w => wallIds.has(w))).map(c => {
    const base = { ...c, id: uid() } as Constraint;
    switch (base.kind) {
      case 'length': case 'horizontal': case 'vertical': return { ...base, wallId: id(base.wallId) };
      case 'pointDistance': return { ...base, a: ref(base.a), b: ref(base.b) };
      case 'pointLine': return { ...base, point: ref(base.point), wallId: id(base.wallId) };
      case 'lineDistance': case 'angle': case 'parallel': case 'perpendicular': return { ...base, wallA: id(base.wallA), wallB: id(base.wallB) };
      case 'fix': return {
        ...base, target: 'end' in base.target ? ref(base.target) : { wallId: id(base.target.wallId) },
        at: base.at.map(p => ({ x: p.x + offset.x, y: p.y + offset.y })),
      };
    }
  });
}
