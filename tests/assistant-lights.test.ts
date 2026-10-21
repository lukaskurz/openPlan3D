import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, createDefaultProject } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';

const floor = () => get(currentProject)!.floors[0];
const item = (id: string) => floor().furniture.find(f => f.id === id)!;
const plan = () => runPlanTool('get_plan', {}).text;
const place = (items: Record<string, unknown>[]) => runPlanTool('place_furniture', { items });
const update = (updates: Record<string, unknown>[]) => runPlanTool('update_elements', { updates });

beforeEach(() => {
  loadProject(createDefaultProject('Lights'));
  runPlanTool('add_walls', { points: [[0, 0], [500, 0], [500, 400], [0, 400]], closed: true });
});

describe('fixture lights', () => {
  it('shows what each fixture gives, from the catalog until it has its own settings', () => {
    expect(runPlanTool('search_catalog', { query: 'pendant' }).text).toMatch(/pendant_light: .*light 800 lm, 2700 K, beam 100°/);
    const [pendant, lamp, sofa] = place([
      { catalogId: 'pendant_light', x: 250, y: 200 },
      { catalogId: 'table_lamp', x: 100, y: 100 },
      { catalogId: 'sofa', x: 250, y: 330 },
    ]).changed!;
    const text = plan();
    expect(text).toMatch(new RegExp(`${pendant} .*, light 800 lm, 2700 K, beam 100°$`, 'm'));
    // A table lamp shines all round: no beam.
    expect(text).toMatch(new RegExp(`${lamp} .*, light 400 lm, 2700 K$`, 'm'));
    expect(text).not.toMatch(new RegExp(`${sofa} .*light`));
  });

  it('places a fixture with its own output and marks what it set', () => {
    const result = place([{ catalogId: 'recessed_light', x: 120, y: 120, light: { lumens: 600, colorTemperature: 3000, beamAngle: 24, tilt: 20, dim: 0.6 } }]);
    expect(result.isError).toBeFalsy();
    const id = result.changed![0];
    expect(item(id).light).toEqual({ lumens: 600, colorTemperature: 3000, beamAngle: 24, tilt: 20, dim: 0.6 });
    expect(result.text).toContain('light 600 lm, 3000 K, beam 24°, tilt 20°, dimmed to 60% (set: lumens, colorTemperature, beamAngle, tilt, dim)');
    expect(plan()).toContain(`${id} recessed_light`);
  });

  it('changes and clears settings field by field or all at once', () => {
    const [pendant] = place([{ catalogId: 'pendant_light', x: 250, y: 200, light: { lumens: 1200, dim: 0.5 } }]).changed!;
    expect(update([{ id: pendant, light: { colorTemperature: 2200, dim: null } }]).isError).toBeFalsy();
    expect(item(pendant).light).toEqual({ lumens: 1200, colorTemperature: 2200 });
    expect(update([{ id: pendant, light: null }]).isError).toBeFalsy();
    expect(item(pendant).light).toBeUndefined();
    expect(plan()).toMatch(new RegExp(`${pendant} .*, light 800 lm, 2700 K, beam 100°$`, 'm'));
  });

  it('rejects light settings that do not apply or are out of range', () => {
    const [lamp, sofa] = place([{ catalogId: 'table_lamp', x: 100, y: 100 }, { catalogId: 'sofa', x: 250, y: 330 }]).changed!;
    expect(update([{ id: sofa, light: { lumens: 500 } }]).text).toMatch(/sofa gives no light/);
    expect(update([{ id: lamp, light: { beamAngle: 30 } }]).text).toMatch(/shines all round, so it has no beamAngle/);
    expect(update([{ id: lamp, light: { dim: 60 } }]).text).toMatch(/light\.dim must be a number between 0 and 1/);
    expect(update([{ id: lamp, light: { kelvin: 3000 } }]).text).toMatch(/light takes .*, not kelvin/);
    expect(update([{ id: lamp, light: 'warm' }]).text).toMatch(/light must be an object/);
    expect(place([{ catalogId: 'recessed_light', x: 120, y: 120, light: { beamAngle: 200 } }]).text).toMatch(/light\.beamAngle must be a number between 5 and 140/);
    expect(item(lamp).light).toBeUndefined();
  });
});
