import * as THREE from 'three';
import type { FurnitureDef } from './furnitureCatalog';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { chaiseSofaLayout, lSofaLayout, dividerLayout, DIVIDER_FOOT_RADIUS, DIVIDER_SLAT, SHELF_DIVIDER_RODS, SLAT_DIVIDER_RODS } from './furnitureIcons';

// Helper to darken/lighten colors
function adjustColor(color: string, factor: number): number {
  const tempColor = new THREE.Color(color);
  tempColor.multiplyScalar(factor);
  return tempColor.getHex();
}

// Helper to create standard material
function createMaterial(color: THREE.ColorRepresentation, roughness = 0.7, metalness = 0.1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
  });
}

// Helper to add shadow casting to all meshes in a group
function enableShadows(group: THREE.Group): void {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      // Glowing bulbs and lenses stay out of the shadow maps: the fixture's light sits at them.
      const glows = (Array.isArray(child.material) ? child.material : [child.material]).some(m => m.userData.fixtureGlow && !m.userData.fixtureGlowTint);
      child.castShadow = child.userData.castShadow ?? !glows;
      child.receiveShadow = true;
    }
  });
}

export function createFurnitureModel(catalogId: string, def: FurnitureDef): THREE.Group {
  const group = new THREE.Group();
  const { width, depth, height, color } = def;
  
  // Convert cm to Three.js units (assuming 1 unit = 1cm)
  const w = width;
  const d = depth; 
  const h = height;

  switch (catalogId) {
    case 'stairs': {
      // Scan/import preview; building stairs remain separately editable.
      const steps = 10;
      for (let i = 0; i < steps; i++) {
        const stepHeight = h * (i + 1) / steps;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, stepHeight, d / steps), createMaterial(color));
        mesh.position.set(0, stepHeight / 2, d / 2 - (i + 0.5) * d / steps);
        group.add(mesh);
      }
      break;
    }
    case 'sofa':
      createSofa(group, w, d, h, color);
      break;
    case 'sofa_chaise':
      createChaiseSofa(group, w, d, h, color);
      break;
    case 'sofa_l':
      createSofaL(group, w, d, h, color);
      break;
    case 'loveseat':
      createLoveseat(group, w, d, h, color);
      break;
    case 'chair':
      createArmchair(group, w, d, h, color);
      break;
    case 'coffee_table':
      createCoffeeTable(group, w, d, h, color);
      break;
    case 'tv_stand':
      createTVStand(group, w, d, h, color);
      break;
    case 'tv_lowboard':
      createTVLowboard(group, w, d, h, color);
      break;
    case 'ceiling_projector':
      createCeilingProjector(group, w, d, h, color);
      break;
    case 'bookshelf':
      createBookshelf(group, w, d, h, color);
      break;
    case 'slat_divider':
      createSlatDivider(group, w, d, h, color);
      break;
    case 'shelf_divider':
      createShelfDivider(group, w, d, h, color);
      break;
    case 'side_table':
      createSideTable(group, w, d, h, color);
      break;
    case 'bed_queen':
      createBed(group, w, d, h, color, 'queen');
      break;
    case 'bed_twin':
      createBed(group, w, d, h, color, 'twin');
      break;
    case 'nightstand':
      createNightstand(group, w, d, h, color);
      break;
    case 'dresser':
      createDresser(group, w, d, h, color);
      break;
    case 'wardrobe':
      createWardrobe(group, w, d, h, color);
      break;
    case 'stove':
      createStove(group, w, d, h, color);
      break;
    case 'fridge':
      createFridge(group, w, d, h, color);
      break;
    case 'wine_fridge':
      createWineFridge(group, w, d, h, color);
      break;
    case 'sink_k':
      createKitchenSink(group, w, d, h, color);
      break;
    case 'counter':
      createCounter(group, w, d, h, color);
      break;
    case 'dishwasher':
      createDishwasher(group, w, d, h, color);
      break;
    case 'oven':
      createOven(group, w, d, h, color);
      break;
    case 'toilet':
      createToilet(group, w, d, h, color);
      break;
    case 'bathtub':
      createBathtub(group, w, d, h, color);
      break;
    case 'shower':
      createShower(group, w, d, h, color);
      break;
    case 'sink_b':
      createBathroomSink(group, w, d, h, color);
      break;
    case 'washer_dryer':
      createWasherDryer(group, w, d, h, color);
      break;
    case 'desk':
      createDesk(group, w, d, h, color);
      break;
    case 'office_chair':
      createOfficeChair(group, w, d, h, color);
      break;
    case 'dining_table':
      createDiningTable(group, w, d, h, color);
      break;
    case 'dining_chair':
      createDiningChair(group, w, d, h, color);
      break;
    case 'fireplace':
      createFireplace(group, w, d, h, color);
      break;
    case 'television':
      createTelevision(group, w, d, h, color);
      break;
    case 'storage':
      createStorage(group, w, d, h, color);
      break;
    case 'table':
      createGenericTable(group, w, d, h, color);
      break;
    // Decor
    case 'rug':
    case 'runner_rug':
      createRug(group, w, d, h, color);
      break;
    case 'round_rug':
      createRoundRug(group, w, d, h, color);
      break;
    case 'potted_plant':
      createPottedPlant(group, w, d, h, color);
      break;
    case 'floor_plant':
      createFloorPlant(group, w, d, h, color);
      break;
    case 'hanging_plant':
      createHangingPlant(group, w, d, h, color);
      break;
    case 'curtain':
    case 'sheer_curtain':
      createCurtain(group, w, d, h, color, catalogId === 'sheer_curtain');
      break;
    case 'wall_art':
      createWallArt(group, w, d, h, color);
      break;
    case 'mirror':
      createMirror(group, w, d, h, color);
      break;
    case 'clock':
      createClock(group, w, d, h, color);
      break;
    // Lighting
    case 'ceiling_light':
      createCeilingLight(group, w, d, h, color);
      break;
    case 'chandelier':
      createChandelier(group, w, d, h, color);
      break;
    case 'recessed_light':
      createRecessedLight(group, w, d, h, color);
      break;
    case 'floor_lamp':
      createFloorLamp(group, w, d, h, color);
      break;
    case 'table_lamp':
      createTableLamp(group, w, d, h, color);
      break;
    case 'wall_sconce':
      createWallSconce(group, w, d, h, color);
      break;
    case 'pendant_light':
      createPendantLight(group, w, d, h, color);
      break;
    case 'ceiling_fan':
      createCeilingFan(group, w, d, h, color);
      break;
    case 'smoke_detector':
      createSmokeDetector(group, w, d, h, color);
      break;
    // Outdoor furniture
    case 'bench_outdoor':
      createBenchOutdoor(group, w, d, h, color);
      break;
    case 'picnic_table':
      createPicnicTable(group, w, d, h, color);
      break;
    case 'patio_table':
      createPatioTable(group, w, d, h, color);
      break;
    case 'patio_chair':
      createPatioChair(group, w, d, h, color);
      break;
    case 'umbrella':
      createUmbrella(group, w, d, h, color);
      break;
    case 'bbq_grill':
      createBBQGrill(group, w, d, h, color);
      break;
    case 'pergola':
      createPergola(group, w, d, h, color);
      break;
    case 'gazebo':
      createGazebo(group, w, d, h, color);
      break;
    case 'picket_fence':
      createPicketFence(group, w, d, h, color);
      break;
    case 'metal_fence':
      createMetalFence(group, w, d, h, color);
      break;
    case 'lounger':
      createLounger(group, w, d, h, color);
      break;
    case 'shed':
    case 'garden_shed':
      createGardenShed(group, w, d, h, color);
      break;
    case 'planter_box':
      createPlanterBox(group, w, d, h, color);
      break;
    case 'raised_bed':
      createRaisedBed(group, w, d, h, color);
      break;
    case 'deck_patio':
      createDeckPatio(group, w, d, h, color);
      break;
    // Pool & Spa
    case 'pool_rectangular':
    case 'pool_round':
    case 'pool_lshaped':
    case 'pool_kidney':
      createPool(group, w, d, h, color, catalogId);
      break;
    case 'hot_tub':
      createHotTub(group, w, d, h, color);
      break;
    case 'diving_board':
      createDivingBoard(group, w, d, h);
      break;
    // Garage
    case 'car_sedan':
    case 'car_suv':
      createCar(group, w, d, h, color);
      break;
    // Paths & Lawns
    case 'lawn_rect':
    case 'lawn_square':
    case 'lawn_large':
      createLawn(group, w, d, h, color);
      break;
    case 'path_straight':
    case 'path_wide':
    case 'driveway':
      createPath(group, w, d, h, color);
      break;
    case 'patio_stone':
    case 'gravel_area':
      createFlatSurface(group, w, d, h, color);
      break;
    // Outdoor Lighting
    case 'lamp_post':
    case 'lamp_post_double':
      createLampPost(group, w, d, h, color, catalogId === 'lamp_post_double');
      break;
    case 'bollard_light':
      createBollardLight(group, w, d, h, color);
      break;
    // Garden Structures
    case 'greenhouse':
    case 'greenhouse_small':
      createGreenhouse(group, w, d, h);
      break;
    case 'fountain':
      createFountain(group, w, d, h, color);
      break;
    case 'arbor':
    case 'trellis':
      createArbor(group, w, d, h, color);
      break;
    default:
      // Fallback to simple box
      const geometry = new THREE.BoxGeometry(w, h, d);
      const material = createMaterial(color);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = h / 2;
      group.add(mesh);
      break;
  }

  enableShadows(group);
  return group;
}

// Living Room furniture
function createSofa(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const baseColor = createMaterial(color);
  const darkColor = createMaterial(color, 0.7, 0.1);
  darkColor.color.multiplyScalar(0.9);

  // Main seat base
  const seatGeo = new THREE.BoxGeometry(w * 0.9, h * 0.5, d * 0.7);
  const seatMesh = new THREE.Mesh(seatGeo, baseColor);
  seatMesh.position.set(0, h * 0.25, d * 0.05);
  group.add(seatMesh);

  // Back cushions (3 bumps) — at negative Z (back/top in 2D)
  const cushionWidth = w * 0.25;
  for (let i = 0; i < 3; i++) {
    const cushionGeo = new THREE.BoxGeometry(cushionWidth, h * 0.6, d * 0.25);
    const cushionMesh = new THREE.Mesh(cushionGeo, baseColor);
    cushionMesh.position.set(-w * 0.3 + i * cushionWidth, h * 0.55, -d * 0.3);
    group.add(cushionMesh);
  }

  // Left armrest
  const armGeo = new THREE.BoxGeometry(w * 0.15, h * 0.8, d * 0.8);
  const leftArm = new THREE.Mesh(armGeo, darkColor);
  leftArm.position.set(-w * 0.425, h * 0.4, 0);
  group.add(leftArm);

  // Right armrest
  const rightArm = new THREE.Mesh(armGeo, darkColor);
  rightArm.position.set(w * 0.425, h * 0.4, 0);
  group.add(rightArm);
}

