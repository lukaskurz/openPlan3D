/**
 * 3D door leaves by type, built in the opening's local frame: origin at the
 * centre of the opening on the floor, +x along the wall (start → end), +z along
 * the wall normal. The caller positions the group and rotates it by -wallAngle.
 * Swing sides match the 2D plan symbols in canvasRenderer.
 */
import * as THREE from 'three';
import type { Door } from '$lib/models/types';

/** Door types with full-height glass leaves in white frames. */
export function isGlazedDoor(type: Door['type']): boolean {
  return type === 'balcony' || type === 'french';
}

/** Glass-and-frame doors get white casings; everything else keeps the wood casing. */
export function doorUsesWhiteFrame(type: Door['type']): boolean {
  return isGlazedDoor(type) || type === 'sliding';
}

export function doorGlassPanes(door: Pick<Door, 'glassPanes'>): number {
  const panes = door.glassPanes;
  return typeof panes === 'number' && Number.isFinite(panes) ? Math.max(1, Math.min(8, Math.round(panes))) : 1;
}

const AJAR = 0.26; // ~15°, enough to read the swing without blocking the opening
const WOOD = 0x8b6914, WHITE = 0xf2f2ef;

interface DoorMaterials { wood: THREE.Material; frame: THREE.Material; glass: THREE.Material; metal: THREE.Material }

function materials(): DoorMaterials {
  return {
    wood: new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.5 }),
    frame: new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8d8ea, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.25 }),
  };
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, glass = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.5), Math.max(h, 0.5), Math.max(d, 0.5)), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = !glass;
  mesh.receiveShadow = !glass;
  if (glass) mesh.userData.renderExclude = true;
  return mesh;
}

/** A leaf centred on its own origin: x across, y up (bottom at 0). */
function woodLeaf(w: number, h: number, m: DoorMaterials): THREE.Group {
  const leaf = new THREE.Group();
  leaf.add(box(w, h, 4, m.wood, 0, h / 2));
  return leaf;
}

function glazedLeaf(w: number, h: number, panes: number, m: DoorMaterials): THREE.Group {
  const leaf = new THREE.Group();
  const stile = Math.min(7, w / 5), top = Math.min(7, h / 10), bottom = Math.min(11, h / 8), depth = 6;
  leaf.add(box(stile, h, depth, m.frame, -w / 2 + stile / 2, h / 2));
  leaf.add(box(stile, h, depth, m.frame, w / 2 - stile / 2, h / 2));
  leaf.add(box(w - 2 * stile, top, depth, m.frame, 0, h - top / 2));
  leaf.add(box(w - 2 * stile, bottom, depth, m.frame, 0, bottom / 2));
  const glassH = h - top - bottom, glassW = w - 2 * stile;
  leaf.add(box(glassW, glassH, 1, m.glass, 0, bottom + glassH / 2, 0, true));
  // Glazing bars dividing the glass into equal panes
  for (let i = 1; i < panes; i++) leaf.add(box(glassW, 3, depth - 2, m.frame, 0, bottom + glassH * i / panes));
  return leaf;
}

function leverHandle(leaf: THREE.Group, x: number, y: number, m: DoorMaterials) {
  for (const side of [-1, 1]) leaf.add(box(12, 2, 2, m.metal, x, y, side * 4.5));
}

function knobHandle(leaf: THREE.Group, x: number, y: number, m: DoorMaterials) {
  for (const side of [-1, 1]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), m.metal);
    knob.position.set(x, y, side * 4);
    knob.castShadow = true;
    leaf.add(knob);
  }
}

/**
 * Hinge a leaf at x = hingeX. hingeSide +1 puts the hinge at the +x end (leaf extends
 * towards -x); openSide is the +z/-z side the leaf swings into.
 */
function hinged(leaf: THREE.Group, width: number, hingeX: number, hingeSide: 1 | -1, openSide: 1 | -1, zOffset: number) {
  leaf.position.x = -hingeSide * width / 2;
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, 0, zOffset);
  pivot.rotation.y = hingeSide * openSide * AJAR;
  pivot.add(leaf);
  return pivot;
}

/** Leaves, handles and panels for one door; null for a plain doorway. Garage doors stay in the viewer. */
export function createDoorModel(door: Door, width: number, height: number, wallThickness: number): THREE.Group | null {
  if (door.type === 'opening' || door.type === 'garage') return null;
  const m = materials();
  const group = new THREE.Group();
  group.name = `door_${door.type}`;
  const hingeSide: 1 | -1 = door.swingDirection === 'left' ? 1 : -1;
  const face: 1 | -1 = door.flipSide ? -1 : 1;
  const leafH = Math.max(height - 4, 1), gap = 1, panes = doorGlassPanes(door);
  const handleY = Math.min(105, leafH * 0.5);
  const lift = (leaf: THREE.Group) => { leaf.position.y = gap; return leaf; };

  switch (door.type) {
    case 'single':
    case 'balcony': {
      const w = width - 2;
      const leaf = door.type === 'balcony' ? glazedLeaf(w, leafH, panes, m) : woodLeaf(w, leafH, m);
      (door.type === 'balcony' ? leverHandle : knobHandle)(leaf, -hingeSide * (w / 2 - 8), handleY, m);
      group.add(hinged(lift(leaf), w, hingeSide * width / 2, hingeSide, face, face * 2));
      break;
    }
    case 'double':
    case 'french': {
      // Both leaves open to the same side, as in the plan symbol (hinge choice flips it there too).
      const open = (face * hingeSide) as 1 | -1, w = width / 2 - 1.5;
      for (const side of [1, -1] as const) {
        const leaf = door.type === 'french' ? glazedLeaf(w, leafH, panes, m) : woodLeaf(w, leafH, m);
        (door.type === 'french' ? leverHandle : knobHandle)(leaf, -side * (w / 2 - 8), handleY, m);
        group.add(hinged(lift(leaf), w, side * width / 2, side, open, face * 2));
      }
      break;
    }
    case 'sliding': {
      // Glass patio door: one panel on the wall line, the other on a parallel track, half open.
      const w = width * 0.55, track = wallThickness * 0.15 * face;
      const a = glazedLeaf(w, leafH, panes, m), b = glazedLeaf(w, leafH, panes, m);
      a.position.set(-width / 2 + w / 2, gap, 0);
      b.position.set(width / 2 - w / 2, gap, track);
      leverHandle(b, -w / 2 + 6, handleY, m);
      group.add(a, b);
      break;
    }
    case 'pocket': {
      // Mostly retracted into the wall on the hinge side.
      const w = width - 2, visible = width * 0.35;
      const leaf = woodLeaf(w, leafH, m);
      leaf.position.set(hingeSide * (width / 2 - visible + w / 2), gap, 0);
      group.add(leaf);
      break;
    }
    case 'bifold': {
      // Four panels folded in a zigzag, following the plan symbol.
      const count = 4, w = width / count;
      let x = -width / 2, z = 0;
      for (let i = 0; i < count; i++) {
        const angle = i % 2 === 0 ? (Math.PI / 6) * hingeSide : (-Math.PI / 6) * hingeSide * 0.3;
        const dx = Math.cos(angle) * w, dz = Math.sin(angle) * w;
        const panel = woodLeaf(w - 1, leafH, m);
        panel.position.set(x + dx / 2, gap, z + dz / 2);
        panel.rotation.y = -angle;
        group.add(panel);
        x += dx; z += dz;
      }
      break;
    }
  }
  return group;
}
