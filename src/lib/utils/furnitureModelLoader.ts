/** Lazy GLB furniture with an immediate procedural fallback. */
import * as THREE from 'three';
import { CEILING_SYMBOL_THICKNESS, createFurnitureModel, createSymbolModel, SYMBOL_FACEPLATE, symbolModelKind } from './furnitureModels3d';
import { getCatalogItem, getFurnitureSize, type FurnitureDef } from './furnitureCatalog';
import type { Floor, FurnitureItem, Project } from '$lib/models/types';
import { getModelFile } from './furnitureModelFiles';
import { furnitureElevation } from './furnitureStacking';
import { effectiveElevation, furnitureDrop, furnitureMount, type CeilingAt } from './mounting';
import { furnitureFinishes } from './furnitureFinishes';
import { disposeModel, isModelDisposed, loadCatalogModel, releaseWithModel } from './furnitureModelResources';

export interface FurnitureAppearance { color?: string; material?: string; ghost?: boolean }

function applyAppearance(model: THREE.Group, appearance: FurnitureAppearance, tint: boolean) {
  const seen = new Set<THREE.Material>();
  model.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (seen.has(material)) continue;
      seen.add(material);
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      // A tint keeps the source model's texture and contrasting material detail.
      if (tint && appearance.color) material.color.multiply(new THREE.Color(appearance.color));
      const finish = appearance.material && Object.hasOwn(furnitureFinishes, appearance.material) ? furnitureFinishes[appearance.material] : undefined;
      if (finish) {
        material.roughness = finish.roughness; material.metalness = finish.metalness;
        if (finish.opacity !== undefined) {
          material.opacity *= finish.opacity; material.transparent = true; material.depthWrite = false;
        }
      }
      if (appearance.ghost) {
        material.transparent = true; material.opacity *= 0.5; material.depthWrite = false;
        material.emissive.set(0x4488ff); material.emissiveIntensity = 0.3;
      }
    }
  });
}

/** Match the complete model's footprint, center it, and place its bottom at zero. */
export function fitFurnitureModel(model: THREE.Group, def: FurnitureDef) {
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  if ([size.x, size.y, size.z, def.width, def.height, def.depth].some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Furniture model has invalid dimensions.');
  }
  model.scale.multiply(new THREE.Vector3(def.width / size.x, def.height / size.y, def.depth / size.z));
  model.updateMatrixWorld(true);
  bounds.setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  model.updateMatrixWorld(true);
}

export function createFurnitureModelWithGLB(
  catalogId: string, def: FurnitureDef, onLoaded?: (model: THREE.Group) => void,
  appearance: FurnitureAppearance = {},
): THREE.Group {
  const container = new THREE.Group();
  container.name = `furniture_${catalogId}`;
  const procedural = createFurnitureModel(catalogId, def);
  applyAppearance(procedural, appearance, false);
  container.add(procedural);
  const file = getModelFile(catalogId);
  if (file) void loadCatalogModel(file).then(model => {
    if (!model) return;
    if (isModelDisposed(container)) { disposeModel(model); return; }
    try {
      fitFurnitureModel(model, def);
      applyAppearance(model, appearance, true);
    } catch {
      disposeModel(model);
      return; // The original fallback remains intact and usable.
    }
    container.remove(procedural); disposeModel(procedural);
    container.add(model);
    onLoaded?.(container);
  }).catch(error => { console.warn(`[FurnitureLoader] Model unavailable for ${catalogId}:`, error); });
  return container;
}


/** Retain the procedural fallback until a verified project source is ready. */
function createProjectFurniture(item: FurnitureItem, def: FurnitureDef, project?: Project, onLoaded?: (model: THREE.Group) => void) {
  const container = new THREE.Group();
  container.name = `furniture_${item.customModelId}`;
  const appearance = { color: item.color, material: item.material };
  const fallback = createFurnitureModel(item.catalogId, def);
  applyAppearance(fallback, appearance, false); container.add(fallback);
  if (!project) return container;
  void import('$lib/services/customModelResources').then(async ({ acquireCustomModel }) => {
    if (isModelDisposed(container)) return;
    const lease = acquireCustomModel(project, item.customModelId!);
    releaseWithModel(container, lease.release);
    try {
      const model = await lease.model;
      if (!model) return;
      if (isModelDisposed(container)) { disposeModel(model); return; }
      try { fitFurnitureModel(model, def); applyAppearance(model, appearance, true); }
      catch { disposeModel(model); lease.release(); return; }
      container.remove(fallback); disposeModel(fallback); container.add(model);
      try { onLoaded?.(container); }
      catch (error) { console.warn('[FurnitureLoader] Custom model redraw failed:', error); }
    } catch (error) {
      lease.release();
      if (!isModelDisposed(container)) console.warn('[FurnitureLoader] Custom model unavailable:', error);
    }
  }).catch(error => {
    if (!isModelDisposed(container)) console.warn('[FurnitureLoader] Custom model loader unavailable:', error);
  });
  return container;
}

/** Floor finish the floor-standing and wall-mounted items stand on, cm (room floors render at about this height). */
export const FLOOR_FINISH = 1.5;

/** Cord or downrod from a ceiling item's top up to the ceiling. */
const CORD_RADIUS = 0.4;
const CORD_COLOR = '#2b2b2b';

/**
 * A cord of `drop` cm hanging from the ceiling to the item's top, with a small
 * canopy against the ceiling. `top` is the item's top in the parent's local y;
 * `scale` is the parent's scale, undone here so the cord keeps its real size.
 */