/** Big corner sofa with a chaise on the left, modelled on a 300 × 225 × 86 cm quilted sofa. */
function createChaiseSofa(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const fabric = createMaterial(color, 0.95, 0);
  const body = createMaterial(color, 0.95, 0);
  body.color.multiplyScalar(0.9);
  const metal = createMaterial('#d4d4d8', 0.25, 0.9);
  const L = chaiseSofaLayout(w, d);
  const x0 = -w / 2, z0 = -d / 2, x1 = w / 2, z1 = d / 2;
  // Heights from the reference: 5 cm feet, 41 cm seat, ~62 cm arms, 86 cm to the cushion tops.
  const foot = h * 0.058, baseTop = h * 0.33, seatTop = h * 0.477, armTop = h * 0.72, backTop = h * 0.7;
  const soft = (xa: number, za: number, xb: number, zb: number, ya: number, yb: number, material: THREE.Material, radius: number, gap = 0) => {
    const sx = Math.max(xb - xa - gap, 0.5), sy = Math.max(yb - ya, 0.5), sz = Math.max(zb - za - gap, 0.5);
    const r = Math.min(radius, sx / 2, sy / 2, sz / 2) * 0.99;
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, r), material);
    mesh.position.set((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
    group.add(mesh);
    return mesh;
  };
  const inset = L.arm * 0.15;
  // Plinth on metal feet
  soft(x0 + inset, z0 + inset, x0 + L.chaise, z1 - inset, foot, baseTop, body, 3);
  soft(x0 + L.chaise - 5, z0 + inset, x1 - inset, z0 + L.main - inset, foot, baseTop, body, 3);
  const feet: [number, number][] = [[x0 + 6, z0 + 6], [x1 - 6, z0 + 6], [x0 + 6, z1 - 6], [x0 + L.chaise - 6, z1 - 6], [x1 - 6, z0 + L.main - 6], [x0 + L.chaise - 6, z0 + L.main - 6]];
  for (const [fx, fz] of feet) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, foot, 5), metal);
    mesh.position.set(fx, foot / 2, fz);
    group.add(mesh);
  }
  // Arms: a long one down the chaise, a shorter rounded one on the right
  soft(x0, z0, x0 + L.arm, z1, foot, armTop, body, L.arm * 0.45);
  soft(x1 - L.arm, z0, x1, z0 + L.main, foot, armTop, body, L.arm * 0.45);
  // Back frame
  soft(x0 + L.arm, z0, x1 - L.arm, z0 + L.backFrame, baseTop, backTop, body, 4);
  // Channel-quilted seat cushions
  const channels = (xa: number, xb: number, za: number, zb: number) => {
    const n = Math.max(1, Math.round((xb - xa) / L.channel));
    for (let i = 0; i < n; i++) {
      soft(xa + (xb - xa) * i / n, za, xa + (xb - xa) * (i + 1) / n, zb, baseTop, seatTop, fabric, (seatTop - baseTop) * 0.45, 1);
    }
  };
  channels(x0 + L.arm, x0 + L.chaise, z0 + L.backFrame, z1);
  channels(x0 + L.chaise, x1 - L.arm, z0 + L.backFrame, z0 + L.main);
  // Four large loose back cushions, leaning slightly back
  const span = w - 2 * L.arm, count = 4;
  for (let i = 0; i < count; i++) {
    const xa = x0 + L.arm + span * i / count;
    const cushion = soft(xa, z0 + L.backFrame * 0.6, xa + span / count, z0 + L.backFrame + L.backCushion * 0.9, seatTop - 2, h, fabric, L.backCushion * 0.45, 2);
    cushion.rotation.x = -0.12;
  }
  // Scatter cushions: two on the chaise, two on the main section
  const scatter = Math.min(45, span / 7), front = z0 + L.backFrame + L.backCushion;
  for (const cx of [x0 + L.arm + scatter * 0.7, x0 + L.arm + scatter * 1.8, x1 - L.arm - scatter * 1.8, x1 - L.arm - scatter * 0.7]) {
    const cushion = soft(cx - scatter / 2, front - scatter * 0.3, cx + scatter / 2, front, seatTop, seatTop + scatter, fabric, scatter * 0.3);
    cushion.rotation.set(-0.25, (cx < 0 ? 0.2 : -0.2), 0);
  }
}

/** Corner sectional: backs along the rear (-Z) and right (+X) sides, arms at both open ends. */
function createSofaL(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const fabric = createMaterial(color);
  const frame = createMaterial(color, 0.8, 0.05);
  frame.color.multiplyScalar(0.82);
  const { seat: S, back: B, arm: A } = lSofaLayout(w, d);
  const x0 = -w / 2, z0 = -d / 2, x1 = w / 2, z1 = d / 2;
  const seatTop = h * 0.5, baseTop = h * 0.32, armTop = h * 0.68;
  // Axis-aligned box from plan corners (x, z) and a vertical span.
  const box = (xa: number, za: number, xb: number, zb: number, ya: number, yb: number, material: THREE.Material, inset = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(xb - xa - inset, 0.1), yb - ya, Math.max(zb - za - inset, 0.1)), material);
    mesh.position.set((xa + xb) / 2, (ya + yb) / 2, (za + zb) / 2);
    group.add(mesh);
  };
  // Plinth under the whole L
  box(x0, z0, x1, z0 + S, 0, baseTop, frame);
  box(x1 - S, z0 + S, x1, z1, 0, baseTop, frame);
  // Backs
  box(x0, z0, x1, z0 + B, baseTop, h, frame);
  box(x1 - B, z0 + B, x1, z1, baseTop, h, frame);
  // Arms
  box(x0, z0 + B, x0 + A, z0 + S, baseTop, armTop, frame);
  box(x1 - S, z1 - A, x1 - B, z1, baseTop, armTop, frame);
  // Seat cushions along the long run, then the corner and return
  const run = w - A - S, cushions = Math.max(1, Math.round(run / Math.max(S, 1)));
  for (let i = 0; i < cushions; i++) {
    const xa = x0 + A + run * i / cushions;
    box(xa, z0 + B, xa + run / cushions, z0 + S, baseTop, seatTop, fabric, 1.5);
  }
  box(x1 - S, z0 + B, x1 - B, z0 + S, baseTop, seatTop, fabric, 1.5);
  const ret = d - S - A, returnCushions = Math.max(1, Math.round(ret / Math.max(S, 1)));
  for (let i = 0; i < returnCushions; i++) {
    const za = z0 + S + ret * i / returnCushions;
    box(x1 - S, za, x1 - B, za + ret / returnCushions, baseTop, seatTop, fabric, 1.5);
  }
  // Back cushions leaning on both backs
  const cushionDepth = B * 0.9, backTop = h * 0.95;
  const rearCushions = cushions + 1, rearRun = w - A - B;
  for (let i = 0; i < rearCushions; i++) {
    const xa = x0 + A + rearRun * i / rearCushions;
    box(xa, z0 + B, xa + rearRun / rearCushions, z0 + B + cushionDepth, seatTop, backTop, fabric, 2);
  }
  const sideRun = d - S - A + (S - B - cushionDepth);
  for (let i = 0; i < returnCushions; i++) {
    const za = z0 + B + cushionDepth + sideRun * i / returnCushions;
    box(x1 - B - cushionDepth, za, x1 - B, za + sideRun / returnCushions, seatTop, backTop, fabric, 2);
  }
}

function createLoveseat(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const baseColor = createMaterial(color);
  const darkColor = createMaterial(color, 0.7, 0.1);
  darkColor.color.multiplyScalar(0.9);

  // Main seat base
  const seatGeo = new THREE.BoxGeometry(w * 0.9, h * 0.5, d * 0.7);
  const seatMesh = new THREE.Mesh(seatGeo, baseColor);
  seatMesh.position.set(0, h * 0.25, d * 0.05);
  group.add(seatMesh);

  // Back cushions (2 bumps for loveseat) — at negative Z (back/top in 2D)
  const cushionWidth = w * 0.35;
  for (let i = 0; i < 2; i++) {
    const cushionGeo = new THREE.BoxGeometry(cushionWidth, h * 0.6, d * 0.25);
    const cushionMesh = new THREE.Mesh(cushionGeo, baseColor);
    cushionMesh.position.set(-w * 0.175 + i * cushionWidth, h * 0.55, -d * 0.3);
    group.add(cushionMesh);
  }

  // Armrests
  const armGeo = new THREE.BoxGeometry(w * 0.15, h * 0.8, d * 0.8);
  const leftArm = new THREE.Mesh(armGeo, darkColor);
  leftArm.position.set(-w * 0.425, h * 0.4, 0);
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, darkColor);
  rightArm.position.set(w * 0.425, h * 0.4, 0);
  group.add(rightArm);
}

function createArmchair(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const baseColor = createMaterial(color);
  const darkColor = createMaterial(color, 0.7, 0.1);
  darkColor.color.multiplyScalar(0.9);

  // Seat
  const seatGeo = new THREE.BoxGeometry(w * 0.7, h * 0.4, d * 0.7);
  const seatMesh = new THREE.Mesh(seatGeo, baseColor);
  seatMesh.position.set(0, h * 0.2, d * 0.05);
  group.add(seatMesh);

  // Back — at negative Z (back/top in 2D)
  const backGeo = new THREE.BoxGeometry(w * 0.7, h * 0.6, d * 0.15);
  const backMesh = new THREE.Mesh(backGeo, baseColor);
  backMesh.position.set(0, h * 0.5, -d * 0.35);
  group.add(backMesh);

  // Armrests
  const armGeo = new THREE.BoxGeometry(w * 0.2, h * 0.5, d * 0.6);
  const leftArm = new THREE.Mesh(armGeo, darkColor);
  leftArm.position.set(-w * 0.35, h * 0.35, 0);
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, darkColor);
  rightArm.position.set(w * 0.35, h * 0.35, 0);
  group.add(rightArm);
}

function createCoffeeTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const topColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  // Table top
  const topGeo = new THREE.BoxGeometry(w, h * 0.2, d);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.9, 0);
  group.add(topMesh);

  // 4 legs
  const legGeo = new THREE.BoxGeometry(w * 0.05, h * 0.8, d * 0.05);
  const positions = [
    [-w * 0.4, h * 0.4, -d * 0.4],
    [w * 0.4, h * 0.4, -d * 0.4],
    [-w * 0.4, h * 0.4, d * 0.4],
    [w * 0.4, h * 0.4, d * 0.4]
  ];

  positions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legColor);
    leg.position.set(pos[0], pos[1], pos[2]);
    group.add(leg);
  });
}

function createTVStand(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const cabinetColor = createMaterial(color);
  const screenColor = createMaterial('#1a1a1a', 0.1, 0.8);

  // Cabinet base
  const cabinetGeo = new THREE.BoxGeometry(w, h * 0.8, d);
  const cabinetMesh = new THREE.Mesh(cabinetGeo, cabinetColor);
  cabinetMesh.position.set(0, h * 0.4, 0);
  group.add(cabinetMesh);

  // TV screen on top
  const screenGeo = new THREE.BoxGeometry(w * 0.7, h * 0.8, d * 0.05);
  const screenMesh = new THREE.Mesh(screenGeo, screenColor);
  screenMesh.position.set(0, h * 1.2, -d * 0.1);
  group.add(screenMesh);
}

/** Wall-hung lowboard: a top board over handleless push-to-open flaps, and a warm LED strip underneath. */
function createTVLowboard(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const board = createMaterial(color, 0.6, 0);
  const carcass = createMaterial(color, 0.7, 0);
  carcass.color.multiplyScalar(0.72);
  const led = new THREE.MeshStandardMaterial({ color: '#fff4e0', emissive: '#ffc978', emissiveIntensity: 1.2 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.1), Math.max(sy, 0.1), Math.max(sz, 0.1)), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // 16 mm boards; the fronts hang a little below the carcass and hide the LED strip
  const t = Math.min(1.6, h * 0.1, d * 0.1), gap = 0.3, lip = Math.min(1.5, h * 0.05);
  const zBack = -d / 2, zFront = d / 2 - t, bodyD = zFront - zBack, zMid = (zBack + zFront) / 2;
  const top = h - t, bottom = lip;
  box(w, t, d, 0, h - t / 2, 0, board);
  box(w - 2 * t, t, bodyD, 0, bottom + t / 2, zMid, carcass);
  for (const side of [-1, 1]) box(t, top - bottom, bodyD, side * (w - t) / 2, (top + bottom) / 2, zMid, carcass);
  box(w - 2 * t, top - bottom - 2 * t, t / 2, 0, (top + bottom) / 2, zBack + t / 4, carcass);

  // Four flaps over four compartments; the wide unit is two elements, so the middle divider is doubled
  const flaps = w >= 120 ? 4 : 2, flapW = (w - (flaps - 1) * gap) / flaps, flapH = top - gap;
  for (let i = 0; i < flaps; i++) {
    box(flapW, flapH, t, -w / 2 + flapW / 2 + i * (flapW + gap), flapH / 2, zFront + t / 2, board);
  }
  for (let i = 1; i < flaps; i++) {
    const x = -w / 2 + i * (flapW + gap) - gap / 2;
    box(i === flaps / 2 ? 2 * t : t, top - bottom, bodyD, x, (top + bottom) / 2, zMid, carcass);
  }

  // Warm LED strip under the front edge, behind the lip of the flaps
  const strip = box(w - 4 * t, 0.3, 1, 0, bottom - 0.15, zFront - 1.5, led);
  strip.userData.castShadow = false;
}

