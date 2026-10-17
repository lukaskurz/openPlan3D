import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { FurnitureItem } from '$lib/models/types';
import { furnitureCatalog, furnitureTrade, getCatalogItem } from '$lib/utils/furnitureCatalog';
import { DEFAULT_WALL_MOUNT_HEIGHT, defaultMountingHeight, defSurface, effectiveElevation, furnitureDrop, furnitureMount, itemSurface } from '$lib/utils/mounting';
import { createFurnitureModel } from '$lib/utils/furnitureModels3d';
import { furnitureName } from '$lib/i18n/furnitureNames';

const item = (catalogId: string, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id: catalogId, catalogId, position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

describe('catalog mounts and trades', () => {
  it('mounts ceiling fixtures on the ceiling and outlets, switches and sconces on walls', () => {
    for (const id of ['ceiling_light', 'recessed_light', 'pendant_light', 'chandelier', 'ceiling_projector', 'ceiling_fan', 'smoke_detector',
      'sym_ceiling_light', 'sym_recessed_light', 'sym_pendant', 'sym_ceiling_fan', 'sym_smoke']) {
      expect(getCatalogItem(id)?.mount, id).toBe('ceiling');
      expect(getCatalogItem(id)?.elevation, id).toBeUndefined();
    }
    expect(getCatalogItem('sym_outlet')).toMatchObject({ mount: 'wall', elevation: 30 });
    expect(getCatalogItem('sym_switch')).toMatchObject({ mount: 'wall', elevation: 105 });
    expect(getCatalogItem('wall_sconce')).toMatchObject({ mount: 'wall', elevation: 170 });
    expect(getCatalogItem('wall_sconce_outdoor')?.mount).toBe('wall');
    expect(getCatalogItem('sofa')?.mount).toBeUndefined();
    expect(getCatalogItem('pendant_light')?.defaultDrop).toBe(60);
    expect(getCatalogItem('chandelier')?.defaultDrop).toBe(30);
  });

  it('derives trades from categories, with explicit exceptions', () => {
    expect(furnitureTrade(getCatalogItem('sym_outlet')!)).toBe('electrical');
    expect(furnitureTrade(getCatalogItem('pendant_light')!)).toBe('electrical');
    expect(furnitureTrade(getCatalogItem('sym_drain')!)).toBe('plumbing');
    expect(furnitureTrade(getCatalogItem('toilet')!)).toBe('furnishing');
    expect(furnitureTrade(getCatalogItem('sink_k')!)).toBe('furnishing');
    expect(furnitureTrade(getCatalogItem('floor_lamp')!)).toBe('furnishing');
    expect(furnitureTrade(getCatalogItem('table_lamp')!)).toBe('furnishing');
    expect(furnitureTrade(getCatalogItem('lamp_post')!)).toBe('furnishing');
    expect(furnitureTrade(getCatalogItem('ceiling_projector')!)).toBe('furnishing');
    expect(furnitureTrade(item('smoke_detector'))).toBe('electrical');
    expect(furnitureTrade(item('unknown-custom'))).toBe('furnishing');
    // Every catalog entry has exactly one of the three trades.
    for (const def of furnitureCatalog) expect(['furnishing', 'electrical', 'plumbing']).toContain(furnitureTrade(def));
  });

  it('adds a 3D ceiling fan and smoke detector with names and models inside their boxes', () => {
    for (const id of ['ceiling_fan', 'smoke_detector']) {
      const def = getCatalogItem(id)!;
      expect(def.symbol).toBeUndefined();
      expect(furnitureName(id, 'pt')).not.toBe(def.name);
      const box = new THREE.Box3().setFromObject(createFurnitureModel(id, def));
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y).toBeLessThanOrEqual(def.height + 0.01);
      expect(box.max.x - box.min.x).toBeLessThanOrEqual(def.width + 0.01);
    }
  });

  it('builds the wall sconce in its own box so its mounting height lifts it', () => {
    const def = getCatalogItem('wall_sconce')!;
    const box = new THREE.Box3().setFromObject(createFurnitureModel('wall_sconce', def));
    expect(box.min.y).toBeCloseTo(0);
    expect(box.max.y).toBeCloseTo(def.height);
  });
});

