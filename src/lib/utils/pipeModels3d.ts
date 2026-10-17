import * as THREE from 'three';
import type { Floor, Pipe, Point, Project } from '$lib/models/types';
import { PIPE_COLORS, PIPE_RUN_ELEVATION } from './pipes';
import { floorElevations, DEFAULT_FLOOR_SPACING } from './floors';
import { DEFAULT_SLAB_THICKNESS } from './ceilingHeights';
import { FLOOR_FINISH } from './furnitureModelLoader';
import type { CeilingAt } from './mounting';

/**
 * Pipes in the 3D viewer (spec §4.5): a tube along each run, coloured by kind, and
 * a vertical tube through the storey for risers. Tubes are deliberately NOT tagged
 * `userData.xray`: x-ray fades the tagged meshes (walls, ceilings), so untagged pipes
 * stay solid and show through the faded walls and ceilings. Plan (x, y) maps to 3D (x, z); y is up, in cm
 * above the storey's floor.
 */

/** Thinnest tube radius in cm, so a 16 mm pipe still reads in a room-sized view. */
export const MIN_PIPE_RADIUS = 0.8;
/** Gap between a ceiling run's top and the ceiling, cm. */
export const CEILING_PIPE_GAP = 2;

/** Tube radius in cm for a diameter in mm. */
export function pipeRadius(pipe: Pick<Pipe, 'diameter'>): number {
  return Math.max(MIN_PIPE_RADIUS, pipe.diameter / 20);
}

/**
 * Height of a run's centre above the storey floor (y = 0), in cm. An explicit elevation
 * is measured from the floor finish. Without one: floor runs lie on the finish (their
 * nominal place in the screed would hide them under the slab), wall runs at the wall
 * run height, ceiling runs just under the lowest ceiling they pass, level.
 */
export function pipeCentreHeight(pipe: Pipe, ceilingAt: CeilingAt): number {
  const radius = pipeRadius(pipe);
  if (pipe.elevation !== undefined) return FLOOR_FINISH + pipe.elevation;
  if (pipe.run === 'ceiling') {
    const lowest = Math.min(...pipe.points.map(p => typeof ceilingAt === 'number' ? ceilingAt : ceilingAt(p)));
    return (Number.isFinite(lowest) ? lowest : DEFAULT_FLOOR_SPACING) - radius - CEILING_PIPE_GAP;
  }
  if (pipe.run === 'wall') return FLOOR_FINISH + PIPE_RUN_ELEVATION.wall;
  return FLOOR_FINISH + radius;
}

/** Distance from this storey's floor to the next storey's floor (the floorElevations spacing). */
export function storeySpacing(project: Pick<Project, 'floors'> | undefined, floor: Floor): number {
  if (!project) return DEFAULT_FLOOR_SPACING;
  const entries = floorElevations(project.floors);
  const index = entries.findIndex(entry => entry.floor.id === floor.id);
  if (index < 0) return DEFAULT_FLOOR_SPACING;
  const above = entries.slice(index + 1).find(entry => entry.elevation > entries[index].elevation);
  return above ? above.elevation - entries[index].elevation : DEFAULT_FLOOR_SPACING;
}

const SAMPLE_CM = 5;

function tubeAlong(points: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Mesh | null {
  const path = new THREE.CurvePath<THREE.Vector3>();
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceTo(points[i - 1]) < 1e-6) continue;
    path.add(new THREE.LineCurve3(points[i - 1], points[i]));
    length += points[i].distanceTo(points[i - 1]);
  }
  if (!path.curves.length) return null;
  // Tubes sample the path evenly by length: sample finely so bends stay close to the corners.
  const segments = Math.min(1024, Math.max(path.curves.length, Math.ceil(length / SAMPLE_CM)));
  return new THREE.Mesh(new THREE.TubeGeometry(path, segments, radius, 8, false), material);
}

/**
 * Meshes for a floor's pipes. `ceilingAt` gives the ceiling over a plan point (see
 * createCeilingResolver); `storeyHeight` is how far a riser rises (to the next floor).
 */
export function buildPipeMeshes(floor: Pick<Floor, 'pipes' | 'slabThickness'>, ceilingAt: CeilingAt, storeyHeight = DEFAULT_FLOOR_SPACING): THREE.Object3D[] {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (kind: Pipe['kind']) => {
    let m = materials.get(kind);
    if (!m) { m = new THREE.MeshStandardMaterial({ color: PIPE_COLORS[kind] ?? PIPE_COLORS.cold, roughness: 0.45, metalness: kind === 'waste' ? 0 : 0.3 }); materials.set(kind, m); }
    return m;
  };
  const out: THREE.Object3D[] = [];
  for (const pipe of floor.pipes ?? []) {
    if (!pipe.points.length) continue;
    const radius = pipeRadius(pipe), mat = material(pipe.kind);
    const group = new THREE.Group();
    group.userData.pipeId = pipe.id;
    const y = pipeCentreHeight(pipe, ceilingAt);
    const at = (p: Point, height = y) => new THREE.Vector3(p.x, height, p.y);
    if (pipe.points.length >= 2) {
      const vertices = pipe.points.map(p => at(p));
      const tube = tubeAlong(vertices, radius, mat);
      if (tube) group.add(tube);
      // Round joints fill the bends.
      for (const v of vertices.slice(1, -1)) {
        const joint = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), mat);
        joint.position.copy(v);
        group.add(joint);
      }
    }
    if (pipe.riser) {
      // A stack through the slab below up to the next floor.
      const bottom = -(floor.slabThickness ?? DEFAULT_SLAB_THICKNESS);
      const stack = tubeAlong([at(pipe.points[0], bottom), at(pipe.points[0], Math.max(storeyHeight, bottom + 1))], radius, mat);
      if (stack) group.add(stack);
    }
    group.traverse(child => {
      if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; child.userData.pipeId = pipe.id; }
    });
    if (group.children.length) out.push(group);
  }
  return out;
}