/**
 * Compact laser projector (Hisense M2 size: 19.3 × 21.8 cm, 23 cm with its gimbal) hung upside
 * down from the ceiling: a ceiling plate and drop pole at the top, the gimbal cradle, and the body
 * below with the lens at the front (+Z), where the beam leaves.
 */
function createCeilingProjector(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const shell = createMaterial(color, 0.45, 0.15);
  const metal = createMaterial('#a8a29e', 0.3, 0.7);
  const dark = createMaterial('#1c1917', 0.5, 0.2);
  const lensGlass = new THREE.MeshStandardMaterial({ color: '#0c1a2a', roughness: 0.05, metalness: 0.6 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  // Ceiling plate and drop pole; the pole takes whatever height the body and cradle leave
  const arm = Math.min(1.4, w * 0.08), bodyW = w - 2 * arm - 0.6, bodyD = d, bodyH = Math.min(17, h * 0.55);
  const cradleT = 1.5, plateT = 0.8, pole = Math.max(1, h - plateT - cradleT - bodyH - 2);
  const plateR = Math.min(6, w * 0.35);
  add(new THREE.CylinderGeometry(plateR, plateR, plateT, 24), metal, 0, h - plateT / 2, 0);
  add(new THREE.CylinderGeometry(1.2, 1.2, pole, 12), metal, 0, h - plateT - pole / 2, 0);

  // Gimbal cradle upside down: a round base under the pole and two arms down to the pivots
  const cradleTop = h - plateT - pole, cradleY = cradleTop - cradleT / 2;
  add(new THREE.CylinderGeometry(Math.min(7, w * 0.36), Math.min(7, w * 0.36), cradleT, 32), metal, 0, cradleY, 0);
  const bodyTop = cradleTop - cradleT - 2, bodyY = bodyTop - bodyH / 2;
  const armH = cradleTop - bodyY;
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(arm, armH, Math.min(6, d * 0.3)), metal, side * (w - arm) / 2, cradleTop - armH / 2, 0);
    add(new THREE.CylinderGeometry(2, 2, 0.6, 20).rotateZ(Math.PI / 2), metal, side * (bodyW / 2 + 0.3), bodyY, 0);
  }

  // Body with softened edges, a dark front panel and the lens a little off-centre
  add(new RoundedBoxGeometry(bodyW, bodyH, bodyD, 4, Math.min(2.5, bodyH * 0.15)), shell, 0, bodyY, 0);
  add(new THREE.BoxGeometry(bodyW - 2, bodyH - 2, 0.3), dark, 0, bodyY, bodyD / 2 + 0.05);
  const lensR = Math.min(3.2, bodyH * 0.2), lensX = -bodyW * 0.12, lensY = bodyY - bodyH * 0.08;
  add(new THREE.CylinderGeometry(lensR + 0.8, lensR + 0.8, 1.2, 32).rotateX(Math.PI / 2), metal, lensX, lensY, bodyD / 2 + 0.6);
  add(new THREE.CylinderGeometry(lensR, lensR, 0.4, 32).rotateX(Math.PI / 2), lensGlass, lensX, lensY, bodyD / 2 + 1.1);

  // Vent slots on the back
  for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(bodyW * 0.6, 0.5, 0.3), dark, 0, bodyY + i * bodyH * 0.12, -bodyD / 2 - 0.1);
}

function createBookshelf(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const shelfColor = createMaterial(color);
  const darkColor = createMaterial(color, 0.7, 0.1);
  darkColor.color.multiplyScalar(0.9);

  // Main frame
  const frameGeo = new THREE.BoxGeometry(w, h, d);
  const frameMesh = new THREE.Mesh(frameGeo, shelfColor);
  frameMesh.position.set(0, h / 2, 0);
  group.add(frameMesh);

  // 5 horizontal shelves
  const shelfThickness = h * 0.05;
  for (let i = 0; i < 5; i++) {
    const shelfGeo = new THREE.BoxGeometry(w * 0.95, shelfThickness, d * 0.9);
    const shelf = new THREE.Mesh(shelfGeo, darkColor);
    shelf.position.set(0, (i + 0.5) * (h / 5), 0);
    group.add(shelf);
  }
}

/**
 * Oak profiles (2.8 × 8 cm, 230 cm long) on brushed steel rods, following WoodUpp's Embrace drawings.
 * Each module's end profiles are the posts: a steel pin with an adjusting nut runs from each end to a
 * round foot on the floor and a rosette on the ceiling. `z` is the profiles' centre plane.
 */
function addDividerFrame(group: THREE.Group, w: number, h: number, color: string, profilesPerModule: number, rods: number[], z: number) {
  const wood = createMaterial(color, 0.75, 0.0);
  const steel = createMaterial('#b8bcc2', 0.35, 0.85);
  const L = dividerLayout(w, h, profilesPerModule);
  const profile = new THREE.BoxGeometry(DIVIDER_SLAT, L.block, 8);
  for (const x of L.profiles) {
    const mesh = new THREE.Mesh(profile, wood);
    mesh.position.set(x, L.gap + L.block / 2, z);
    group.add(mesh);
  }
  const plate = new THREE.CylinderGeometry(DIVIDER_FOOT_RADIUS, DIVIDER_FOOT_RADIUS, 0.8, 32);
  const pin = new THREE.CylinderGeometry(0.7, 0.7, L.gap, 12);
  const nut = new THREE.CylinderGeometry(1.4, 1.4, 1.2, 6);
  for (const [a, b] of L.posts) {
    // Rods run through every profile and end in small caps just outside the posts.
    const span = b - a + DIVIDER_SLAT + 1;
    for (const rod of rods) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, span, 12), steel);
      bar.rotation.z = Math.PI / 2;
      bar.position.set((a + b) / 2, L.rodHeight(rod), z);
      group.add(bar);
    }
    for (const x of [a, b]) {
      for (const [pinY, plateY, nutY] of [[L.gap / 2, 0.4, L.gap * 0.6], [h - L.gap / 2, h - 0.4, h - L.gap * 0.6]]) {
        const p = new THREE.Mesh(pin, steel); p.position.set(x, pinY, z);
        const disc = new THREE.Mesh(plate, steel); disc.position.set(x, plateY, z);
        const n = new THREE.Mesh(nut, steel); n.position.set(x, nutY, z);
        group.add(p, disc, n);
      }
    }
  }
  return L;
}

/** Embrace BM1: a floor-to-ceiling wall of 7 oak slats per 71.6 cm module on 4 rods. */
function createSlatDivider(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  addDividerFrame(group, w, h, color, 7, SLAT_DIVIDER_RODS, 0);
}

/** Embrace BM2: two posts per module on 6 rods, with 65.8 × 20 cm oak shelves hung towards the front. */
function createShelfDivider(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const L = addDividerFrame(group, w, h, color, 2, SHELF_DIVIDER_RODS, -d / 2 + DIVIDER_FOOT_RADIUS);
  const wood = createMaterial(color, 0.75, 0.0);
  const shelf = new THREE.BoxGeometry(65.8, 1.8, d);
  for (let m = 0; m < L.modules; m++) {
    const x = -w / 2 + (m + 0.5) * L.moduleWidth;
    // Shelves sit on the upper rods, clear of a sideboard or sofa in front.
    for (const rod of [SHELF_DIVIDER_RODS[2], SHELF_DIVIDER_RODS[3], SHELF_DIVIDER_RODS[5]]) {
      const mesh = new THREE.Mesh(shelf, wood);
      mesh.position.set(x, L.rodHeight(rod) + 1.4, 0);
      group.add(mesh);
    }
  }
}

function createSideTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const topColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  // Table top (round)
  const topGeo = new THREE.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, h * 0.15);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.925, 0);
  group.add(topMesh);

  // Central leg
  const legGeo = new THREE.CylinderGeometry(w * 0.05, w * 0.05, h * 0.85);
  const legMesh = new THREE.Mesh(legGeo, legColor);
  legMesh.position.set(0, h * 0.425, 0);
  group.add(legMesh);
}

// Bedroom furniture
function createBed(group: THREE.Group, w: number, d: number, h: number, color: string, type: 'queen' | 'twin'): void {
  const mattressColor = createMaterial(color);
  const headboardColor = createMaterial(color, 0.7, 0.1);
  headboardColor.color.multiplyScalar(0.8);
  const pillowColor = createMaterial('#ffffff', 0.9, 0.0);

  // Mattress
  const mattressGeo = new THREE.BoxGeometry(w, h, d);
  const mattressMesh = new THREE.Mesh(mattressGeo, mattressColor);
  mattressMesh.position.set(0, h / 2, 0);
  group.add(mattressMesh);

  // Headboard — at negative Z (top/back in 2D)
  const headboardGeo = new THREE.BoxGeometry(w, h * 1.8, d * 0.1);
  const headboardMesh = new THREE.Mesh(headboardGeo, headboardColor);
  headboardMesh.position.set(0, h * 0.9, -d * 0.45);
  group.add(headboardMesh);

  // Pillows — near headboard (negative Z)
  const pillowCount = type === 'queen' ? 2 : 1;
  const pillowWidth = w / (pillowCount + 1);
  for (let i = 0; i < pillowCount; i++) {
    const pillowGeo = new THREE.BoxGeometry(pillowWidth * 0.8, h * 0.4, d * 0.3);
    const pillowMesh = new THREE.Mesh(pillowGeo, pillowColor);
    const xOffset = pillowCount === 1 ? 0 : (i - 0.5) * pillowWidth;
    pillowMesh.position.set(xOffset, h * 0.7, -d * 0.25);
    group.add(pillowMesh);
  }
}

function createNightstand(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color);
  const drawerColor = createMaterial(color, 0.7, 0.1);
  drawerColor.color.multiplyScalar(0.9);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Drawer line
  const drawerGeo = new THREE.BoxGeometry(w * 0.9, h * 0.05, d * 0.02);
  const drawerMesh = new THREE.Mesh(drawerGeo, drawerColor);
  drawerMesh.position.set(0, h * 0.7, d * 0.5);
  group.add(drawerMesh);

  // Drawer handle
  const handleGeo = new THREE.BoxGeometry(w * 0.1, h * 0.03, d * 0.02);
  const handleMesh = new THREE.Mesh(handleGeo, drawerColor);
  handleMesh.position.set(0, h * 0.7, d * 0.51);
  group.add(handleMesh);
}

function createDresser(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color);
  const drawerColor = createMaterial(color, 0.7, 0.1);
  drawerColor.color.multiplyScalar(0.9);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // 4 drawer lines
  for (let i = 0; i < 4; i++) {
    const drawerY = h * (0.2 + i * 0.2);
    const drawerGeo = new THREE.BoxGeometry(w * 0.9, h * 0.03, d * 0.02);
    const drawerMesh = new THREE.Mesh(drawerGeo, drawerColor);
    drawerMesh.position.set(0, drawerY, d * 0.5);
    group.add(drawerMesh);

    // Handle
    const handleGeo = new THREE.BoxGeometry(w * 0.1, h * 0.02, d * 0.02);
    const handleMesh = new THREE.Mesh(handleGeo, drawerColor);
    handleMesh.position.set(0, drawerY, d * 0.51);
    group.add(handleMesh);
  }
}

function createWardrobe(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color);
  const doorColor = createMaterial(color, 0.7, 0.1);
  doorColor.color.multiplyScalar(0.95);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Vertical split line (2 doors)
  const splitGeo = new THREE.BoxGeometry(w * 0.02, h * 0.9, d * 0.02);
  const splitMesh = new THREE.Mesh(splitGeo, doorColor);
  splitMesh.position.set(0, h / 2, d * 0.5);
  group.add(splitMesh);

  // Door knobs
  const knobGeo = new THREE.SphereGeometry(w * 0.02);
  const knobMaterial = createMaterial('#333333', 0.3, 0.8);
  
  const leftKnob = new THREE.Mesh(knobGeo, knobMaterial);
  leftKnob.position.set(-w * 0.3, h * 0.6, d * 0.52);
  group.add(leftKnob);

  const rightKnob = new THREE.Mesh(knobGeo, knobMaterial);
  rightKnob.position.set(w * 0.3, h * 0.6, d * 0.52);
  group.add(rightKnob);
}

