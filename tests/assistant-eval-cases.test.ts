/**
 * The test set's checks, without the model: each case's starting plan must
 * fail its checks, and a hand-made good answer must pass all of them. Covers
 * the trade, light, 3D-view and brief cases and the updated cases 8–10.
 */
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { currentProject } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import { updateBrief } from '$lib/assistant/brief';
import type { FurnitureItem } from '$lib/models/types';
import { CASES, type EvalCase, type EvalContext } from '../tooling/assistant-eval/cases';
import { KIND, activeFloorOf, bottomOf, project, setLight, topOf } from '../tooling/assistant-eval/helpers';
import type { ToolCallRecord } from '../tooling/assistant-eval/recorder';

function tool(name: string, input: unknown) {
  const outcome = runPlanTool(name, input);
  if (outcome.isError) throw new Error(`${name}: ${outcome.text}`);
  return outcome;
}
const put = (items: Record<string, unknown>[]) => tool('place_furniture', { items }).changed ?? [];
const floor = () => activeFloorOf(project());
const byId = (id: string) => floor().furniture.find(i => i.id === id)!;

/** Drop that puts the item's bottom `gap` cm above the item below it. */
function dropFor(catalogId: string, below: FurnitureItem, gap: number) {
  const [probe] = put([{ catalogId, x: below.position.x, y: below.position.y, drop: 0 }]);
  const item = byId(probe);
  const drop = Math.round(bottomOf(project(), floor(), item) - (topOf(project(), floor(), below) + gap));
  tool('delete_elements', { ids: [probe] });
  return drop;
}

const calls = (...list: [string, unknown][]): ToolCallRecord[] => list.map(([name, input], i) => ({ agent: 'assistant', call: i, id: `t${i}`, name, input }));

/** Hand-made good answers: the plan edits, plus the reply and tool calls the checks read. */
const GOOD: Record<string, () => { reply?: string; toolCalls?: ToolCallRecord[] }> = {
  'light-kitchen-dining-de': () => {
    const table = floor().furniture.find(KIND.diningTable)!;
    put([{ catalogId: 'pendant_light', x: table.position.x, y: table.position.y, drop: dropFor('pendant_light', table, 65) }]);
    put([620, 760, 900].map(x => ({ catalogId: 'recessed_light', x, y: 60 })));
    return { reply: 'Die Pendelleuchte hängt 65 cm über dem Tisch.' };
  },
  'electrical-kitchen': () => {
    put([
      { catalogId: 'sym_outlet_double', x: 650, y: 12, elevation: 110 },
      { catalogId: 'sym_outlet_double', x: 900, y: 12, elevation: 110 },
      { catalogId: 'sym_outlet', x: 592, y: 12, elevation: 30 },
      { catalogId: 'sym_outlet', x: 860, y: 12, elevation: 30 },
      { catalogId: 'sym_switch', x: 715, y: 290, elevation: 105 },
    ]);
    return {};
  },
  'bathroom-de': () => {
    put([
      { catalogId: 'shower', x: 945, y: 355 }, { catalogId: 'sink_b', x: 830, y: 330 }, { catalogId: 'toilet', x: 955, y: 505, rotation: 90 },
      { catalogId: 'washer_dryer', x: 800, y: 510 }, { catalogId: 'ceiling_light', x: 875, y: 425 },
      { catalogId: 'wall_sconce', x: 830, y: 310, elevation: 180 }, { catalogId: 'sym_outlet', x: 770, y: 310, elevation: 115 },
    ]);
    return { reply: 'Das Bad ist geplant.' };
  },
  'light-dining-pendant': () => {
    const table = floor().furniture.find(KIND.diningTable)!;
    const drop = dropFor('pendant_light', table, 65);
    for (const id of put([-30, 30].map(dx => ({ catalogId: 'pendant_light', x: table.position.x + dx, y: table.position.y, drop })))) setLight(id, { dim: 0.5 });
    return {};
  },
  'light-living-layers': () => {
    put([
      { catalogId: 'ceiling_light', x: 275, y: 225 },
      { catalogId: 'wall_sconce', x: 12, y: 100, elevation: 180 },
      { catalogId: 'floor_lamp', x: 335, y: 405 },
    ]);
    return {};
  },
  'spots-kitchen-worktop': () => {
    for (const id of put([620, 760, 900].map(x => ({ catalogId: 'recessed_light', x, y: 60 })))) setLight(id, { colorTemperature: 4000, beamAngle: 36 });
    return {};
  },
  'electrical-switches': () => {
    const lamps = floor().furniture.filter(i => i.catalogId === 'ceiling_light');
    const [living, bed] = put([
      { catalogId: 'sym_switch', x: 540, y: 440, elevation: 105 },
      { catalogId: 'sym_switch', x: 540, y: 665, elevation: 105 },
      { catalogId: 'sym_outlet', x: 180, y: 740, elevation: 30 },
      { catalogId: 'sym_outlet', x: 370, y: 740, elevation: 30 },
    ]);
    tool('link_switch', { switchId: living, targetIds: [lamps.find(l => l.position.y < 450)!.id] });
    tool('link_switch', { switchId: bed, targetIds: [lamps.find(l => l.position.y > 450)!.id] });
    return {};
  },
  'plumbing-bathroom': () => {
    tool('add_pipes', { items: [
      { kind: 'waste', points: [[762, 538]], riser: true, run: 'wall' },
      { kind: 'cold', points: [[765, 540], [765, 318], [905, 318]], run: 'wall' },
      { kind: 'hot', points: [[770, 540], [770, 322], [905, 322]], run: 'wall' },
      { kind: 'waste', points: [[762, 538], [945, 355]], run: 'floor' },
      { kind: 'cold', points: [[765, 540], [765, 330], [810, 330]], run: 'wall' },
      { kind: 'hot', points: [[770, 540], [770, 335], [810, 335]], run: 'wall' },
      { kind: 'waste', points: [[762, 538], [830, 340]], run: 'floor' },
      { kind: 'cold', points: [[765, 545], [930, 545], [940, 530]], run: 'wall' },
      { kind: 'waste', points: [[762, 538], [945, 515]], run: 'floor', diameter: 100 },
    ] });
    return {};
  },
  'brief-remember': () => {
    const brief = updateBrief({ text: 'Keine Kücheninsel. Die Wand zwischen Küche und Wohnzimmer ist tragend und bleibt, wie sie ist.' });
    if (brief.isError) throw new Error(brief.text);
    put([{ catalogId: 'counter', x: 962, y: 190, rotation: 90 }]);
    return {};
  },
  'view3d-check': () => {
    const table = floor().furniture.find(KIND.diningTable)!;
    const pendant = floor().furniture.find(KIND.pendant)!;
    const raise = bottomOf(project(), floor(), pendant) - topOf(project(), floor(), table);
    tool('update_elements', { updates: [{ id: pendant.id, drop: Math.round((pendant.drop ?? 0) - (65 - raise)) }] });
    return { reply: 'Yes, at 40 cm above the table it hung too low; it now hangs 65 cm above it.', toolCalls: calls(['view_3d', { room: 'Living room' }]) };
  },
  'skill-bathroom-zones-de': () => {
    put([
      { catalogId: 'ceiling_light', x: 875, y: 425 },
      { catalogId: 'wall_sconce', x: 830, y: 310, elevation: 180 },
      { catalogId: 'sym_outlet', x: 770, y: 310, elevation: 115 },
    ]);
    return { reply: 'Im Schutzbereich 1 und 2 rund um die Dusche keine Steckdosen.', toolCalls: calls(['read_skill', { name: 'bathroom' }]) };
  },
};

