import * as THREE from 'three';
import type { FixtureLight } from '$lib/models/types';

/**
 * Light fixtures as light sources in 3D: photometry in real units, converted for the scene.
 *
 * three (r155 and later) treats a punctual light's intensity as luminous intensity in
 * candela with inverse-square falloff over world units, and the scene is in centimetres.
 * The viewer's daylight is not calibrated in lux either (the noon sun is about 1), so a
 * fixture's real illuminance is scaled by SCENE_IRRADIANCE_PER_LUX: a surface under
 * 200 lx of lamplight gets the irradiance the sun gives it at noon. Together:
 *
 *   intensity = candela × SCENE_IRRADIANCE_PER_LUX × 100²   (cd → cd per cm², scaled)
 *
 * Fixtures store lumens. A point emitter's candela is lumens / 4π; a spot's is lumens over
 * the solid angle of three's spot falloff (`spotSolidAngle`), so a narrower beam with the
 * same lumens is brighter in its centre. The scene has no light bounce, so
 * `indirectIrradiance` estimates the room-average inter-reflected light for an ambient fill.
 */

/** Scene irradiance (three's units, the noon sun ≈ 1) per lux of real illuminance. */
export const SCENE_IRRADIANCE_PER_LUX = 1 / 200;
const CM_PER_M = 100;
/** A light's reach ends where its direct illuminance falls to this, lx (three fades it out towards `distance`). */
const CUTOFF_LUX = 1;
/** Spot penumbra: the outer 40 % of the cone fades out. */
export const SPOT_PENUMBRA = 0.4;
/** Narrowest and widest spot beam three's cone (half angle at most 90°) can show with SPOT_PENUMBRA, degrees. */
export const MIN_BEAM_ANGLE = 5;
export const MAX_BEAM_ANGLE = 140;
/** Colour temperature that renders white: an eye adapted to warm evening lamplight, K. */
export const WHITE_POINT = 3000;
/** Shadow-casting fixture lights at most; every shadow map is a texture unit and extra render passes. */
export const MAX_FIXTURE_SHADOWS = 6;
/** Of those, point lights at most (each renders the scene six times). */
const MAX_POINT_SHADOWS = 2;

type Box = { width: number; depth: number; height: number };

/** One light source of a fixture, in the fixture's own box (x, z centred, y from 0 at the bottom to `height`). */
export interface FixtureEmitter {
  /** 'spot' shines a cone along `aim`; 'point' all round. */
  kind: 'spot' | 'point';
  /** Share of the fixture's lumens. */
  share: number;
  aim?: 'down' | 'up';
  /** Spots: full beam angle at half intensity, degrees (the fixture's `beamAngle` overrides it). */
  beamAngle?: number;
  position: (box: Box) => [number, number, number];
}

export interface FixturePhotometry {
  /** Luminous flux at full output, lm. */
  lumens: number;
  /** Correlated colour temperature, K. */
  colorTemperature: number;
  emitters: FixtureEmitter[];
}

const warm = 2700;
/** Default photometry by catalog id: typical residential fixtures with warm-white LED lamps. */
export const FIXTURE_PHOTOMETRY: Record<string, FixturePhotometry> = {
  // Downlight, just below its trim
  recessed_light: { lumens: 400, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 1, aim: 'down', beamAngle: 38, position: () => [0, -0.5, 0] },
  ] },
  // Surface-mounted opal ceiling light: a wide, soft cone downwards
  ceiling_light: { lumens: 1500, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 1, aim: 'down', beamAngle: 130, position: () => [0, -2, 0] },
  ] },
  // Open pendant shade: the light leaves through the opening
  pendant_light: { lumens: 800, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 1, aim: 'down', beamAngle: 100, position: ({ height }) => [0, height * 0.15, 0] },
  ] },
  chandelier: { lumens: 1600, colorTemperature: warm, emitters: [
    { kind: 'point', share: 1, position: ({ height }) => [0, height * 0.4, 0] },
  ] },
  // Uplighter: most of the light onto the ceiling, some down through the shade
  floor_lamp: { lumens: 2000, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 0.8, aim: 'up', beamAngle: 120, position: ({ height }) => [0, height * 0.9, 0] },
    { kind: 'point', share: 0.2, position: ({ height }) => [0, height * 0.9, 0] },
  ] },
  table_lamp: { lumens: 400, colorTemperature: warm, emitters: [
    { kind: 'point', share: 1, position: ({ height }) => [0, height * 0.8, 0] },
  ] },
  // Up/down wall light, just in front of its face (the face points to +z, away from the wall)
  wall_sconce: { lumens: 400, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 0.5, aim: 'up', beamAngle: 100, position: ({ depth, height }) => [0, height / 2, depth / 2 + 2] },
    { kind: 'spot', share: 0.5, aim: 'down', beamAngle: 100, position: ({ depth, height }) => [0, height / 2, depth / 2 + 2] },
  ] },
  // Light kit under the fan
  ceiling_fan: { lumens: 800, colorTemperature: warm, emitters: [
    { kind: 'spot', share: 1, aim: 'down', beamAngle: 120, position: () => [0, -1, 0] },
  ] },
  fireplace: { lumens: 300, colorTemperature: 1900, emitters: [
    { kind: 'point', share: 1, position: ({ depth, height }) => [0, height * 0.3, depth * 0.3] },
  ] },
  bollard_light: { lumens: 200, colorTemperature: 3000, emitters: [
    { kind: 'point', share: 1, position: ({ height }) => [0, height * 0.9, 0] },
  ] },
};