// Kitchen furniture
function createStove(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color, 0.5, 0.3);
  const burnerColor = createMaterial('#1a1a1a', 0.3, 0.7);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // 4 burners on top
  const burnerRadius = Math.min(w, d) * 0.12;
  const burnerGeo = new THREE.CylinderGeometry(burnerRadius, burnerRadius, h * 0.02);
  
  const positions = [
    [-w * 0.25, h, -d * 0.25],
    [w * 0.25, h, -d * 0.25],
    [-w * 0.25, h, d * 0.25],
    [w * 0.25, h, d * 0.25]
  ];

  positions.forEach(pos => {
    const burner = new THREE.Mesh(burnerGeo, burnerColor);
    burner.position.set(pos[0], pos[1], pos[2]);
    group.add(burner);
  });
}

function createFridge(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color, 0.4, 0.3);
  const handleColor = createMaterial('#333333', 0.3, 0.8);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Horizontal line splitting upper/lower
  const splitGeo = new THREE.BoxGeometry(w * 0.95, h * 0.02, d * 0.02);
  const splitMesh = new THREE.Mesh(splitGeo, handleColor);
  splitMesh.position.set(0, h * 0.7, d * 0.5);
  group.add(splitMesh);

  // Handle
  const handleGeo = new THREE.BoxGeometry(w * 0.05, h * 0.15, d * 0.03);
  const handleMesh = new THREE.Mesh(handleGeo, handleColor);
  handleMesh.position.set(w * 0.4, h * 0.8, d * 0.52);
  group.add(handleMesh);
}

/**
 * Dual-zone wine fridge modelled on a 48 × 56.5 × 83.8 cm cabinet: a tinted glass door with the
 * controls along its top and a grip strip on the opening side, beech shelves of lying bottles,
 * and a black band between the two temperature zones. The door is at the front (+Z).
 */
function createWineFridge(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const body = createMaterial(color, 0.45, 0.2);
  const trim = createMaterial('#0a0a0b', 0.2, 0.4);
  const liner = createMaterial('#27272a', 0.8, 0.1);
  const beech = createMaterial('#d9b98f', 0.75, 0);
  const label = createMaterial('#d4d4d8', 0.6, 0);
  const glass = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.3, depthWrite: false });
  const light = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#f1f5f9', emissiveIntensity: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.1), Math.max(sy, 0.1), Math.max(sz, 0.1)), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };

  const foot = Math.min(2.5, h * 0.03), doorT = Math.min(4, d * 0.07), wall = Math.min(3, w * 0.06);
  const zBack = -d / 2, zFront = d / 2 - doorT, zMid = (zBack + zFront) / 2, bodyD = zFront - zBack;
  const plinth = h * 0.08, floor = foot + plinth, ceiling = h - wall;
  const iw = w - 2 * wall, innerBack = zBack + wall, innerD = zFront - innerBack;
  // Feet and cabinet shell; the plinth hides the compressor
  for (const fx of [-w / 2 + 4, w / 2 - 4]) for (const fz of [zBack + 4, zFront - 4]) box(4, foot, 4, fx, foot / 2, fz, trim);
  for (const side of [-1, 1]) box(wall, h - foot, bodyD, side * (w - wall) / 2, (foot + h) / 2, zMid, body);
  box(iw, wall, bodyD, 0, h - wall / 2, zMid, body);
  box(iw, plinth, bodyD, 0, foot + plinth / 2, zMid, body);
  box(iw, ceiling - floor, wall, 0, (floor + ceiling) / 2, zBack + wall / 2, liner);
  box(iw * 0.5, 0.4, 1.5, 0, ceiling - 0.2, zFront - 6, light);

  // Shelf levels as fractions of the cavity; the zone band sits under the upper zone
  const cavity = ceiling - floor, at = (f: number) => floor + cavity * f;
  const shelves = [0.02, 0.3, 0.59, 0.8], band = [0.5, 0.545];
  const bandY = (at(band[0]) + at(band[1])) / 2;
  box(iw, at(band[1]) - at(band[0]), innerD, 0, bandY, innerBack + innerD / 2, trim);
  for (const side of [-1, 1]) box(iw * 0.28, 0.5, 0.2, side * iw * 0.28, bandY, zFront - 0.1, label);

  // Bottles lie front to back: bases out in the upper zone, capsules out in the lower one
  const r = 3.65, length = Math.min(30, innerD - 3), neck = 1.4;
  const profile = [[0, 0], [r, 0], [r, 0.64], [r * 0.93, 0.7], [r * 0.6, 0.76], [neck, 0.82], [neck, 1]]
    .map(([x, y]) => new THREE.Vector2(x, y * length));
  const bottleGeo = new THREE.LatheGeometry(profile, 16);
  const capsuleGeo = new THREE.CylinderGeometry(neck + 0.15, neck + 0.15, length * 0.15, 12).translate(0, length * 0.93, 0);
  const glassColors = ['#1f3b2c', '#3b1c1c', '#26301d', '#c9938a', '#1c2a24', '#4a2323'].map(c => createMaterial(c, 0.25, 0.3));
  const capsules = ['#c8a24a', '#6b1f2a', '#2f5d3a', '#e5e7eb', '#c8a24a'].map(c => createMaterial(c, 0.35, 0.6));
  const addBottle = (x: number, y: number, capsuleOut: boolean, seed: number) => {
    const bottle = new THREE.Group();
    bottle.add(new THREE.Mesh(bottleGeo, glassColors[seed % glassColors.length]));
    bottle.add(new THREE.Mesh(capsuleGeo, capsules[(seed * 3) % capsules.length]));
    const zOut = zFront - 1.5;
    bottle.rotation.x = capsuleOut ? Math.PI / 2 : -Math.PI / 2;
    bottle.position.set(x, y, capsuleOut ? zOut - length : zOut);
    group.add(bottle);
  };
  const perRow = Math.max(1, Math.floor((iw - 1) / (2 * r + 0.4)));
  const pitch = (iw - 1) / perRow, lift = Math.sqrt(Math.max(0, 4 * r * r - pitch * pitch / 4));
  shelves.forEach((f, i) => {
    const top = at(f);
    const space = Math.min(ceiling, ...[...shelves, band[0]].map(at).filter(y => y > top)) - 1.2 - top;
    // Pull-out beech shelf with a thicker front rail
    box(iw - 0.5, 1.2, innerD - 2, 0, top - 0.6, innerBack + innerD / 2 - 1, beech);
    box(iw - 0.5, 2.2, 1.5, 0, top - 1.1, zFront - 2.5, beech);
    const capsuleOut = f < band[0];
    for (let n = 0; n < perRow; n++) addBottle(-iw / 2 + 0.5 + pitch * (n + 0.5), top + r, capsuleOut, i * 5 + n * 7);
    if (2 * r + lift <= space) {
      for (let n = 1; n < perRow; n++) addBottle(-iw / 2 + 0.5 + pitch * n, top + r + lift, capsuleOut, i * 5 + n * 7 + 2);
    }
  });

  // Door: a black frame behind one sheet of tinted glass, a grip strip on the opening (left) side
  const frameD = doorT - 1, frameZ = zFront + frameD / 2, border = Math.min(2.5, w * 0.05);
  const doorBottom = foot, topBorder = h * 0.09, bottomBorder = plinth;
  box(w, topBorder, frameD, 0, h - topBorder / 2, frameZ, trim);
  box(w, bottomBorder, frameD, 0, doorBottom + bottomBorder / 2, frameZ, trim);
  for (const side of [-1, 1]) box(border, h - doorBottom, frameD, side * (w - border) / 2, (doorBottom + h) / 2, frameZ, trim);
  const pane = box(w, h - doorBottom, 0.5, 0, (doorBottom + h) / 2, d / 2 - 0.75, glass);
  pane.userData.castShadow = false;
  box(1, (h - doorBottom) * 0.45, 1, -w / 2 + 1.2, doorBottom + (h - doorBottom) * 0.55, d / 2 - 0.5, trim);
  // Touch controls and the two zone displays along the top border
  const panelY = h - topBorder / 2, panelZ = d / 2 - 0.45;
  for (const x of [-0.3, -0.22, -0.14, 0.14, 0.22, 0.3]) box(0.8, 0.8, 0.1, x * w, panelY, panelZ, light);
  for (const x of [-0.05, 0.05]) box(w * 0.06, 1.4, 0.1, x * w, panelY, panelZ, light);
}

function createKitchenSink(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const counterColor = createMaterial(color, 0.6, 0.2);
  const basinColor = createMaterial('#e5e7eb', 0.2, 0.7);

  // Counter base
  const counterGeo = new THREE.BoxGeometry(w, h, d);
  const counterMesh = new THREE.Mesh(counterGeo, counterColor);
  counterMesh.position.set(0, h / 2, 0);
  group.add(counterMesh);

  // Basin (oval/elliptical)
  const basinGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.3, h * 0.2, 8);
  basinGeo.scale(1, 1, 0.7); // Make it more oval
  const basinMesh = new THREE.Mesh(basinGeo, basinColor);
  basinMesh.position.set(0, h * 0.8, 0);
  group.add(basinMesh);
}

function createCounter(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color);
  const topColor = createMaterial(color, 0.5, 0.2);
  topColor.color.multiplyScalar(1.1);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h * 0.9, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h * 0.45, 0);
  group.add(bodyMesh);

  // Top surface
  const topGeo = new THREE.BoxGeometry(w, h * 0.1, d);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.95, 0);
  group.add(topMesh);
}

function createDishwasher(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color, 0.4, 0.3);
  const handleColor = createMaterial('#333333', 0.3, 0.8);

  // Main body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Horizontal handle line
  const handleGeo = new THREE.BoxGeometry(w * 0.8, h * 0.03, d * 0.02);
  const handleMesh = new THREE.Mesh(handleGeo, handleColor);
  handleMesh.position.set(0, h * 0.8, d * 0.51);
  group.add(handleMesh);
}

// Bathroom furniture
function createToilet(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const toiletColor = createMaterial('#f8fafc', 0.2, 0.1);

  // Bowl (elliptical)
  const bowlGeo = new THREE.CylinderGeometry(w * 0.4, w * 0.35, h, 12);
  bowlGeo.scale(1, 1, 1.3); // Make it more oval
  const bowlMesh = new THREE.Mesh(bowlGeo, toiletColor);
  bowlMesh.position.set(0, h / 2, 0);
  group.add(bowlMesh);

  // Tank behind — at negative Z (back in 2D)
  const tankGeo = new THREE.BoxGeometry(w * 0.7, h * 1.8, d * 0.25);
  const tankMesh = new THREE.Mesh(tankGeo, toiletColor);
  tankMesh.position.set(0, h * 0.9, -d * 0.35);
  group.add(tankMesh);

  // Seat rim
  const seatGeo = new THREE.TorusGeometry(w * 0.35, w * 0.05, 8, 16);
  const seatMesh = new THREE.Mesh(seatGeo, toiletColor);
  seatMesh.position.set(0, h * 0.9, 0);
  seatMesh.rotation.x = -Math.PI / 2;
  group.add(seatMesh);
}

function createBathtub(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const tubColor = createMaterial('#f8fafc', 0.2, 0.1);

  // Outer shell
  const outerGeo = new THREE.BoxGeometry(w, h, d);
  const outerMesh = new THREE.Mesh(outerGeo, tubColor);
  outerMesh.position.set(0, h / 2, 0);
  group.add(outerMesh);

  // Inner hollow (smaller and lower)
  const innerColor = createMaterial('#e2e8f0', 0.3, 0.1);
  const innerGeo = new THREE.BoxGeometry(w * 0.85, h * 0.6, d * 0.85);
  const innerMesh = new THREE.Mesh(innerGeo, innerColor);
  innerMesh.position.set(0, h * 0.3, 0);
  group.add(innerMesh);
}

function createShower(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const glassColor = createMaterial('#bfdbfe', 0.1, 0.0);
  glassColor.transparent = true;
  glassColor.opacity = 0.3;

  const frameColor = createMaterial('#64748b', 0.5, 0.8);

  // Glass panels (corner enclosure)
  const panel1Geo = new THREE.BoxGeometry(w, h * 0.9, d * 0.05);
  const panel1 = new THREE.Mesh(panel1Geo, glassColor);
  panel1.position.set(0, h * 0.45, -d * 0.475);
  group.add(panel1);

  const panel2Geo = new THREE.BoxGeometry(w * 0.05, h * 0.9, d);
  const panel2 = new THREE.Mesh(panel2Geo, glassColor);
  panel2.position.set(-w * 0.475, h * 0.45, 0);
  group.add(panel2);

  // Shower head
  const headGeo = new THREE.CylinderGeometry(w * 0.05, w * 0.05, h * 0.02);
  const headMesh = new THREE.Mesh(headGeo, frameColor);
  headMesh.position.set(-w * 0.3, h * 0.85, -d * 0.3);
  group.add(headMesh);
}

