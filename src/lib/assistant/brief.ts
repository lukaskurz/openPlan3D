import type { ToolOutcome } from './planTools';

/** update_brief: replace the project brief (part of the proposal). */
export function updateBrief(_input: Record<string, unknown>): ToolOutcome {
  return { text: 'error: the project brief is not available yet.', isError: true };
}