/** Whether a catalog item lights the scene. */
export function isLightFixture(catalogId: string): boolean {
  return Object.hasOwn(FIXTURE_PHOTOMETRY, catalogId);
}

export interface ResolvedFixtureLight {
  lumens: number;
  colorTemperature: number;
  /** 0 (off) .. 1 */
  dim: number;
  /** degrees from straight down (or up) towards the item's front */
  tilt: number;
  /** Override for every spot emitter, degrees; undefined keeps each emitter's own. */
  beamAngle?: number;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A fixture's settings: the item's overrides over the catalog defaults, clamped to what renders. Null for items that are not fixtures. */
export function resolveFixtureLight(catalogId: string, light?: FixtureLight): ResolvedFixtureLight | null {
  const base = Object.hasOwn(FIXTURE_PHOTOMETRY, catalogId) ? FIXTURE_PHOTOMETRY[catalogId] : undefined;
  if (!base) return null;
  return {
    lumens: finite(light?.lumens) ? Math.max(0, light.lumens) : base.lumens,
    colorTemperature: clamp(finite(light?.colorTemperature) ? light.colorTemperature : base.colorTemperature, 1000, 10000),
    dim: finite(light?.dim) ? clamp(light.dim, 0, 1) : 1,
    tilt: finite(light?.tilt) ? clamp(light.tilt, 0, 90) : 0,
    beamAngle: finite(light?.beamAngle) ? clamp(light.beamAngle, MIN_BEAM_ANGLE, MAX_BEAM_ANGLE) : undefined,
  };
}

/** three's spot cone half angle (radians) whose falloff is at half intensity at `beamAngle / 2`. */
export function spotConeAngle(beamAngle: number, penumbra = SPOT_PENUMBRA): number {
  const half = clamp(beamAngle, MIN_BEAM_ANGLE, MAX_BEAM_ANGLE) * Math.PI / 360;
  // three: smoothstep(cos(angle), cos(angle·(1 − penumbra)), cos θ) is 0.5 midway between the two cosines.
  const halfCos = (angle: number) => (Math.cos(angle) + Math.cos(angle * (1 - penumbra))) / 2;
  let lo = half, hi = Math.PI / 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (halfCos(mid) > Math.cos(half)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Solid angle (sr) of three's spot falloff over the cone: lumens / this = peak candela. */
export function spotSolidAngle(angle: number, penumbra = SPOT_PENUMBRA): number {
  const outer = Math.cos(angle), inner = Math.cos(angle * (1 - penumbra));
  const falloff = (cos: number) => {
    if (inner <= outer) return cos >= outer ? 1 : 0;
    const t = clamp((cos - outer) / (inner - outer), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const steps = 256;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const theta = (i + 0.5) * angle / steps;
    sum += falloff(Math.cos(theta)) * Math.sin(theta);
  }
  return 2 * Math.PI * sum * angle / steps;
}

/** three intensity for a luminous intensity in candela, in this cm scene. */
export function sceneIntensity(candela: number): number {
  return candela * SCENE_IRRADIANCE_PER_LUX * CM_PER_M * CM_PER_M;
}

/** Where a light of `candela` falls below CUTOFF_LUX, cm. */
function cutoffDistance(candela: number): number {
  return clamp(Math.sqrt(candela / CUTOFF_LUX) * CM_PER_M, 200, 3000);
}

/** sRGB colour of a black body at `kelvin` (Tanner Helland's fit), 0..1 per channel. */
function kelvinToSRGB(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [r, g, b].map(v => clamp(v, 0, 255) / 255) as [number, number, number];
}

/**
 * A light's colour for a colour temperature, white-balanced to WHITE_POINT (3000 K renders
 * white, 2700 K warm, 4000 K and 6500 K cool) with its brightest channel 1, and the factor that
 * brings its luminance back to 1 so lumens stay lumens whatever the colour.
 */
export function colorTemperatureColor(kelvin: number): { color: THREE.Color; luminanceScale: number } {
  const source = kelvinToSRGB(kelvin), white = kelvinToSRGB(WHITE_POINT);
  const balanced = source.map((v, i) => v / white[i]);
  const max = Math.max(...balanced);
  const color = new THREE.Color().setRGB(balanced[0] / max, balanced[1] / max, balanced[2] / max, THREE.SRGBColorSpace);
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  return { color, luminanceScale: 1 / luminance };
}

/** What a fixture light stores for the viewer: its intensity at full adaptation and the lumens it emits. */
export interface FixtureLightData { fixtureIntensity: number; fixtureLumens: number }

/**
 * A fixture's lights in its own box (see FixtureEmitter), or null when it is off or not a
 * fixture. Spots aim along their `aim`, tilted by `tilt` towards the item's front (+z), so
 * the item's rotation turns a wall-washer with it. Each light's `userData` holds
 * FixtureLightData for `applyFixtureAdaptation` and `limitFixtureShadows`; none casts a
 * shadow until `limitFixtureShadows` picks it.
 */
export function createFixtureLights(catalogId: string, box: Box, light?: FixtureLight): THREE.Group | null {
  const settings = resolveFixtureLight(catalogId, light);
  if (!settings || settings.dim <= 0 || settings.lumens <= 0) return null;
  const { color, luminanceScale } = colorTemperatureColor(settings.colorTemperature);
  const group = new THREE.Group();
  group.name = 'fixture_lights';
  const tilt = settings.tilt * Math.PI / 180;
  for (const emitter of FIXTURE_PHOTOMETRY[catalogId].emitters) {
    const lumens = settings.lumens * settings.dim * emitter.share;
    let source: THREE.PointLight | THREE.SpotLight, candela: number;
    if (emitter.kind === 'spot') {
      const angle = spotConeAngle(settings.beamAngle ?? emitter.beamAngle ?? 60);
      candela = lumens / spotSolidAngle(angle);
      const spot = new THREE.SpotLight(color, 0, cutoffDistance(candela), angle, SPOT_PENUMBRA, 2);
      const up = emitter.aim === 'up' ? 1 : -1;
      spot.target.position.set(0, up * 100 * Math.cos(tilt), 100 * Math.sin(tilt));
      source = spot;
    } else {
      candela = lumens / (4 * Math.PI);
      source = new THREE.PointLight(color, 0, cutoffDistance(candela), 2);
    }
    source.intensity = sceneIntensity(candela) * luminanceScale;
    source.castShadow = false;
    source.userData = { fixtureIntensity: source.intensity, fixtureLumens: lumens } satisfies FixtureLightData;
    const [x, y, z] = emitter.position(box);
    source.position.set(x, y, z);
    group.add(source);
    if (source instanceof THREE.SpotLight) {
      // The target follows the light, relative to it, in the fixture's frame.
      source.target.position.add(source.position);
      group.add(source.target);
    }
  }
  return group;
}

/** Glow (bulbs, lenses, diffusers) of a lit fixture: `emissiveIntensity` at full output. */
export const FIXTURE_GLOW_INTENSITY = 2.5;

/**
 * Light a fixture model's glow materials to match its settings, off when dimmed to 0.
 * `userData.fixtureGlow` is the material's share of FIXTURE_GLOW_INTENSITY (1 for bulbs
 * and diffusers, less for shades); `fixtureGlowTint` tints the glow by the material's colour.
 */
export function applyFixtureGlow(model: THREE.Object3D, catalogId: string, light?: FixtureLight) {
  const settings = resolveFixtureLight(catalogId, light);
  if (!settings) return;
  const { color } = colorTemperatureColor(settings.colorTemperature);
  const on = settings.lumens > 0 ? settings.dim : 0;
  model.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !finite(material.userData.fixtureGlow)) continue;
      material.emissive.copy(color);
      if (material.userData.fixtureGlowTint) material.emissive.multiply(material.color);
      material.emissiveIntensity = FIXTURE_GLOW_INTENSITY * material.userData.fixtureGlow * on;
    }
  });
}