function createBathroomSink(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const sinkColor = createMaterial('#f8fafc', 0.2, 0.1);

  // Pedestal
  const pedestalGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.35, h * 0.8);
  const pedestalMesh = new THREE.Mesh(pedestalGeo, sinkColor);
  pedestalMesh.position.set(0, h * 0.4, 0);
  group.add(pedestalMesh);

  // Basin on top
  const basinGeo = new THREE.CylinderGeometry(w * 0.4, w * 0.35, h * 0.15);
  const basinMesh = new THREE.Mesh(basinGeo, sinkColor);
  basinMesh.position.set(0, h * 0.875, 0);
  group.add(basinMesh);
}

// Office furniture
function createDesk(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const topColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  // Desktop
  const topGeo = new THREE.BoxGeometry(w, h * 0.1, d);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.95, 0);
  group.add(topMesh);

  // 4 legs
  const legGeo = new THREE.BoxGeometry(w * 0.04, h * 0.9, d * 0.04);
  const positions = [
    [-w * 0.45, h * 0.45, -d * 0.45],
    [w * 0.45, h * 0.45, -d * 0.45],
    [-w * 0.45, h * 0.45, d * 0.45],
    [w * 0.45, h * 0.45, d * 0.45]
  ];

  positions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legColor);
    leg.position.set(pos[0], pos[1], pos[2]);
    group.add(leg);
  });
}

function createOfficeChair(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const seatColor = createMaterial(color);
  const baseColor = createMaterial('#333333', 0.5, 0.8);

  // Seat
  const seatGeo = new THREE.CylinderGeometry(w * 0.4, w * 0.4, h * 0.1);
  const seatMesh = new THREE.Mesh(seatGeo, seatColor);
  seatMesh.position.set(0, h * 0.5, 0);
  group.add(seatMesh);

  // Backrest — at negative Z (back in 2D)
  const backGeo = new THREE.BoxGeometry(w * 0.7, h * 0.4, d * 0.1);
  const backMesh = new THREE.Mesh(backGeo, seatColor);
  backMesh.position.set(0, h * 0.7, -d * 0.35);
  group.add(backMesh);

  // Central pedestal
  const pedestalGeo = new THREE.CylinderGeometry(w * 0.05, w * 0.05, h * 0.4);
  const pedestalMesh = new THREE.Mesh(pedestalGeo, baseColor);
  pedestalMesh.position.set(0, h * 0.2, 0);
  group.add(pedestalMesh);

  // Base (simplified as cylinder)
  const baseGeo = new THREE.CylinderGeometry(w * 0.35, w * 0.35, h * 0.05);
  const baseMesh = new THREE.Mesh(baseGeo, baseColor);
  baseMesh.position.set(0, h * 0.025, 0);
  group.add(baseMesh);
}

// Dining furniture
function createDiningTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const topColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  // Table top
  const topGeo = new THREE.BoxGeometry(w, h * 0.1, d);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.95, 0);
  group.add(topMesh);

  // 4 legs
  const legGeo = new THREE.BoxGeometry(w * 0.05, h * 0.9, d * 0.05);
  const positions = [
    [-w * 0.4, h * 0.45, -d * 0.35],
    [w * 0.4, h * 0.45, -d * 0.35],
    [-w * 0.4, h * 0.45, d * 0.35],
    [w * 0.4, h * 0.45, d * 0.35]
  ];

  positions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legColor);
    leg.position.set(pos[0], pos[1], pos[2]);
    group.add(leg);
  });
}

function createDiningChair(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const seatColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  const seatGeo = new THREE.BoxGeometry(w * 0.9, h * 0.1, d * 0.9);
  const seatMesh = new THREE.Mesh(seatGeo, seatColor);
  seatMesh.position.set(0, h * 0.5, 0);
  group.add(seatMesh);

  const backGeo = new THREE.BoxGeometry(w * 0.9, h * 0.4, d * 0.1);
  const backMesh = new THREE.Mesh(backGeo, seatColor);
  backMesh.position.set(0, h * 0.7, -d * 0.4);
  group.add(backMesh);

  const legGeo = new THREE.BoxGeometry(w * 0.05, h * 0.5, d * 0.05);
  const positions = [
    [-w * 0.35, h * 0.25, -d * 0.35],
    [w * 0.35, h * 0.25, -d * 0.35],
    [-w * 0.35, h * 0.25, d * 0.35],
    [w * 0.35, h * 0.25, d * 0.35]
  ];
  positions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legColor);
    leg.position.set(pos[0], pos[1], pos[2]);
    group.add(leg);
  });
}

// RoomPlan-specific furniture
function createOven(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color, 0.5, 0.3);
  const glassColor = createMaterial('#1a1a1a', 0.1, 0.5);
  glassColor.transparent = true;
  glassColor.opacity = 0.7;

  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Oven door window
  const windowGeo = new THREE.BoxGeometry(w * 0.7, h * 0.4, d * 0.02);
  const windowMesh = new THREE.Mesh(windowGeo, glassColor);
  windowMesh.position.set(0, h * 0.4, d * 0.51);
  group.add(windowMesh);

  // Handle
  const handleColor = createMaterial('#333', 0.3, 0.8);
  const handleGeo = new THREE.BoxGeometry(w * 0.6, h * 0.03, d * 0.03);
  const handleMesh = new THREE.Mesh(handleGeo, handleColor);
  handleMesh.position.set(0, h * 0.75, d * 0.52);
  group.add(handleMesh);
}

function createWasherDryer(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color, 0.4, 0.3);
  const drumColor = createMaterial('#e2e8f0', 0.2, 0.5);

  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Drum circle on front
  const drumGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.3, d * 0.02, 24);
  drumGeo.rotateX(Math.PI / 2);
  const drumMesh = new THREE.Mesh(drumGeo, drumColor);
  drumMesh.position.set(0, h * 0.45, d * 0.51);
  group.add(drumMesh);

  // Control panel
  const panelColor = createMaterial('#94a3b8', 0.3, 0.2);
  const panelGeo = new THREE.BoxGeometry(w * 0.8, h * 0.12, d * 0.02);
  const panelMesh = new THREE.Mesh(panelGeo, panelColor);
  panelMesh.position.set(0, h * 0.85, d * 0.51);
  group.add(panelMesh);
}

function createFireplace(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mantelColor = createMaterial(color, 0.8, 0.1);
  const fireboxColor = createMaterial('#1a1a1a', 0.9, 0.0);

  // Mantel surround
  const mantelGeo = new THREE.BoxGeometry(w, h, d);
  const mantelMesh = new THREE.Mesh(mantelGeo, mantelColor);
  mantelMesh.position.set(0, h / 2, 0);
  group.add(mantelMesh);

  // Firebox opening (carved out front)
  const openingGeo = new THREE.BoxGeometry(w * 0.6, h * 0.55, d * 0.7);
  const openingMesh = new THREE.Mesh(openingGeo, fireboxColor);
  openingMesh.position.set(0, h * 0.3, d * 0.2);
  group.add(openingMesh);

  // Mantel shelf on top
  const shelfGeo = new THREE.BoxGeometry(w * 1.1, h * 0.08, d * 1.1);
  const shelfMesh = new THREE.Mesh(shelfGeo, mantelColor);
  shelfMesh.position.set(0, h * 0.96, 0);
  group.add(shelfMesh);

  // The fire's glow is a fixture light (utils/fixtureLights.ts), added where the item is placed.
}

function createTelevision(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const screenColor = createMaterial(color, 0.1, 0.8);
  const bezelColor = createMaterial('#111', 0.3, 0.5);

  // Screen panel
  const screenGeo = new THREE.BoxGeometry(w, h, d);
  const screenMesh = new THREE.Mesh(screenGeo, bezelColor);
  screenMesh.position.set(0, h / 2 + 80, 0); // Mounted at ~80cm
  group.add(screenMesh);

  // Screen face
  const faceGeo = new THREE.BoxGeometry(w - 4, h - 4, 1);
  const faceMat = createMaterial('#222', 0.05, 0.9);
  const faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.position.set(0, h / 2 + 80, d * 0.45);
  group.add(faceMesh);
}

function createStorage(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyColor = createMaterial(color);
  const doorColor = createMaterial(color, 0.7, 0.1);
  doorColor.color.multiplyScalar(0.95);

  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyColor);
  bodyMesh.position.set(0, h / 2, 0);
  group.add(bodyMesh);

  // Two doors
  const splitGeo = new THREE.BoxGeometry(w * 0.02, h * 0.9, d * 0.02);
  const splitMesh = new THREE.Mesh(splitGeo, doorColor);
  splitMesh.position.set(0, h / 2, d * 0.5);
  group.add(splitMesh);

  // Shelf line
  const shelfGeo = new THREE.BoxGeometry(w * 0.95, h * 0.02, d * 0.9);
  const shelfMesh = new THREE.Mesh(shelfGeo, doorColor);
  shelfMesh.position.set(0, h * 0.5, 0);
  group.add(shelfMesh);

  // Knobs
  const knobGeo = new THREE.SphereGeometry(w * 0.02);
  const knobMat = createMaterial('#333', 0.3, 0.8);
  const leftKnob = new THREE.Mesh(knobGeo, knobMat);
  leftKnob.position.set(-w * 0.15, h * 0.5, d * 0.52);
  group.add(leftKnob);
  const rightKnob = new THREE.Mesh(knobGeo, knobMat);
  rightKnob.position.set(w * 0.15, h * 0.5, d * 0.52);
  group.add(rightKnob);
}

function createGenericTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const topColor = createMaterial(color);
  const legColor = createMaterial(color, 0.7, 0.1);
  legColor.color.multiplyScalar(0.8);

  const topGeo = new THREE.BoxGeometry(w, h * 0.1, d);
  const topMesh = new THREE.Mesh(topGeo, topColor);
  topMesh.position.set(0, h * 0.95, 0);
  group.add(topMesh);

  const legGeo = new THREE.BoxGeometry(w * 0.05, h * 0.9, d * 0.05);
  const positions = [
    [-w * 0.42, h * 0.45, -d * 0.42],
    [w * 0.42, h * 0.45, -d * 0.42],
    [-w * 0.42, h * 0.45, d * 0.42],
    [w * 0.42, h * 0.45, d * 0.42]
  ];
  positions.forEach(pos => {
    const leg = new THREE.Mesh(legGeo, legColor);
    leg.position.set(pos[0], pos[1], pos[2]);
    group.add(leg);
  });
}

// Decor furniture
function createRug(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.95, 0.0);
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  mesh.receiveShadow = true;
  group.add(mesh);
  // Border
  const borderMat = createMaterial(color, 0.9, 0.0);
  borderMat.color.multiplyScalar(0.7);
  const borderGeo = new THREE.BoxGeometry(w + 2, h * 0.5, d + 2);
  const borderMesh = new THREE.Mesh(borderGeo, borderMat);
  borderMesh.position.y = h * 0.25;
  group.add(borderMesh);
}

function createRoundRug(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.95, 0.0);
  const r = Math.min(w, d) / 2;
  const geo = new THREE.CylinderGeometry(r, r, h, 32);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  mesh.receiveShadow = true;
  group.add(mesh);
}

function createPottedPlant(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const potMat = createMaterial('#8B6914', 0.8, 0.1);
  const potGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.25, h * 0.4, 12);
  const potMesh = new THREE.Mesh(potGeo, potMat);
  potMesh.position.y = h * 0.2;
  group.add(potMesh);
  // Foliage
  const leafMat = createMaterial(color, 0.9, 0.0);
  const leafGeo = new THREE.SphereGeometry(w * 0.4, 12, 12);
  const leafMesh = new THREE.Mesh(leafGeo, leafMat);
  leafMesh.position.y = h * 0.65;
  group.add(leafMesh);
}

