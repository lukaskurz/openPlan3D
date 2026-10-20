import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyFixtureAdaptation, colorTemperatureColor, createFixtureLights, FIXTURE_GLOW_INTENSITY, FIXTURE_PHOTOMETRY,
  fixtureAdaptation, indirectIrradiance, isLightFixture, limitFixtureShadows, MAX_FIXTURE_SHADOWS, resolveFixtureLight,
  roomSurfaceArea, SCENE_IRRADIANCE_PER_LUX, sceneIntensity, SPOT_PENUMBRA, spotConeAngle, spotSolidAngle, WHITE_POINT,
} from '$lib/utils/fixtureLights';
import { createPlacedFurnitureModel } from '$lib/utils/furnitureModelLoader';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { readProject } from '$lib/utils/projectValidation';
import type { FixtureLight, FurnitureItem } from '$lib/models/types';
import { roomProject } from './fixtures/project';

const item = (catalogId: string, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id: catalogId, catalogId, position: { x: 200, y: 150 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

const lightsOf = (root: THREE.Object3D) => {
  const lights: (THREE.PointLight | THREE.SpotLight)[] = [];
  root.traverse(child => { if (child instanceof THREE.PointLight || child instanceof THREE.SpotLight) lights.push(child); });
  return lights;
};
const fixtureLights = (catalogId: string, light?: FixtureLight) =>
  lightsOf(createFixtureLights(catalogId, getCatalogItem(catalogId)!, light) ?? new THREE.Group());

/** Real illuminance in lx a scene light gives at `cm` along its axis (inverse square, before three's range fade). */
const luxAt = (light: THREE.Light, cm: number) => light.intensity / (cm * cm) / SCENE_IRRADIANCE_PER_LUX;

/** three's spot falloff at angle θ off the axis. */
const spotFalloff = (angle: number, theta: number) => {
  const outer = Math.cos(angle), inner = Math.cos(angle * (1 - SPOT_PENUMBRA));
  const t = Math.min(1, Math.max(0, (Math.cos(theta) - outer) / (inner - outer)));
  return t * t * (3 - 2 * t);
};

describe('fixture photometry', () => {
  it('fits three\'s spot cone so the beam angle is where the intensity halves', () => {
    for (const beam of [20, 38, 60, 100, 130]) {
      const angle = spotConeAngle(beam);
      expect(spotFalloff(angle, beam * Math.PI / 360)).toBeCloseTo(0.5, 4);
      expect(angle).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it('integrates the spot falloff to a solid angle (a hard cone is 2π(1 − cos θ))', () => {
    expect(spotSolidAngle(0.5, 0)).toBeCloseTo(2 * Math.PI * (1 - Math.cos(0.5)), 3);
    // A soft edge sheds some of the hard cone's solid angle
    expect(spotSolidAngle(0.5)).toBeLessThan(spotSolidAngle(0.5, 0));
    expect(spotSolidAngle(0.5)).toBeGreaterThan(spotSolidAngle(0.5 * (1 - SPOT_PENUMBRA), 0));
  });

  it('converts candela for a centimetre scene: 1 cd at 1 m gives 1 lx', () => {
    expect(sceneIntensity(1) / (100 * 100)).toBeCloseTo(SCENE_IRRADIANCE_PER_LUX);
  });

  it('gives a 400 lm, 38° downlight about 100–200 lx on the floor 2.5 m below', () => {
    const [spot] = fixtureLights('recessed_light') as THREE.SpotLight[];
    expect(spot).toBeInstanceOf(THREE.SpotLight);
    expect(spot.angle).toBeCloseTo(spotConeAngle(38));
    // Light-colour luminance is folded into the intensity, so compare the white-light candela
    const lux = luxAt(spot, 250) / colorTemperatureColor(2700).luminanceScale;
    expect(lux).toBeGreaterThan(100);
    expect(lux).toBeLessThan(200);
    // It points straight down
    const direction = spot.target.position.clone().sub(spot.position).normalize();
    expect(direction.y).toBeCloseTo(-1);
  });

  it('defaults to the planned output and warm white for every fixture', () => {
    expect(resolveFixtureLight('recessed_light')).toMatchObject({ lumens: 400, colorTemperature: 2700, dim: 1, tilt: 0 });
    expect(resolveFixtureLight('pendant_light')!.lumens).toBe(800);
    expect(resolveFixtureLight('ceiling_light')!.lumens).toBe(1500);
    expect(resolveFixtureLight('floor_lamp')!.lumens).toBe(2000);
    expect(resolveFixtureLight('table_lamp')!.lumens).toBe(400);
    expect(resolveFixtureLight('wall_sconce')!.lumens).toBe(400);
    expect(resolveFixtureLight('sofa')).toBeNull();
    expect(isLightFixture('sofa')).toBe(false);
    for (const [id, photometry] of Object.entries(FIXTURE_PHOTOMETRY)) {
      expect(getCatalogItem(id), id).toBeDefined();
      expect(photometry.emitters.reduce((sum, e) => sum + e.share, 0), id).toBeCloseTo(1);
    }
  });

  it('sends a floor lamp\'s light mostly up', () => {
    const lights = fixtureLights('floor_lamp');
    const up = lights.find(l => l instanceof THREE.SpotLight)!;
    expect(up.target.position.y).toBeGreaterThan(up.position.y);
    const lumens = (l: THREE.Light) => l.userData.fixtureLumens;
    expect(lumens(up) / lights.reduce((sum, l) => sum + lumens(l), 0)).toBeGreaterThan(0.5);
  });

  it('keeps lumens across colour temperatures and renders the white point white', () => {
    const neutral = colorTemperatureColor(WHITE_POINT).color;
    expect([neutral.r, neutral.g, neutral.b].map(v => +v.toFixed(3))).toEqual([1, 1, 1]);
    const warm = colorTemperatureColor(2700).color, cool = colorTemperatureColor(6500).color;
    expect(warm.r).toBeGreaterThan(warm.g); expect(warm.g).toBeGreaterThan(warm.b);
    expect(cool.b).toBeGreaterThan(cool.r);
    for (const kelvin of [1900, 2700, 4000, 6500]) {
      const { color, luminanceScale } = colorTemperatureColor(kelvin);
      expect((0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) * luminanceScale).toBeCloseTo(1);
    }
  });
});

describe('per-item light settings', () => {
  it('scale with lumens and dim, and switch off at dim 0', () => {
    const [base] = fixtureLights('pendant_light');
    expect(fixtureLights('pendant_light', { lumens: 1600 })[0].intensity).toBeCloseTo(base.intensity * 2);
    expect(fixtureLights('pendant_light', { dim: 0.25 })[0].intensity).toBeCloseTo(base.intensity / 4);
    expect(createFixtureLights('pendant_light', getCatalogItem('pendant_light')!, { dim: 0 })).toBeNull();
  });

  it('narrow the beam and brighten its centre for the same lumens', () => {
    const [wide] = fixtureLights('recessed_light', { beamAngle: 60 });
    const [narrow] = fixtureLights('recessed_light', { beamAngle: 24 }) as THREE.SpotLight[];
    expect(narrow.angle).toBeCloseTo(spotConeAngle(24));
    expect(narrow.intensity).toBeGreaterThan(wide.intensity * 2);
  });

  it('change the light colour with the colour temperature', () => {
    const [warm] = fixtureLights('table_lamp');
    const [cool] = fixtureLights('table_lamp', { colorTemperature: 5000 });
    expect(cool.color.b / cool.color.r).toBeGreaterThan(warm.color.b / warm.color.r);
  });

  it('tilt a spot towards the item\'s front, and the item\'s rotation turns it', () => {
    const tilted = createPlacedFurnitureModel(item('recessed_light', { light: { tilt: 30 } }), undefined, undefined, 275)!;
    const [spot] = lightsOf(tilted) as THREE.SpotLight[];
    tilted.updateMatrixWorld(true);
    const direction = () => spot.target.getWorldPosition(new THREE.Vector3()).sub(spot.getWorldPosition(new THREE.Vector3())).normalize();
    expect(direction().y).toBeCloseTo(-Math.cos(Math.PI / 6));
    expect(direction().z).toBeCloseTo(Math.sin(Math.PI / 6));
    // Plan rotation 90° turns the front (+z) to −x in 3D (rotation.y = −90°)
    const turned = createPlacedFurnitureModel(item('recessed_light', { rotation: 90, light: { tilt: 30 } }), undefined, undefined, 275)!;
    const [turnedSpot] = lightsOf(turned) as THREE.SpotLight[];
    turned.updateMatrixWorld(true);
    const turnedDirection = turnedSpot.target.getWorldPosition(new THREE.Vector3()).sub(turnedSpot.getWorldPosition(new THREE.Vector3())).normalize();
    expect(turnedDirection.x).toBeCloseTo(-Math.sin(Math.PI / 6));
    expect(turnedDirection.z).toBeCloseTo(0);
  });

  it('light a placed fixture\'s bulb, and leave it dark when dimmed off', () => {
    const glows = (model: THREE.Object3D) => {
      const found: THREE.MeshStandardMaterial[] = [];
      model.traverse(child => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.userData.fixtureGlow === 1) found.push(child.material);
      });
      return found;
    };
    const lit = createPlacedFurnitureModel(item('pendant_light'), undefined, undefined, 190)!;
    expect(glows(lit).length).toBeGreaterThan(0);
    expect(glows(lit)[0].emissiveIntensity).toBeCloseTo(FIXTURE_GLOW_INTENSITY);
    const off = createPlacedFurnitureModel(item('pendant_light', { light: { dim: 0 } }), undefined, undefined, 190)!;
    expect(lightsOf(off)).toHaveLength(0);
    expect(glows(off)[0].emissiveIntensity).toBe(0);
    expect(lightsOf(createPlacedFurnitureModel(item('sofa'))!)).toHaveLength(0);
  });

  it('let a lamp shade glow less than a bulb, in its own colour', () => {
    const lamp = createPlacedFurnitureModel(item('table_lamp', { color: '#ff0000' }))!;
    let shade: THREE.MeshStandardMaterial | undefined;
    lamp.traverse(child => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.userData.fixtureGlowTint) shade = child.material;
    });
    expect(shade!.emissiveIntensity).toBeGreaterThan(0);
    expect(shade!.emissiveIntensity).toBeLessThan(FIXTURE_GLOW_INTENSITY);
    expect(shade!.emissive.g).toBeCloseTo(0);
  });

  it('are kept by the project reader, which rejects values out of range', () => {
    const project: any = roomProject();
    project.floors[0].furniture = [item('recessed_light', { light: { lumens: 650, beamAngle: 24, colorTemperature: 3000, dim: 0.6, tilt: 25 } })];
    const loaded = readProject(JSON.parse(JSON.stringify(project)));
    expect(loaded.floors[0].furniture[0].light).toEqual({ lumens: 650, beamAngle: 24, colorTemperature: 3000, dim: 0.6, tilt: 25 });
    for (const light of [{ dim: 2 }, { tilt: -5 }, { colorTemperature: 'warm' }, 'bright']) {
      project.floors[0].furniture[0].light = light;
      expect(() => readProject(JSON.parse(JSON.stringify(project)))).toThrow(/light/);
    }
  });
});

describe('fixture lights in the scene', () => {
  const scene = () => {
    const root = new THREE.Group();
    for (let i = 0; i < 10; i++) root.add(createFixtureLights('recessed_light', getCatalogItem('recessed_light')!)!);
    for (let i = 0; i < 3; i++) root.add(createFixtureLights('table_lamp', getCatalogItem('table_lamp')!)!);
    root.add(createFixtureLights('floor_lamp', getCatalogItem('floor_lamp')!)!);
    return root;
  };

  it('let only the brightest few cast shadows, with few point lights among them', () => {
    const root = scene();
    expect(limitFixtureShadows(root)).toBe(MAX_FIXTURE_SHADOWS);
    const casting = lightsOf(root).filter(l => l.castShadow);
    expect(casting).toHaveLength(MAX_FIXTURE_SHADOWS);
    expect(casting.filter(l => l instanceof THREE.PointLight).length).toBeLessThanOrEqual(2);
    // The floor lamp's uplight (1600 lm) is the brightest
    expect(casting.map(l => l.userData.fixtureLumens)).toContain(1600);
    for (const light of casting) expect(light.shadow.camera.far).toBe(light.distance);
  });

  it('follow the daylight: full at night, a fraction at noon', () => {
    expect(fixtureAdaptation(0.1)).toBe(1);
    expect(fixtureAdaptation(1)).toBeLessThan(1);
    expect(fixtureAdaptation(2.7)).toBeLessThan(fixtureAdaptation(1));
    expect(fixtureAdaptation(2.7)).toBeGreaterThan(0.1);
    const root = scene();
    const [light] = lightsOf(root);
    const full = light.intensity;
    const lumens = applyFixtureAdaptation(root, 0.25);
    expect(light.intensity).toBeCloseTo(full * 0.25);
    expect(lumens).toBeCloseTo(10 * 400 + 3 * 400 + 2000);
    applyFixtureAdaptation(root, 1);
    expect(light.intensity).toBeCloseTo(full);
  });

  it('estimate the bounced light from lumens over the rooms\' surface', () => {
    const surface = roomSurfaceArea([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], 280);
    expect(surface).toBeCloseTo(2 * 12 + 14 * 2.8);
    // ρ = 0.5: Φ / A lux
    expect(indirectIrradiance(3000, surface) / SCENE_IRRADIANCE_PER_LUX).toBeCloseTo(3000 / surface);
    expect(indirectIrradiance(3000, 0)).toBe(0);
  });
});
