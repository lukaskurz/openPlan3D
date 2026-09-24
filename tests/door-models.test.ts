import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDoorModel, doorGlassPanes, doorUsesWhiteFrame, isGlazedDoor } from '$lib/utils/doorModels3d';
import { readProject } from '$lib/utils/projectValidation';
import { roomProject } from './fixtures/project';
import type { Door } from '$lib/models/types';

const door = (type: Door['type'], extra: Partial<Door> = {}): Door =>
  ({ id: 'd', wallId: 'w', position: 0.5, width: type === 'french' || type === 'double' ? 150 : 90, height: 220, type, swingDirection: 'left', flipSide: false, ...extra });
const meshes = (group: THREE.Object3D) => { const list: THREE.Mesh[] = []; group.traverse(o => { if (o instanceof THREE.Mesh) list.push(o); }); return list; };
const glass = (group: THREE.Object3D) => meshes(group).filter(m => m.userData.renderExclude);
const colour = (mesh: THREE.Mesh) => (mesh.material as THREE.MeshStandardMaterial).color.getHex();
/** World-space centre of every leaf-sized mesh (wood slab or glass). */
function leafCentres(group: THREE.Object3D) {
  group.updateMatrixWorld(true);
  return meshes(group).filter(m => m.userData.renderExclude || colour(m) === 0x8b6914)
    .map(m => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()));
}

describe('3D door models', () => {
  it('builds glass balcony and French doors with one and two leaves in white frames', () => {
    const balcony = createDoorModel(door('balcony'), 90, 220, 20)!;
    const french = createDoorModel(door('french'), 150, 220, 20)!;
    expect(glass(balcony)).toHaveLength(1);
    expect(glass(french)).toHaveLength(2);
    expect(meshes(french).some(m => colour(m) === 0x8b6914)).toBe(false); // no wood
    expect(isGlazedDoor('french') && isGlazedDoor('balcony') && !isGlazedDoor('single')).toBe(true);
    expect(doorUsesWhiteFrame('french') && doorUsesWhiteFrame('sliding') && !doorUsesWhiteFrame('double')).toBe(true);
  });

  it('keeps wood doors wood, with two leaves for a double door', () => {
    expect(glass(createDoorModel(door('single'), 90, 210, 20)!)).toHaveLength(0);
    expect(leafCentres(createDoorModel(door('double'), 150, 210, 20)!)).toHaveLength(2);
    expect(createDoorModel(door('opening'), 100, 210, 20)).toBeNull();
    expect(createDoorModel(door('garage'), 240, 210, 20)).toBeNull();
  });

  it('divides glass leaves into panes with glazing bars', () => {
    const count = (panes: number) => meshes(createDoorModel(door('balcony', { glassPanes: panes }), 90, 220, 20)!).length;
    expect(count(4) - count(1)).toBe(3);
    expect(doorGlassPanes({ glassPanes: 99 })).toBe(8);
    expect(doorGlassPanes({})).toBe(1);
  });

  it('swings leaves to the chosen side, matching the plan symbol', () => {
    for (const swingDirection of ['left', 'right'] as const) {
      const inward = leafCentres(createDoorModel(door('balcony', { swingDirection }), 90, 220, 20)!)[0];
      const outward = leafCentres(createDoorModel(door('balcony', { swingDirection, flipSide: true }), 90, 220, 20)!)[0];
      expect(inward.z).toBeGreaterThan(2);
      expect(outward.z).toBeLessThan(-2);
    }
    for (const c of leafCentres(createDoorModel(door('french'), 150, 220, 20)!)) expect(c.z).toBeGreaterThan(2);
  });

  it('saves balcony doors and validates glass panes', () => {
    const project = roomProject(), floor = project.floors[0];
    floor.doors = [door('balcony', { wallId: floor.walls[0].id, glassPanes: 3 })];
    expect(readProject(project).floors[0].doors[0]).toMatchObject({ type: 'balcony', glassPanes: 3 });
    floor.doors = [door('french', { wallId: floor.walls[0].id, glassPanes: 0 })];
    expect(() => readProject(project)).toThrow();
  });
});