function createFloorPlant(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const potMat = createMaterial('#6b4423', 0.8, 0.1);
  const potGeo = new THREE.CylinderGeometry(w * 0.25, w * 0.2, h * 0.25, 12);
  const potMesh = new THREE.Mesh(potGeo, potMat);
  potMesh.position.y = h * 0.125;
  group.add(potMesh);
  // Trunk
  const trunkMat = createMaterial('#5d4037', 0.9, 0.0);
  const trunkGeo = new THREE.CylinderGeometry(w * 0.04, w * 0.05, h * 0.5, 8);
  const trunkMesh = new THREE.Mesh(trunkGeo, trunkMat);
  trunkMesh.position.y = h * 0.5;
  group.add(trunkMesh);
  // Foliage cluster
  const leafMat = createMaterial(color, 0.9, 0.0);
  for (let i = 0; i < 3; i++) {
    const r = w * (0.2 + i * 0.05);
    const geo = new THREE.SphereGeometry(r, 10, 10);
    const mesh = new THREE.Mesh(geo, leafMat);
    mesh.position.set((i - 1) * w * 0.1, h * 0.75 + i * h * 0.05, 0);
    group.add(mesh);
  }
}

function createHangingPlant(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const potMat = createMaterial('#8B6914', 0.8, 0.1);
  const potGeo = new THREE.CylinderGeometry(w * 0.25, w * 0.2, h * 0.3, 10);
  const potMesh = new THREE.Mesh(potGeo, potMat);
  potMesh.position.y = h * 0.85;
  group.add(potMesh);
  // Trailing foliage
  const leafMat = createMaterial(color, 0.9, 0.0);
  const leafGeo = new THREE.SphereGeometry(w * 0.35, 10, 10);
  leafGeo.scale(1, 1.5, 1);
  const leafMesh = new THREE.Mesh(leafGeo, leafMat);
  leafMesh.position.y = h * 0.5;
  group.add(leafMesh);
}

function createCurtain(group: THREE.Group, w: number, d: number, h: number, color: string, sheer: boolean): void {
  const mat = createMaterial(color, 0.95, 0.0);
  if (sheer) { mat.transparent = true; mat.opacity = 0.5; }
  // Two panels
  for (const side of [-1, 1]) {
    const panelGeo = new THREE.BoxGeometry(w * 0.45, h, d);
    const panel = new THREE.Mesh(panelGeo, mat);
    panel.position.set(side * w * 0.275, h / 2, 0);
    group.add(panel);
  }
  // Rod
  const rodMat = createMaterial('#555', 0.3, 0.8);
  const rodGeo = new THREE.CylinderGeometry(1.5, 1.5, w * 1.1, 8);
  rodGeo.rotateZ(Math.PI / 2);
  const rod = new THREE.Mesh(rodGeo, rodMat);
  rod.position.y = h * 0.98;
  group.add(rod);
}

function createWallArt(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const frameMat = createMaterial('#333', 0.6, 0.2);
  const frameGeo = new THREE.BoxGeometry(w, h, d);
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.y = h / 2 + 120; // Hung at ~120cm
  group.add(frameMesh);
  // Canvas
  const canvasMat = createMaterial(color, 0.9, 0.0);
  const canvasGeo = new THREE.BoxGeometry(w - 4, h - 4, d * 0.5);
  const canvasMesh = new THREE.Mesh(canvasGeo, canvasMat);
  canvasMesh.position.set(0, h / 2 + 120, d * 0.3);
  group.add(canvasMesh);
}

function createMirror(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const frameMat = createMaterial('#555', 0.5, 0.3);
  const frameGeo = new THREE.BoxGeometry(w, h, d);
  const frameMesh = new THREE.Mesh(frameGeo, frameMat);
  frameMesh.position.y = h / 2 + 100;
  group.add(frameMesh);
  const glassMat = createMaterial('#e0e8f0', 0.05, 0.9);
  const glassGeo = new THREE.BoxGeometry(w - 4, h - 4, 1);
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  glassMesh.position.set(0, h / 2 + 100, d * 0.4);
  group.add(glassMesh);
}

function createClock(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.6, 0.2);
  const r = Math.min(w, d) / 2;
  const geo = new THREE.CylinderGeometry(r, r, d, 24);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = r + 140;
  group.add(mesh);
  // Face
  const faceMat = createMaterial('#fff', 0.9, 0.0);
  const faceGeo = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 1, 24);
  faceGeo.rotateX(Math.PI / 2);
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.set(0, r + 140, d * 0.4);
  group.add(face);
}

// Lighting fixtures
//
// Ceiling fixtures are built in their own box [0, h] with the ceiling side at the top
// (y = h): placement lifts them to ceiling − drop − h, and a pendant's cord (the drop)
// is added by the placement, not here. So are the light sources (utils/fixtureLights.ts),
// which light the materials tagged `fixtureGlow` to match the fixture's output.

/** Warm glowing glass for bulbs and diffusers. */
function glowMaterial(intensity = 0.5): THREE.MeshStandardMaterial {
  const mat = createMaterial('#fffde0', 0.1, 0.0);
  mat.emissive = new THREE.Color(0xfff5c0);
  mat.emissiveIntensity = intensity;
  mat.userData.fixtureGlow = 1;
  return mat;
}

/** A lamp shade that glows faintly when lit, tinted by its own colour (translucent fabric or glass). */
function shadeMaterial(color: string): THREE.MeshStandardMaterial {
  const mat = createMaterial(color, 0.9, 0.0);
  mat.userData.fixtureGlow = 0.4;
  mat.userData.fixtureGlowTint = true;
  return mat;
}

function createCeilingLight(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.3, 0.1);
  const r = Math.min(w, d) / 2;
  const geo = new THREE.CylinderGeometry(r, r * 0.8, h, 24);
  // Side and top in the fixture's colour, the underside an opal diffuser
  const mesh = new THREE.Mesh(geo, [mat, mat, glowMaterial()]);
  mesh.position.y = h / 2; // Flush with the ceiling at the top
  group.add(mesh);
}

function createChandelier(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.3, 0.5);
  // Central body, a stem up to the top of the box (where the cord or ceiling takes over)
  // and a finial down to the bottom
  const bodyR = Math.min(w * 0.15, h * 0.2), bodyY = h * 0.55;
  const body = new THREE.Mesh(new THREE.SphereGeometry(bodyR, 12, 12), mat);
  body.position.y = bodyY;
  // The light sits at the centre, among body, stem and finial: they cast no shadow.
  body.userData.castShadow = false;
  group.add(body);
  const stemLength = Math.max(0.1, h - bodyY - bodyR * 0.8);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, stemLength, 8), mat);
  stem.position.y = h - stemLength / 2;
  stem.userData.castShadow = false;
  group.add(stem);
  const finialLength = Math.max(0.1, bodyY - bodyR * 0.8);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(Math.min(2.5, bodyR * 0.5), finialLength, 10).rotateX(Math.PI), mat);
  finial.position.y = finialLength / 2;
  finial.userData.castShadow = false;
  group.add(finial);
  // Arms with bulbs
  const armMat = createMaterial('#888', 0.3, 0.8);
  const bulbMat = glowMaterial();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = w * 0.35;
    const armGeo = new THREE.CylinderGeometry(1.5, 1.5, r, 6);
    armGeo.rotateZ(Math.PI / 2);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.position.set(Math.cos(a) * r * 0.5, h * 0.5, Math.sin(a) * r * 0.5);
    arm.rotation.y = -a;
    group.add(arm);
    // Bulb
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), bulbMat);
    bulb.position.set(Math.cos(a) * r, h * 0.4, Math.sin(a) * r);
    group.add(bulb);
  }
}

function createRecessedLight(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.2, 0.1);
  const r = Math.min(w, d) / 2;
  const geo = new THREE.CylinderGeometry(r, r, h, 16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  group.add(mesh);
  // Glowing lens on the underside
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, Math.min(0.4, h * 0.1), 16), glowMaterial(0.6));
  lens.position.y = Math.min(0.2, h * 0.05);
  group.add(lens);
}

function createFloorLamp(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  // Base
  const baseMat = createMaterial('#333', 0.5, 0.8);
  const baseGeo = new THREE.CylinderGeometry(w * 0.25, w * 0.3, 5, 16);
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 2.5;
  group.add(base);
  // Pole
  const poleGeo = new THREE.CylinderGeometry(2, 2, h * 0.85, 8);
  const pole = new THREE.Mesh(poleGeo, baseMat);
  pole.position.y = h * 0.425 + 5;
  group.add(pole);
  // Shade
  const shadeMat = shadeMaterial(color);
  const shadeGeo = new THREE.CylinderGeometry(w * 0.3, w * 0.2, h * 0.15, 16, 1, true);
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.position.y = h * 0.925;
  group.add(shade);
}

function createTableLamp(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const baseMat = createMaterial('#555', 0.5, 0.5);
  const baseGeo = new THREE.CylinderGeometry(w * 0.2, w * 0.25, h * 0.15, 12);
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = h * 0.075;
  group.add(base);
  const poleGeo = new THREE.CylinderGeometry(1.5, 1.5, h * 0.5, 8);
  const pole = new THREE.Mesh(poleGeo, baseMat);
  pole.position.y = h * 0.4;
  group.add(pole);
  const shadeMat = shadeMaterial(color);
  const shadeGeo = new THREE.CylinderGeometry(w * 0.35, w * 0.45, h * 0.35, 16, 1, true);
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.position.y = h * 0.825;
  group.add(shade);
}

function createWallSconce(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.5, 0.2);
  const geo = new THREE.BoxGeometry(w, h, d);
  // Up/down light: the top and bottom faces glow (box faces are +x, −x, +y, −y, +z, −z)
  const glow = glowMaterial();
  const mesh = new THREE.Mesh(geo, [mat, mat, glow, glow, mat, mat]);
  // Built in its own box [0, h]; the item's mounting height (catalog elevation 170) lifts it.
  mesh.position.y = h / 2;
  group.add(mesh);
}

/**
 * Ceiling fan in its own box [0, h]: a canopy against the ceiling at the top, a short
 * downrod, the motor housing with five pitched blades spanning the footprint, and a
 * light kit (switch housing and glass bowl) at the bottom.
 */
function createCeilingFan(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const body = createMaterial(color, 0.5, 0.3);
  const metal = createMaterial('#9ca3af', 0.3, 0.8);
  const bladeMat = new THREE.MeshStandardMaterial({ color: adjustColor(color, 0.8), roughness: 0.6, metalness: 0.05 });
  const r = Math.min(w, d) / 2;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    group.add(mesh);
    return mesh;
  };

  // Light kit at the bottom: a glass bowl (lower hemisphere) under a switch housing
  const kitR = Math.min(9, h * 0.22, r * 0.3), housingH = Math.min(2, h * 0.05);
  add(new THREE.SphereGeometry(kitR, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glowMaterial(0.4), kitR);
  add(new THREE.CylinderGeometry(kitR + 0.5, kitR + 0.5, housingH, 24), body, kitR + housingH / 2);

  // Motor housing
  const motorR = Math.min(12, r * 0.25), motorBottom = kitR + housingH, motorH = Math.min(12, h * 0.25);
  add(new THREE.CylinderGeometry(motorR * 0.85, motorR, motorH, 24), body, motorBottom + motorH / 2);

  // Canopy against the ceiling and the downrod down to the motor
  const canopyH = Math.min(5, h * 0.12);
  add(new THREE.CylinderGeometry(Math.min(7.5, r * 0.15), Math.min(5, r * 0.1), canopyH, 20), body, h - canopyH / 2);
  const rodH = Math.max(0.1, h - canopyH - motorBottom - motorH);
  add(new THREE.CylinderGeometry(1.2, 1.2, rodH, 8), metal, motorBottom + motorH + rodH / 2);

  // Five blades on irons, pitched a little; the tips' corners stay inside the footprint
  const bladeW = Math.min(13, r * 0.25), bladeT = 1, bladeY = motorBottom + motorH * 0.3;
  const inner = motorR + 4, outer = Math.sqrt(Math.max(0, r * r - (bladeW / 2) ** 2)) - 0.5;
  const length = Math.max(1, outer - inner);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const iron = new THREE.BoxGeometry(inner - motorR * 0.8 + 3, 0.8, 3).translate(motorR * 0.8 + (inner - motorR * 0.8 + 3) / 2, bladeY - 1, 0);
    const blade = new THREE.BoxGeometry(length, bladeT, bladeW).rotateX(0.18).translate(inner + length / 2, bladeY - 1, 0);
    for (const [geometry, material] of [[iron, metal], [blade, bladeMat]] as const) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.y = -a;
      group.add(mesh);
    }
  }
}

