import { get } from 'svelte/store';
import { currentProject, updateProjectBrief } from '$lib/stores/project';
import type { ToolOutcome } from './planTools';

/** Longest brief the Assistant may store: short notes, not a transcript. */
export const BRIEF_MAX_LENGTH = 3000;
/** Not an element: outlines nothing on the plan, but makes a brief-only edit count as a proposal. */
export const BRIEF_CHANGE_ID = 'project-brief';

/** update_brief: replace the project brief (part of the proposal). */
export function updateBrief(input: Record<string, unknown>): ToolOutcome {
  if (!get(currentProject)) return { text: 'error: no project is open.', isError: true };
  if (typeof input.text !== 'string') return { text: 'error: text must be the whole new brief as a string.', isError: true };
  const text = input.text.trim();
  if (text.length > BRIEF_MAX_LENGTH) {
    return { text: `error: the brief is ${text.length} characters; keep it under ${BRIEF_MAX_LENGTH} by shortening or dropping notes that no longer matter.`, isError: true };
  }
  if ((get(currentProject)!.brief ?? '') === text) return { text: 'The brief already says that; nothing changed.' };
  updateProjectBrief(text);
  return { text: text ? 'Brief updated.' : 'Brief cleared.', changed: [BRIEF_CHANGE_ID] };
}

/** The brief as get_plan shows it, first thing in the readout; null without a project. */
export function projectBriefForPlan(): string | null {
  const project = get(currentProject);
  if (!project) return null;
  const brief = project.brief?.trim();
  return brief
    ? `Project brief:\n${brief}`
    : 'Project brief: (empty; add one with update_brief when the person tells you something that holds for the whole project)';
}