function fixtureLights(root: THREE.Object3D): (THREE.PointLight | THREE.SpotLight)[] {
  const lights: (THREE.PointLight | THREE.SpotLight)[] = [];
  root.traverse(child => {
    if ((child instanceof THREE.PointLight || child instanceof THREE.SpotLight) && finite(child.userData.fixtureIntensity)) lights.push(child);
  });
  return lights;
}

/**
 * Scale every fixture light under `root` for the eye's adaptation: 1 at night, less in
 * daylight, where the same lamp makes less of a difference. Returns the lumens emitted
 * (at full adaptation) for `indirectIrradiance`.
 */
export function applyFixtureAdaptation(root: THREE.Object3D, adaptation: number): number {
  let lumens = 0;
  for (const light of fixtureLights(root)) {
    light.intensity = light.userData.fixtureIntensity * Math.max(0, adaptation);
    lumens += light.userData.fixtureLumens ?? 0;
  }
  return lumens;
}

/**
 * Let the brightest fixture lights cast shadows, so walls stop their light: at most `max`,
 * of them at most MAX_POINT_SHADOWS point lights. Returns how many cast shadows.
 */
export function limitFixtureShadows(root: THREE.Object3D, max = MAX_FIXTURE_SHADOWS): number {
  const lights = fixtureLights(root).sort((a, b) => b.userData.fixtureLumens - a.userData.fixtureLumens);
  let count = 0, points = 0;
  for (const light of lights) {
    const isPoint = light instanceof THREE.PointLight;
    const cast = count < max && (!isPoint || points < MAX_POINT_SHADOWS);
    light.castShadow = cast;
    if (!cast) continue;
    count++;
    if (isPoint) points++;
    // A point light renders its map six times: keep those smaller.
    const size = isPoint ? 512 : 1024;
    light.shadow.mapSize.set(size, size);
    light.shadow.bias = -0.002;
    light.shadow.normalBias = 0.5;
    light.shadow.camera.near = 2;
    light.shadow.camera.far = light.distance;
    light.shadow.camera.updateProjectionMatrix();
  }
  return count;
}