/** Ceiling smoke detector in its own box [0, h]: mounting base at the top, a low white body, test button and a small red LED. */
function createSmokeDetector(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const r = Math.min(w, d) / 2;
  const shell = createMaterial(color, 0.6, 0.0);
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    group.add(mesh);
    return mesh;
  };
  const baseH = Math.min(1, h * 0.2), buttonH = Math.min(1.2, h * 0.24), bodyH = Math.max(0.1, h - baseH - buttonH);
  add(new THREE.CylinderGeometry(r, r, baseH, 32), shell, 0, h - baseH / 2);
  add(new THREE.CylinderGeometry(r * 0.95, r * 0.85, bodyH, 32), shell, 0, buttonH + bodyH / 2);
  // Vent groove around the body
  add(new THREE.CylinderGeometry(r * 0.93, r * 0.93, Math.min(0.3, bodyH * 0.2), 32), createMaterial('#a8a29e', 0.8, 0.0), 0, buttonH + bodyH * 0.6);
  add(new THREE.CylinderGeometry(r * 0.45, r * 0.5, buttonH, 24), createMaterial(adjustColor(color, 0.92), 0.5, 0.0), 0, buttonH / 2);
  const led = new THREE.MeshStandardMaterial({ color: '#dc2626', emissive: '#ef4444', emissiveIntensity: 1 });
  add(new THREE.SphereGeometry(Math.min(0.35, r * 0.06), 8, 6), led, r * 0.62, buttonH);
}

/** Pendant shade in its own box [0, h]: a cap at the top (where the cord meets it), the open shade and a bulb. */
function createPendantLight(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color, 0.5, 0.2);
  mat.side = THREE.DoubleSide; // The inside of the shade shows from below
  const r = Math.min(w, d) / 2;
  const capH = Math.min(2, h * 0.1), shadeH = h - capH;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, capH, 16), createMaterial('#333', 0.3, 0.8));
  cap.position.y = h - capH / 2;
  group.add(cap);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r, shadeH, 16, 1, true), mat);
  shade.position.y = shadeH / 2;
  group.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(4, r * 0.25), 10, 10), glowMaterial());
  bulb.position.y = shadeH * 0.35;
  group.add(bulb);
}

// ============ Plan symbols in 3D ============

/** Faceplate of wall-mounted outlets and switches in 3D, cm (wide × tall × deep). */
export const SYMBOL_FACEPLATE = { width: 8, height: 8, depth: 1.2 } as const;
/** Thickness of the disc that stands in for ceiling plan symbols in 3D, cm. */
export const CEILING_SYMBOL_THICKNESS = 2;

const WALL_SYMBOLS = new Set(['sym_outlet', 'sym_outlet_double', 'sym_switch']);
const CEILING_SYMBOLS = new Set(['sym_ceiling_light', 'sym_recessed_light', 'sym_pendant', 'sym_ceiling_fan', 'sym_smoke']);

/** How a plan symbol shows in 3D: a faceplate on the wall, a disc on the ceiling, or nothing. */
export function symbolModelKind(catalogId: string): 'faceplate' | 'disc' | null {
  return WALL_SYMBOLS.has(catalogId) ? 'faceplate' : CEILING_SYMBOLS.has(catalogId) ? 'disc' : null;
}

/**
 * The 3D stand-in for a plan symbol, or null for symbols that have none. Outlets and
 * switches are a faceplate in the box [0, SYMBOL_FACEPLATE.height], centred in x, its
 * back at z = −depth/2 and its face towards +z; ceiling symbols are a disc in
 * [0, CEILING_SYMBOL_THICKNESS] with a mark in the symbol's colour underneath.
 */
export function createSymbolModel(catalogId: string, def: Pick<FurnitureDef, 'width' | 'depth' | 'color'>): THREE.Group | null {
  const kind = symbolModelKind(catalogId);
  if (!kind) return null;
  const group = new THREE.Group();
  group.name = `symbol_${catalogId}`;
  const plastic = createMaterial('#f5f5f4', 0.5, 0.0);
  if (kind === 'faceplate') {
    // A double outlet is two sockets side by side on one plate.
    const sockets = catalogId === 'sym_outlet_double' ? 2 : 1;
    const { height, depth } = SYMBOL_FACEPLATE, width = SYMBOL_FACEPLATE.width * sockets;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 2, 0.4), plastic);
    plate.position.y = height / 2;
    group.add(plate);
    const face = depth / 2;
    if (catalogId === 'sym_outlet' || catalogId === 'sym_outlet_double') {
      // Two round sockets per outlet, each with two pin holes
      const insert = createMaterial('#e7e5e4', 0.6, 0.0), hole = createMaterial('#1c1917', 0.8, 0.0);
      for (let i = 0; i < sockets; i++) {
        const cx = (i - (sockets - 1) / 2) * SYMBOL_FACEPLATE.width;
        for (const y of [height * 0.3, height * 0.7]) {
          const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 20).rotateX(Math.PI / 2), insert);
          socket.position.set(cx, y, face + 0.1);
          group.add(socket);
          for (const x of [-0.6, 0.6]) {
            const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 8).rotateX(Math.PI / 2), hole);
            pin.position.set(cx + x, y, face + 0.27);
            group.add(pin);
          }
        }
      }
    } else {
      // Rocker, tipped a little
      const rocker = new THREE.Mesh(new RoundedBoxGeometry(width * 0.5, height * 0.62, 0.8, 2, 0.2), createMaterial('#fafaf9', 0.4, 0.0));
      rocker.position.set(0, height / 2, face + 0.3);
      rocker.rotation.x = 0.08;
      group.add(rocker);
    }
  } else {
    const r = Math.max(4, Math.min(def.width, def.depth) / 2);
    const markT = 0.3, body = CEILING_SYMBOL_THICKNESS - markT;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, body, 24), plastic);
    disc.position.y = markT + body / 2;
    group.add(disc);
    const mark = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, markT, 24), createMaterial(def.color, 0.5, 0.0));
    mark.position.y = markT / 2;
    group.add(mark);
  }
  enableShadows(group);
  return group;
}

// ============ Outdoor Furniture ============

const WOOD_BROWN = '#8B6914';
const WOOD_DARK = '#5C4033';
const METAL_GRAY = '#707070';
const METAL_DARK = '#404040';
const FABRIC_RED = '#C0392B';
const PLANTER_BROWN = '#6B4226';

function createBenchOutdoor(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wood = createMaterial(color || WOOD_BROWN, 0.8, 0.05);
  const seatH = 3; const seatY = h * 0.45;
  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w, seatH, d * 0.6), wood);
  seat.position.set(0, seatY, -d * 0.1);
  group.add(seat);
  // Back rest
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.45, 2), wood);
  back.position.set(0, seatY + h * 0.25, -d * 0.35);
  group.add(back);
  // Two side supports
  const supportMat = createMaterial(WOOD_DARK, 0.8, 0.05);
  for (const side of [-1, 1]) {
    const support = new THREE.Mesh(new THREE.BoxGeometry(3, seatY, d * 0.7), supportMat);
    support.position.set(side * (w / 2 - 3), seatY / 2, -d * 0.05);
    group.add(support);
  }
}

function createPicnicTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wood = createMaterial(color || WOOD_BROWN, 0.8, 0.05);
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d * 0.4), wood);
  tableTop.position.set(0, h, 0);
  group.add(tableTop);
  // Bench seats
  for (const side of [-1, 1]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d * 0.2), wood);
    bench.position.set(0, h * 0.55, side * d * 0.35);
    group.add(bench);
  }
  // A-frame legs
  const legMat = createMaterial(WOOD_DARK, 0.8, 0.05);
  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(3, h * 1.1, 3), legMat);
      leg.position.set(xSide * (w * 0.35), h * 0.5, zSide * d * 0.25);
      leg.rotation.z = xSide * zSide * 0.15;
      group.add(leg);
    }
  }
}

function createPatioTable(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || METAL_GRAY, 0.4, 0.6);
  const r = Math.min(w, d) / 2;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 3, 16), mat);
  top.position.y = h;
  group.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, h, 8), mat);
  leg.position.y = h / 2;
  group.add(leg);
}

function createPatioChair(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || METAL_GRAY, 0.4, 0.5);
  const seatY = h * 0.45; const seatH = 2;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, seatH, d * 0.8), mat);
  seat.position.set(0, seatY, d * 0.05);
  group.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, h * 0.5, 2), mat);
  back.position.set(0, seatY + h * 0.28, -d * 0.35);
  group.add(back);
  const legR = 1.5;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, seatY, 6), mat);
      leg.position.set(x * (w * 0.35), seatY / 2, z * (d * 0.3));
      group.add(leg);
    }
  }
}

function createUmbrella(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const poleMat = createMaterial(METAL_GRAY, 0.3, 0.7);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h, 8), poleMat);
  pole.position.y = h / 2;
  group.add(pole);
  const canopyMat = createMaterial(color || FABRIC_RED, 0.9, 0.0);
  const r = Math.min(w, d) / 2;
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.2, 8, 1, true), canopyMat);
  canopy.position.y = h * 0.92;
  group.add(canopy);
}

function createBBQGrill(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyMat = createMaterial(color || METAL_DARK, 0.4, 0.6);
  const bodyH = h * 0.4;
  const bodyY = h * 0.55;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, bodyH, d * 0.7), bodyMat);
  body.position.set(0, bodyY, 0);
  group.add(body);
  // Lid
  const lid = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, 3, d * 0.7), bodyMat);
  lid.position.set(0, bodyY + bodyH / 2 + 1.5, 0);
  group.add(lid);
  // 4 legs
  const legMat = createMaterial(METAL_GRAY, 0.3, 0.7);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, bodyY - bodyH / 2, 6), legMat);
      leg.position.set(x * (w * 0.35), (bodyY - bodyH / 2) / 2, z * (d * 0.25));
      group.add(leg);
    }
  }
}

function createPergola(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wood = createMaterial(color || WOOD_BROWN, 0.8, 0.05);
  const postW = Math.max(5, w * 0.04);
  // 4 posts
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(postW, h, postW), wood);
      post.position.set(x * (w / 2 - postW), h / 2, z * (d / 2 - postW));
      group.add(post);
    }
  }
  // Cross beams along width
  const beamH = Math.max(3, h * 0.05);
  const numBeams = Math.max(3, Math.round(d / 30));
  for (let i = 0; i < numBeams; i++) {
    const zPos = -d / 2 + postW + (i / (numBeams - 1)) * (d - 2 * postW);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w, beamH, postW * 0.6), wood);
    beam.position.set(0, h - beamH / 2, zPos);
    group.add(beam);
  }
  // Side beams
  for (const x of [-1, 1]) {
    const sideBeam = new THREE.Mesh(new THREE.BoxGeometry(postW * 0.6, beamH, d), wood);
    sideBeam.position.set(x * (w / 2 - postW), h - beamH / 2, 0);
    group.add(sideBeam);
  }
}

function createGazebo(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wood = createMaterial(color || WOOD_BROWN, 0.8, 0.05);
  const r = Math.min(w, d) / 2;
  const postW = Math.max(4, r * 0.08);
  const numPosts = 6;
  // Posts in circle
  for (let i = 0; i < numPosts; i++) {
    const angle = (i / numPosts) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(postW, h * 0.8, postW), wood);
    post.position.set(Math.cos(angle) * (r - postW), h * 0.4, Math.sin(angle) * (r - postW));
    group.add(post);
  }
  // Cone roof
  const roofMat = createMaterial('#8B4513', 0.8, 0.05);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.1, h * 0.3, numPosts), roofMat);
  roof.position.y = h * 0.8 + h * 0.15;
  group.add(roof);
}