/** Answers with one specific mistake, and the check that must catch it. */
const BAD: [id: string, catches: RegExp, answer: () => { reply?: string; toolCalls?: ToolCallRecord[] }][] = [
  ['electrical-switches', /living: switch linked/, () => {
    put([{ catalogId: 'sym_switch', x: 540, y: 440, elevation: 105 }]);
    return {};
  }],
  ['skill-bathroom-zones-de', /within 60 cm of the shower/, () => {
    put([{ catalogId: 'sym_outlet', x: 880, y: 310, elevation: 115 }]);
    return {};
  }],
  ['spots-kitchen-worktop', /neutral white/, () => {
    put([620, 760, 900].map(x => ({ catalogId: 'recessed_light', x, y: 60 })));
    return {};
  }],
  ['light-dining-pendant', /60–70 cm above/, () => {
    const table = floor().furniture.find(KIND.diningTable)!;
    const drop = dropFor('pendant_light', table, 40);
    for (const id of put([-30, 30].map(dx => ({ catalogId: 'pendant_light', x: table.position.x + dx, y: table.position.y, drop })))) setLight(id, { dim: 0.5 });
    return {};
  }],
  ['plumbing-bathroom', /WC has cold, waste/, () => {
    tool('add_pipes', { items: [{ kind: 'cold', points: [[765, 540], [765, 318], [905, 318]], run: 'wall' }] });
    return {};
  }],
  ['brief-remember', /no free-standing counter/, () => {
    updateBrief({ text: 'Keine Kücheninsel; die Wand zur Küche ist tragend.' });
    put([{ catalogId: 'counter', x: 750, y: 190 }]);
    return {};
  }],
];

function context(c: EvalCase, before: ReturnType<typeof project>, answer: { reply?: string; toolCalls?: ToolCallRecord[] }): EvalContext {
  const after = structuredClone(get(currentProject)!);
  return {
    before, after, beforeFloor: activeFloorOf(before), floor: activeFloorOf(after),
    reply: answer.reply ?? '', toolCalls: answer.toolCalls ?? [], madeTools: [], applied: true,
  };
}

const results = (c: EvalCase, ctx: EvalContext) => c.checks.flatMap(check => {
  try { return [check(ctx)].flat(); } catch (error) { return [{ name: 'check threw', pass: false, detail: String(error) }]; }
});

describe('assistant test set checks', () => {
  for (const id of Object.keys(GOOD)) {
    const c = CASES.find(x => x.id === id)!;
    it(`${id}: the starting plan fails and a good answer passes`, () => {
      expect(c, `case ${id}`).toBeDefined();
      c.setup();
      const before = structuredClone(get(currentProject)!);
      expect(results(c, context(c, before, {})).some(r => !r.pass)).toBe(true);
      const answer = GOOD[id]();
      const failed = results(c, context(c, before, answer)).filter(r => !r.pass);
      expect(failed, failed.map(r => `${r.name}: ${r.detail}`).join('\n')).toEqual([]);
    });
  }

  for (const [id, catches, answer] of BAD) {
    it(`${id}: catches a bad answer (${catches.source})`, () => {
      const c = CASES.find(x => x.id === id)!;
      c.setup();
      const before = structuredClone(get(currentProject)!);
      const failed = results(c, context(c, before, answer())).filter(r => !r.pass).map(r => r.name);
      expect(failed.some(name => catches.test(name)), failed.join('; ')).toBe(true);
    });
  }
});