/** Interior surface of a room (floor, ceiling, walls) in m², from its plan polygon in cm and its ceiling height in cm. */
export function roomSurfaceArea(polygon: { x: number; y: number }[], height: number): number {
  let area = 0, perimeter = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    area += a.x * b.y - b.x * a.y;
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return (2 * Math.abs(area) / 2 + perimeter * height) / (CM_PER_M * CM_PER_M);
}

/** Reflectance of a typical living space's surfaces, averaged. */
const MEAN_REFLECTANCE = 0.5;

/**
 * Scene irradiance of inter-reflected light: the room-average indirect illuminance
 * Φ·ρ / (A·(1 − ρ)) of `lumens` over `surfaceArea` m² of interior surface, which the
 * scene (direct light only) lacks. Zero without surfaces.
 */
export function indirectIrradiance(lumens: number, surfaceArea: number): number {
  if (!(surfaceArea > 0) || !(lumens > 0)) return 0;
  const lux = lumens * MEAN_REFLECTANCE / (surfaceArea * (1 - MEAN_REFLECTANCE));
  return lux * SCENE_IRRADIANCE_PER_LUX;
}

/** Daylight (summed scene irradiance of sun, sky and fills) below which the eye is fully dark-adapted: lamps count fully. */
const DARK_ADAPTED_DAYLIGHT = 0.2;
/** Least share of a lamp's light in the brightest daylight. */
const MIN_ADAPTATION = 0.15;

/**
 * How much the fixture lights count against `daylight`, the viewer's summed daylight
 * irradiance: 1 at night, falling with the square root of daylight (the eye adapts to
 * the brighter scene, so the same lamp makes less difference), never below MIN_ADAPTATION.
 */
export function fixtureAdaptation(daylight: number): number {
  if (!(daylight > DARK_ADAPTED_DAYLIGHT)) return 1;
  return Math.max(MIN_ADAPTATION, Math.sqrt(DARK_ADAPTED_DAYLIGHT / daylight));
}