function createPicketFence(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wood = createMaterial(color || '#F5F5DC', 0.8, 0.05);
  const picketW = 3; const picketGap = 5; const railH = 3;
  // Rails
  for (const yFrac of [0.3, 0.75]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, railH, d), wood);
    rail.position.set(0, h * yFrac, 0);
    group.add(rail);
  }
  // Pickets
  const numPickets = Math.max(2, Math.floor(w / (picketW + picketGap)));
  const totalSpan = (numPickets - 1) * (picketW + picketGap);
  for (let i = 0; i < numPickets; i++) {
    const xPos = -totalSpan / 2 + i * (picketW + picketGap);
    const picket = new THREE.Mesh(new THREE.BoxGeometry(picketW, h, d), wood);
    picket.position.set(xPos, h / 2, 0);
    group.add(picket);
  }
}

function createMetalFence(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const metal = createMaterial(color || METAL_DARK, 0.3, 0.7);
  const barR = 1; const barGap = 8;
  // Top and bottom rails
  for (const yFrac of [0.05, 0.95]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 2, d), metal);
    rail.position.set(0, h * yFrac, 0);
    group.add(rail);
  }
  // Vertical bars
  const numBars = Math.max(2, Math.floor(w / barGap));
  const totalSpan = (numBars - 1) * barGap;
  for (let i = 0; i < numBars; i++) {
    const xPos = -totalSpan / 2 + i * barGap;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(barR, barR, h, 6), metal);
    bar.position.set(xPos, h / 2, 0);
    group.add(bar);
  }
}

function createLounger(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || WOOD_BROWN, 0.6, 0.2);
  // Flat seat
  const seatLen = d * 0.65;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 3, seatLen), mat);
  seat.position.set(0, h * 0.35, d * 0.1);
  group.add(seat);
  // Angled back
  const backLen = d * 0.35;
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, 3, backLen), mat);
  back.position.set(0, h * 0.55, -d * 0.3);
  back.rotation.x = -0.5;
  group.add(back);
  // Frame legs
  const legMat = createMaterial(METAL_GRAY, 0.3, 0.7);
  for (const x of [-1, 1]) {
    for (const z of [-0.3, 0.35]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, h * 0.35, 6), legMat);
      leg.position.set(x * (w * 0.4), h * 0.175, z * d);
      group.add(leg);
    }
  }
}

function createGardenShed(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const wallMat = createMaterial(color || '#A0522D', 0.8, 0.05);
  const wallH = h * 0.7;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
  walls.position.y = wallH / 2;
  group.add(walls);
  // Triangular roof using a prism (extruded triangle)
  const roofMat = createMaterial('#654321', 0.8, 0.05);
  const roofH = h * 0.3;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, roofH);
  shape.closePath();
  const extrudeSettings = { depth: d, bevelEnabled: false };
  const roofGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, wallH, -d / 2);
  group.add(roof);
}

function createPlanterBox(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || PLANTER_BROWN, 0.85, 0.05);
  const thick = 2;
  // 4 walls, no top
  const front = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), mat);
  front.position.set(0, h / 2, d / 2);
  group.add(front);
  const backW = new THREE.Mesh(new THREE.BoxGeometry(w, h, thick), mat);
  backW.position.set(0, h / 2, -d / 2);
  group.add(backW);
  const left = new THREE.Mesh(new THREE.BoxGeometry(thick, h, d), mat);
  left.position.set(-w / 2, h / 2, 0);
  group.add(left);
  const right = new THREE.Mesh(new THREE.BoxGeometry(thick, h, d), mat);
  right.position.set(w / 2, h / 2, 0);
  group.add(right);
  // Bottom
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(w, thick, d), mat);
  bottom.position.set(0, thick / 2, 0);
  group.add(bottom);
  // Soil fill
  const soil = new THREE.Mesh(new THREE.BoxGeometry(w - 2 * thick, h * 0.6, d - 2 * thick), createMaterial('#3E2723', 0.95, 0.0));
  soil.position.set(0, h * 0.3, 0);
  group.add(soil);
}

function createRaisedBed(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  // Same as planter but uses the provided (wider/lower) dimensions
  createPlanterBox(group, w, d, h, color || '#7B5B3A');
}

// --- Pool & Spa ---
function createPool(group: THREE.Group, w: number, d: number, h: number, color: string, type: string): void {
  const waterMat = createMaterial(color || '#0ea5e9', 0.3, 0.1);
  (waterMat as THREE.MeshStandardMaterial).transparent = true;
  (waterMat as THREE.MeshStandardMaterial).opacity = 0.7;
  const rimMat = createMaterial('#d6d3d1', 0.9, 0.0);
  const rimH = 8;
  if (type === 'pool_round' || type === 'pool_kidney') {
    const rx = w / 2, rz = d / 2;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(rx, rx, h, 32), waterMat);
    water.position.y = h / 2;
    group.add(water);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rx, rimH / 2, 8, 32), rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = h;
    group.add(rim);
  } else {
    const water = new THREE.Mesh(new THREE.BoxGeometry(w - 16, h, d - 16), waterMat);
    water.position.y = h / 2;
    group.add(water);
    // Rim (4 edges)
    const addRim = (rx: number, rz: number, rw: number, rd: number) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(rw, rimH, rd), rimMat);
      r.position.set(rx, h + rimH / 2, rz);
      group.add(r);
    };
    addRim(0, -d / 2, w, rimH); addRim(0, d / 2, w, rimH);
    addRim(-w / 2, 0, rimH, d); addRim(w / 2, 0, rimH, d);
  }
}

function createHotTub(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#0284c7', 0.4, 0.1);
  (mat as THREE.MeshStandardMaterial).transparent = true;
  (mat as THREE.MeshStandardMaterial).opacity = 0.7;
  const wallMat = createMaterial('#78716c', 0.9, 0.0);
  const r = w / 2;
  // Outer shell
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), wallMat);
  outer.position.y = h / 2;
  group.add(outer);
  // Water inside
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r - 5, r - 5, h - 5, 24), mat);
  water.position.y = h / 2 + 2.5;
  group.add(water);
}

function createDivingBoard(group: THREE.Group, w: number, d: number, h: number): void {
  const baseMat = createMaterial('#94a3b8', 0.7, 0.2);
  const boardMat = createMaterial('#e2e8f0', 0.6, 0.1);
  // Support base
  const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.7, 30), baseMat);
  base.position.set(0, h * 0.35, -d / 2 + 15);
  group.add(base);
  // Board
  const board = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 3, d), boardMat);
  board.position.set(0, h * 0.7, 0);
  group.add(board);
}

// --- Garage ---
function createCar(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const bodyMat = createMaterial(color || '#475569', 0.4, 0.5);
  const glassMat = createMaterial('#bfdbfe', 0.2, 0.6);
  (glassMat as THREE.MeshStandardMaterial).transparent = true;
  (glassMat as THREE.MeshStandardMaterial).opacity = 0.5;
  const wheelMat = createMaterial('#1e1e1e', 0.9, 0.0);
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.4, d * 0.8), bodyMat);
  body.position.set(0, h * 0.2, 0);
  group.add(body);
  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, h * 0.35, d * 0.45), glassMat);
  cabin.position.set(0, h * 0.575, -d * 0.05);
  group.add(cabin);
  // Wheels (4)
  const wheelR = h * 0.15;
  const positions = [
    [-w / 2, wheelR, -d * 0.3], [w / 2, wheelR, -d * 0.3],
    [-w / 2, wheelR, d * 0.3], [w / 2, wheelR, d * 0.3]
  ];
  for (const [x, y, z] of positions) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 8, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, z);
    group.add(wheel);
  }
}

// --- Paths & Lawns ---
function createLawn(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#22c55e', 0.95, 0.0);
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  lawn.position.y = h / 2;
  group.add(lawn);
}

function createPath(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#a8a29e', 0.85, 0.0);
  const path = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  path.position.y = h / 2;
  group.add(path);
}

function createFlatSurface(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#d6d3d1', 0.9, 0.0);
  const surface = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  surface.position.y = h / 2;
  group.add(surface);
}

// --- Outdoor Lighting ---
function createLampPost(group: THREE.Group, w: number, d: number, h: number, color: string, isDouble: boolean): void {
  const poleMat = createMaterial(color || '#1e293b', 0.7, 0.3);
  const lightMat = createMaterial('#fbbf24', 0.3, 0.1);
  lightMat.userData.fixtureGlow = 1;
  // Pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, h * 0.85, 8), poleMat);
  pole.position.y = h * 0.425;
  group.add(pole);
  // Lamp head(s)
  const addLamp = (offsetX: number) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 25, 6), poleMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(offsetX / 2, h * 0.85, 0);
    group.add(arm);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), lightMat);
    lamp.position.set(offsetX, h * 0.9, 0);
    group.add(lamp);
  };
  if (isDouble) { addLamp(-15); addLamp(15); } else { addLamp(0); }
}

function createBollardLight(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#374151', 0.7, 0.3);
  const lightMat = createMaterial('#fbbf24', 0.3, 0.1);
  lightMat.userData.fixtureGlow = 1;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(w / 3, w / 2.5, h * 0.8, 8), mat);
  post.position.y = h * 0.4;
  group.add(post);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 3, h * 0.2, 8), lightMat);
  top.position.y = h * 0.9;
  group.add(top);
}

// --- Garden Structures ---
function createGreenhouse(group: THREE.Group, w: number, d: number, h: number): void {
  const frameMat = createMaterial('#374151', 0.7, 0.3);
  const glassMat = createMaterial('#86efac', 0.2, 0.2);
  (glassMat as THREE.MeshStandardMaterial).transparent = true;
  (glassMat as THREE.MeshStandardMaterial).opacity = 0.35;
  // Frame posts (4 corners)
  const postW = 4;
  for (const [x, z] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(postW, h, postW), frameMat);
    post.position.set(x, h / 2, z);
    group.add(post);
  }
  // Glass walls (4 sides)
  const addWall = (x: number, z: number, ww: number, wd: number) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, h * 0.85, wd), glassMat);
    wall.position.set(x, h * 0.425, z);
    group.add(wall);
  };
  addWall(0, -d/2, w, 2); addWall(0, d/2, w, 2);
  addWall(-w/2, 0, 2, d); addWall(w/2, 0, 2, d);
  // Pitched roof
  const roofShape = new THREE.Shape();
  roofShape.moveTo(-w / 2, 0);
  roofShape.lineTo(0, h * 0.25);
  roofShape.lineTo(w / 2, 0);
  roofShape.lineTo(-w / 2, 0);
  const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: d, bevelEnabled: false });
  const roof = new THREE.Mesh(roofGeo, glassMat);
  roof.position.set(0, h, -d / 2);
  group.add(roof);
}

function createFountain(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#94a3b8', 0.7, 0.1);
  const waterMat = createMaterial('#60a5fa', 0.3, 0.1);
  // Base basin
  const base = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2.2, h * 0.25, 24), mat);
  base.position.y = h * 0.125;
  group.add(base);
  // Middle tier
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(w / 4, w / 3.5, h * 0.3, 16), mat);
  mid.position.y = h * 0.4;
  group.add(mid);
  // Top
  const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 8, w / 6, h * 0.2, 12), mat);
  top.position.y = h * 0.7;
  group.add(top);
  // Water
  const water = new THREE.Mesh(new THREE.CylinderGeometry(w / 2.3, w / 2.3, h * 0.08, 24), waterMat);
  water.position.y = h * 0.2;
  group.add(water);
}

function createArbor(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || '#92400e', 0.85, 0.0);
  const postW = 6;
  // 4 posts
  for (const [x, z] of [[-w/2, -d/2], [w/2, -d/2], [-w/2, d/2], [w/2, d/2]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(postW, h, postW), mat);
    post.position.set(x, h / 2, z);
    group.add(post);
  }
  // Cross beams on top
  for (let i = 0; i < 4; i++) {
    const z = -d / 2 + (d / 3) * i;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 20, 4, 4), mat);
    beam.position.set(0, h, z);
    group.add(beam);
  }
}

function createDeckPatio(group: THREE.Group, w: number, d: number, h: number, color: string): void {
  const mat = createMaterial(color || WOOD_BROWN, 0.8, 0.05);
  const plankW = 8; const gap = 1;
  const numPlanks = Math.max(1, Math.floor(w / (plankW + gap)));
  const totalW = numPlanks * plankW + (numPlanks - 1) * gap;
  for (let i = 0; i < numPlanks; i++) {
    const xPos = -totalW / 2 + plankW / 2 + i * (plankW + gap);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(plankW, h, d), mat);
    plank.position.set(xPos, h / 2, 0);
    group.add(plank);
  }
}
