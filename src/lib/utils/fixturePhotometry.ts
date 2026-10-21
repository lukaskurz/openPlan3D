import { FIXTURE_LIGHT_RANGES, type FixtureLight } from '$lib/models/types';

/**
 * Light fixtures' photometry without three: default output by catalog id, and an item's
 * settings over those defaults. The 3D view turns them into lights (fixtureLights.ts); the
 * editor and the Assistant read and set them from here, so they don't load three.
 */

/** Narrowest and widest spot beam three's cone (half angle at most 90°) can show with SPOT_PENUMBRA, degrees. */
export const MIN_BEAM_ANGLE = 5;
export const MAX_BEAM_ANGLE = 140;

export type FixtureBox = { width: number; depth: number; height: number };

/** One light source of a fixture, in the fixture's own box (x, z centred, y from 0 at the bottom to `height`). */
export interface FixtureEmitter {
  /** 'spot' shines a cone along `aim`; 'point' all round. */
  kind: 'spot' | 'point';
  /** Share of the fixture's lumens. */
  share: number;
  aim?: 'down' | 'up';
  /** Spots: full beam angle at half intensity, degrees (the fixture's `beamAngle` overrides it). */
  beamAngle?: number;
  position: (box: FixtureBox) => [number, number, number];
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

/** A fixture's defaults for the editor: `resolveFixtureLight` without overrides, with the beam angle of its first spot (undefined for point-only fixtures, where beam angle and tilt do not apply). */
export function fixtureLightDefaults(catalogId: string): ResolvedFixtureLight | null {
  const base = resolveFixtureLight(catalogId);
  if (!base) return null;
  const spot = FIXTURE_PHOTOMETRY[catalogId].emitters.find(emitter => emitter.kind === 'spot');
  return { ...base, beamAngle: spot ? spot.beamAngle ?? 60 : undefined };
}

/** Editor range of a FixtureLight field: what the project reader accepts, beam angles narrowed to what renders. */
export function fixtureLightRange(key: keyof FixtureLight): [number, number] {
  const [min, max] = FIXTURE_LIGHT_RANGES[key];
  return key === 'beamAngle' ? [Math.max(min, MIN_BEAM_ANGLE), Math.min(max, MAX_BEAM_ANGLE)] : [min, max];
}

/** `light` with `key` set to `value` clamped to its range, or cleared back to the default when `value` is not a number. Undefined once no override is left. */
export function setFixtureLightField(light: FixtureLight | undefined, key: keyof FixtureLight, value: number | undefined): FixtureLight | undefined {
  const next: FixtureLight = { ...light };
  if (finite(value)) next[key] = clamp(value, ...fixtureLightRange(key));
  else delete next[key];
  return Object.keys(next).length ? next : undefined;
}