export function createCeilingCord(drop: number, top: number, scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)): THREE.Group {
  const cord = new THREE.Group();
  cord.name = 'ceiling_cord';
  const material = new THREE.MeshStandardMaterial({ color: CORD_COLOR, roughness: 0.4, metalness: 0.6 });
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(CORD_RADIUS, CORD_RADIUS, drop, 6), material);
  wire.position.y = drop / 2;
  const canopyH = Math.min(1.2, drop);
  const canopy = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, canopyH, 16), material);
  canopy.position.y = drop - canopyH / 2;
  cord.add(wire, canopy);
  for (const mesh of [wire, canopy]) { mesh.castShadow = false; mesh.receiveShadow = true; }
  const unscale = (value: number) => (Number.isFinite(value) && value !== 0 ? 1 / Math.abs(value) : 1);
  cord.scale.set(unscale(scale.x), unscale(scale.y), unscale(scale.z));
  cord.position.y = top;
  return cord;
}

/**
 * A plan symbol's 3D stand-in, placed: outlets and switches are a faceplate centred on
 * their mounting height with the back against the wall (the item's back edge, as
 * snapFurnitureToWalls places it); ceiling symbols a disc just under the ceiling.
 */
function createPlacedSymbol(item: FurnitureItem, def: FurnitureDef, bottom: number): THREE.Group | null {
  const kind = symbolModelKind(item.catalogId);
  const symbol = kind && createSymbolModel(item.catalogId, { width: item.width ?? def.width, depth: item.depth ?? def.depth, color: item.color ?? def.color });
  if (!kind || !symbol) return null;
  const container = new THREE.Group();
  container.name = `furniture_${item.catalogId}`;
  container.add(symbol);
  if (kind === 'faceplate') {
    const depth = getFurnitureSize(item).depth;
    symbol.position.z = -depth / 2 + SYMBOL_FACEPLATE.depth / 2;
    container.position.set(item.position.x, FLOOR_FINISH + bottom - SYMBOL_FACEPLATE.height / 2, item.position.y);
  } else {
    const drop = furnitureDrop(item);
    container.position.set(item.position.x, bottom - CEILING_SYMBOL_THICKNESS, item.position.y);
    if (drop > 0) container.add(createCeilingCord(drop, CEILING_SYMBOL_THICKNESS));
  }
  container.rotation.y = -item.rotation * Math.PI / 180;
  return container;
}

/**
 * Build a saved item even when its original catalog is unavailable. `elevation` is the
 * bottom above the floor in cm; pass `effectiveElevation(item, ceilingResolver)` so
 * ceiling items hang from their room's ceiling. Without it, floor and wall items use
 * their effective elevation and ceiling items their stored one (legacy behaviour).
 *
 * Floor and wall items stand on the floor finish (FLOOR_FINISH above the storey
 * level); ceiling items are measured from the ceiling, so their top meets it (or
 * their cord, `drop` cm long, does). Plan symbols get a small stand-in where one
 * makes sense (outlet/switch faceplates, ceiling discs), else no model.
 */
export function createPlacedFurnitureModel(item: FurnitureItem, onLoaded?: (model: THREE.Group) => void, project?: Project, elevation?: number): THREE.Group | null {
  const catalog = getCatalogItem(item.catalogId);
  const custom = project?.customModels?.find(model => model.id === item.customModelId);
  const mount = furnitureMount(item);
  const bottom = elevation ?? (mount === 'ceiling' ? furnitureElevation(item) : effectiveElevation(item, 0));
  if (catalog?.symbol && !item.customModelId) return createPlacedSymbol(item, catalog, bottom);
  const definition: FurnitureDef = {
    id: item.catalogId, name: custom?.name ?? 'Unknown furniture', category: 'Unknown', icon: '🪑',
    ...catalog,
    width: item.width ?? custom?.width ?? catalog?.width ?? 50,
    depth: item.depth ?? custom?.depth ?? catalog?.depth ?? 50,
    height: item.height ?? custom?.height ?? catalog?.height ?? 50,
    color: item.color ?? catalog?.color ?? '#888888',
  };
  const model = item.customModelId ? createProjectFurniture(item, definition, project, onLoaded) : createFurnitureModelWithGLB(item.catalogId, definition, onLoaded, {
    color: item.color, material: item.material,
  });
  model.position.set(item.position.x, (mount === 'ceiling' ? 0 : FLOOR_FINISH) + bottom, item.position.y);
  model.rotation.y = -item.rotation * Math.PI / 180;
  // The plan's Y scale is world Z; height uses the saved Z magnitude.
  model.scale.set(item.scale?.x ?? 1, Math.abs(item.scale?.z ?? 1), item.scale?.y ?? 1);
  const drop = furnitureDrop(item);
  if (drop > 0) model.add(createCeilingCord(drop, definition.height, model.scale));
  return model;
}

/**
 * A floor's placed items as 3D models, each at its effective elevation: ceiling items
 * hang at `ceiling − drop − height` with `ceilingAt` the floor's ceiling resolver
 * (createCeilingResolver), so a ceiling-height change moves them on the next build.
 * Items without a 3D model (most plan symbols) are left out.
 */
export function createFloorFurnitureModels(floor: Pick<Floor, 'furniture'>, ceilingAt: CeilingAt, project?: Project, onLoaded?: (model: THREE.Group) => void): THREE.Group[] {
  return floor.furniture.flatMap(item => createPlacedFurnitureModel(item, onLoaded, project, effectiveElevation(item, ceilingAt)) ?? []);
}
