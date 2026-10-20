/**
 * Design guides the Assistant reads on demand. Each guide is a markdown file
 * in this folder with a name and a one-line description in its front matter;
 * the prompt lists the descriptions and read_skill returns the whole guide.
 */

export interface AssistantSkill { name: string; description: string; body: string }

const files = import.meta.glob('./*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function parse(path: string, text: string): AssistantSkill {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw new Error(`Assistant skill ${path} has no front matter.`);
  const field = (key: string) => new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(match[1])?.[1].trim() ?? '';
  const name = field('name'), description = field('description');
  if (!name || !description) throw new Error(`Assistant skill ${path} needs a name and a description.`);
  return { name, description, body: match[2].trim() };
}

/** Sorted by name, so the prompt built from them never changes between requests. */
export const ASSISTANT_SKILLS: AssistantSkill[] = Object.entries(files)
  .map(([path, text]) => parse(path, text))
  .sort((a, b) => a.name.localeCompare(b.name));

export const SKILL_NAMES = ASSISTANT_SKILLS.map(skill => skill.name);

/** One line per guide, for the system prompt. */
export const SKILL_INDEX = ASSISTANT_SKILLS.map(skill => `  - ${skill.name}: ${skill.description}`).join('\n');

export function readSkill(input: Record<string, unknown>): { text: string; isError?: boolean } {
  const wanted = String(input.name ?? '').trim().toLowerCase();
  const skill = ASSISTANT_SKILLS.find(s => s.name === wanted);
  if (!skill) return { text: `error: there is no guide ${String(input.name)}. Guides: ${SKILL_NAMES.join(', ')}.`, isError: true };
  return { text: skill.body };
}
