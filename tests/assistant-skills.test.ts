import { describe, expect, it } from 'vitest';
import { ASSISTANT_SKILLS, SKILL_INDEX, SKILL_NAMES, readSkill } from '$lib/assistant/skills';
import { ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS } from '$lib/assistant/definitions';

const GUIDES = ['accessibility', 'bathroom', 'electrical', 'furnishing', 'kitchen', 'lighting', 'plumbing', 'rebuild-drawing'];

describe('assistant design guides', () => {
  it('parses every guide with a name, a description and a body', () => {
    expect(ASSISTANT_SKILLS.length).toBeGreaterThanOrEqual(GUIDES.length);
    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(skill.description.length).toBeGreaterThan(40);
      expect(skill.body.length).toBeGreaterThan(200);
      expect(skill.body.startsWith('---')).toBe(false);
    }
  });

  it('includes the expected guides, sorted, with unique names', () => {
    for (const name of GUIDES) expect(SKILL_NAMES).toContain(name);
    expect(new Set(SKILL_NAMES).size).toBe(SKILL_NAMES.length);
    expect([...SKILL_NAMES]).toEqual([...SKILL_NAMES].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps each description to one short line', () => {
    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.description).not.toMatch(/\n/);
      expect(skill.description.length).toBeLessThan(300);
    }
    expect(SKILL_INDEX.split('\n')).toHaveLength(ASSISTANT_SKILLS.length);
  });

  it('readSkill returns the body, and an error for an unknown name', () => {
    for (const skill of ASSISTANT_SKILLS) {
      const result = readSkill({ name: skill.name });
      expect(result.isError).toBeFalsy();
      expect(result.text).toBe(skill.body);
    }
    expect(readSkill({ name: ' Lighting ' }).text).toBe(ASSISTANT_SKILLS.find(s => s.name === 'lighting')!.body);
    const missing = readSkill({ name: 'astrology' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toMatch(/no guide astrology/);
    expect(readSkill({}).isError).toBe(true);
  });

  it('lists every guide in the system prompt and the read_skill enum', () => {
    const readTool = ASSISTANT_TOOLS.find(tool => tool.name === 'read_skill')!;
    const names = ((readTool.input_schema.properties as Record<string, { enum: string[] }>).name).enum;
    for (const skill of ASSISTANT_SKILLS) {
      expect(ASSISTANT_SYSTEM_PROMPT).toContain(`${skill.name}: ${skill.description}`);
      expect(names).toContain(skill.name);
    }
  });

  it('refers only to catalog ids that exist', async () => {
    const { getCatalogItem } = await import('$lib/utils/furnitureCatalog');
    for (const skill of ASSISTANT_SKILLS) {
      for (const [, id] of skill.body.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
        if (!id.includes('_') && !getCatalogItem(id)) continue; // plain words in backticks
        expect(getCatalogItem(id), `${skill.name} mentions ${id}`).toBeDefined();
      }
    }
  });
});
