import { describe, expect, it } from 'vitest';
import type { Wall } from '$lib/models/types';
import { hostedPose, wallHostAt, wallSideAt } from '$lib/utils/wallHostedItems';

const wall: Wall = { id: 'w', start: { x: 0, y: 0 }, end: { x: 400, y: 0 }, thickness: 20, height: 280, color: '#eee' };
const outlet = { catalogId: 'sym_outlet', scale: { x: 1, y: 1, z: 1 } }; // 15 × 15 cm

describe('wall hosts', () => {
  it('finds the nearest wall and the side the point is on', () => {
    // The left normal of a wall running +x is +y.
    expect(wallHostAt({ x: 100, y: 30 }, [wall])).toEqual({ wallId: 'w', wallPosition: 0.25, wallSide: 1 });
    expect(wallHostAt({ x: 300, y: -30 }, [wall])).toEqual({ wallId: 'w', wallPosition: 0.75, wallSide: -1 });
  });

  it('has no host away from walls', () => {
    expect(wallHostAt({ x: 100, y: 250 }, [wall])).toBeNull();
    expect(wallHostAt({ x: 100, y: 10 }, [])).toBeNull();
  });

  it('tells the side on a curved wall from its tangent there', () => {
    const curved: Wall = { ...wall, curvePoint: { x: 200, y: 200 } };
    expect(wallSideAt(curved, 0.5, { x: 200, y: 150 })).toBe(1);
    expect(wallSideAt(curved, 0.5, { x: 200, y: 50 })).toBe(-1);
  });
});

describe('hosted pose', () => {
  it('puts the item’s back against the wall face, facing away from the wall', () => {
    const pose = hostedPose(wall, outlet, { wallPosition: 0.25, wallSide: 1 });
    expect(pose.position.x).toBeCloseTo(100);
    expect(pose.position.y).toBeCloseTo(10 + 7.5);
    expect(pose.rotation).toBeCloseTo(0);
  });

  it('turns round on the other side', () => {
    const pose = hostedPose(wall, outlet, { wallPosition: 0.5, wallSide: -1 });
    expect(pose.position.x).toBeCloseTo(200);
    expect(pose.position.y).toBeCloseTo(-17.5);
    expect(pose.rotation).toBeCloseTo(180);
  });

  it('follows the wall’s direction and the item’s own depth', () => {
    const vertical: Wall = { ...wall, end: { x: 0, y: 400 } };
    const pose = hostedPose(vertical, { ...outlet, depth: 30 }, { wallPosition: 0.5, wallSide: 1 });
    // Left normal of a wall running +y is −x.
    expect(pose.position.x).toBeCloseTo(-(10 + 15));
    expect(pose.position.y).toBeCloseTo(200);
    expect(pose.rotation).toBeCloseTo(90);
  });

  it('matches snapping furniture against the same wall', async () => {
    const { snapFurnitureToWalls } = await import('$lib/utils/furnitureGeometry');
    const { getCatalogItem } = await import('$lib/utils/furnitureCatalog');
    const snapped = snapFurnitureToWalls({ x: 100, y: 18 }, getCatalogItem('sym_outlet')!, [wall]);
    const pose = hostedPose(wall, outlet, { wallPosition: 0.25, wallSide: 1 });
    expect(snapped!.rotation).toBeCloseTo(pose.rotation);
    expect(snapped!.position.y).toBeCloseTo(pose.position.y);
  });
});
