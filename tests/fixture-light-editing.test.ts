import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import { FIXTURE_LIGHT_RANGES, type FixtureLight, type FurnitureItem } from '$lib/models/types';
import { currentProject, redo, undo, undoHistoryStore, updateFurniture } from '$lib/stores/project';
import { fixtureLightDefaults, fixtureLightRange, MAX_BEAM_ANGLE, MIN_BEAM_ANGLE, setFixtureLightField } from '$lib/utils/fixtureLights';
import { readProject } from '$lib/utils/projectValidation';
import { sceneSignature } from '$lib/utils/sceneSignature';
import { roomProject } from './fixtures/project';

const item = (catalogId: string, light?: FixtureLight): FurnitureItem =>
  ({ id: catalogId, catalogId, position: { x: 200, y: 150 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...(light ? { light } : {}) });
const lightOf = (id: string) => get(currentProject)!.floors[0].furniture.find(f => f.id === id)!.light;

it('gives editor defaults per fixture, with beam angle only where a spot emits', () => {
  expect(fixtureLightDefaults('sofa')).toBeNull();
  expect(fixtureLightDefaults('recessed_light')).toEqual({ lumens: 400, colorTemperature: 2700, dim: 1, tilt: 0, beamAngle: 38 });
  expect(fixtureLightDefaults('floor_lamp')?.beamAngle).toBe(120);
  expect(fixtureLightDefaults('table_lamp')?.beamAngle).toBeUndefined();
  expect(fixtureLightDefaults('chandelier')?.beamAngle).toBeUndefined();
});

it('clamps edited fields to what the project reader accepts and clears them back to the default', () => {
  expect(setFixtureLightField(undefined, 'lumens', -50)).toEqual({ lumens: 0 });
  expect(setFixtureLightField(undefined, 'lumens', 5e6)).toEqual({ lumens: 1_000_000 });
  expect(setFixtureLightField(undefined, 'colorTemperature', 200)).toEqual({ colorTemperature: 1000 });
  expect(setFixtureLightField(undefined, 'colorTemperature', 20000)).toEqual({ colorTemperature: 10000 });
  expect(setFixtureLightField(undefined, 'dim', 1.5)).toEqual({ dim: 1 });
  expect(setFixtureLightField(undefined, 'tilt', -10)).toEqual({ tilt: 0 });
  expect(setFixtureLightField(undefined, 'tilt', 120)).toEqual({ tilt: 90 });
  // Beam angles stay within both the reader's range and what three can render.
  expect(fixtureLightRange('beamAngle')).toEqual([MIN_BEAM_ANGLE, MAX_BEAM_ANGLE]);
  expect(setFixtureLightField(undefined, 'beamAngle', 2)).toEqual({ beamAngle: MIN_BEAM_ANGLE });
  expect(setFixtureLightField(undefined, 'beamAngle', 170)).toEqual({ beamAngle: MAX_BEAM_ANGLE });
  for (const key of Object.keys(FIXTURE_LIGHT_RANGES) as (keyof FixtureLight)[]) {
    const [min, max] = FIXTURE_LIGHT_RANGES[key];
    const [editMin, editMax] = fixtureLightRange(key);
    expect(editMin).toBeGreaterThanOrEqual(min);
    expect(editMax).toBeLessThanOrEqual(max);
  }

  const light = { lumens: 600, tilt: 30 };
  expect(setFixtureLightField(light, 'tilt', undefined)).toEqual({ lumens: 600 });
  expect(setFixtureLightField(light, 'tilt', NaN)).toEqual({ lumens: 600 });
  expect(light).toEqual({ lumens: 600, tilt: 30 });
  expect(setFixtureLightField({ dim: 0.5 }, 'dim', undefined)).toBeUndefined();
});

it('writes light edits through the store as undoable, readable steps that change the 3D scene', () => {
  const project = roomProject();
  project.floors[0].furniture = [item('recessed_light')];
  currentProject.set(project);
  const signature = () => sceneSignature(get(currentProject)!, get(currentProject)!.floors[0], false, 'metric');
  const before = signature();
  const steps = get(undoHistoryStore).entries.length;

  updateFurniture('recessed_light', { light: setFixtureLightField(lightOf('recessed_light'), 'tilt', 140) });
  expect(lightOf('recessed_light')).toEqual({ tilt: 90 });
  updateFurniture('recessed_light', { light: setFixtureLightField(lightOf('recessed_light'), 'lumens', 650) });
  expect(lightOf('recessed_light')).toEqual({ tilt: 90, lumens: 650 });
  expect(signature()).not.toBe(before);
  // Edits to one fixture's light coalesce into a single undo step, like typing into other fields.
  expect(get(undoHistoryStore).entries.length).toBe(steps + 1);
  expect(readProject(structuredClone(get(currentProject))).floors[0].furniture[0].light).toEqual({ tilt: 90, lumens: 650 });
  undo();
  expect(lightOf('recessed_light')).toBeUndefined();
  expect(signature()).toBe(before);
  redo();
  expect(lightOf('recessed_light')).toEqual({ tilt: 90, lumens: 650 });

  // Clearing every field drops the override.
  updateFurniture('recessed_light', { light: setFixtureLightField(lightOf('recessed_light'), 'tilt', undefined) });
  expect(lightOf('recessed_light')).toEqual({ lumens: 650 });
  updateFurniture('recessed_light', { light: setFixtureLightField(lightOf('recessed_light'), 'lumens', undefined) });
  expect(lightOf('recessed_light')).toBeUndefined();
  expect(signature()).toBe(before);
});