describe('mounting', () => {
  it('reads the mount from the item, then the catalog, then floor', () => {
    expect(furnitureMount(item('sofa'))).toBe('floor');
    expect(furnitureMount(item('pendant_light'))).toBe('ceiling');
    expect(furnitureMount(item('sym_outlet'))).toBe('wall');
    expect(furnitureMount(item('sofa', { mount: 'wall' }))).toBe('wall');
    expect(furnitureMount(item('pendant_light', { mount: 'floor' }))).toBe('floor');
    expect(furnitureMount(item('unknown-custom'))).toBe('floor');
  });

  it('puts ceiling items on the ceiling surface and everything else on the floor', () => {
    expect(itemSurface(item('pendant_light'))).toBe('ceiling');
    expect(itemSurface(item('sym_switch'))).toBe('floor');
    expect(itemSurface(item('sofa'))).toBe('floor');
    expect(defSurface(getCatalogItem('sym_smoke')!)).toBe('ceiling');
    expect(defSurface(getCatalogItem('sym_outlet')!)).toBe('floor');
  });

  it('reads the drop of ceiling items only', () => {
    expect(furnitureDrop(item('pendant_light'))).toBe(60);
    expect(furnitureDrop(item('pendant_light', { drop: 25 }))).toBe(25);
    expect(furnitureDrop(item('pendant_light', { drop: 0 }))).toBe(0);
    expect(furnitureDrop(item('pendant_light', { drop: -5 }))).toBe(0);
    expect(furnitureDrop(item('ceiling_light'))).toBe(0);
    expect(furnitureDrop(item('sofa', { drop: 40 }))).toBe(0);
  });

  it('hangs ceiling items at ceiling − drop − height and keeps stored elevations otherwise', () => {
    // Pendant: 30 cm shade, 60 cm cord.
    expect(effectiveElevation(item('pendant_light'), 280)).toBe(190);
    expect(effectiveElevation(item('pendant_light', { drop: 20 }), 280)).toBe(230);
    expect(effectiveElevation(item('pendant_light', { height: 50, drop: 0 }), 250)).toBe(200);
    expect(effectiveElevation(item('pendant_light', { scale: { x: 1, y: 1, z: 2 }, drop: 0 }), 280)).toBe(220);
    // A stale elevation on a ceiling item is ignored.
    expect(effectiveElevation(item('ceiling_projector', { elevation: 245 }), 300)).toBe(265);
    // The resolver is asked at the item's position.
    const asked: unknown[] = [];
    expect(effectiveElevation(item('ceiling_light', { position: { x: 7, y: 9 } }), p => { asked.push(p); return 240; })).toBe(225);
    expect(asked).toEqual([{ x: 7, y: 9 }]);
    // Never below the floor.
    expect(effectiveElevation(item('pendant_light'), 50)).toBe(0);
    expect(effectiveElevation(item('sym_outlet', { elevation: 30 }), 280)).toBe(30);
    expect(effectiveElevation(item('tv', { elevation: 50 }), () => { throw new Error('floor items never ask'); })).toBe(50);
    expect(effectiveElevation(item('sofa'), 280)).toBe(0);
  });

  it('chooses the elevation stored when an item is placed', () => {
    expect(defaultMountingHeight(getCatalogItem('sym_outlet')!)).toBe(30);
    expect(defaultMountingHeight(getCatalogItem('sym_switch')!)).toBe(105);
    expect(defaultMountingHeight({ mount: 'wall' })).toBe(DEFAULT_WALL_MOUNT_HEIGHT);
    expect(defaultMountingHeight(getCatalogItem('ceiling_projector')!)).toBeUndefined();
    expect(defaultMountingHeight({ mount: 'ceiling', elevation: 245 })).toBeUndefined();
    expect(defaultMountingHeight(getCatalogItem('tv_lowboard')!)).toBe(25);
    expect(defaultMountingHeight(getCatalogItem('sofa')!)).toBeUndefined();
  });
});

describe('older wall items', () => {
  it('hang at the catalog mounting height when saved without an elevation', () => {
    expect(effectiveElevation(item('wall_sconce'), 280)).toBe(170);
    expect(effectiveElevation(item('sym_outlet'), 280)).toBe(30);
    expect(effectiveElevation(item('wall_sconce', { elevation: 0 }), 280)).toBe(0);
    expect(effectiveElevation(item('sofa', { mount: 'wall' }), 280)).toBe(DEFAULT_WALL_MOUNT_HEIGHT);
  });
});
