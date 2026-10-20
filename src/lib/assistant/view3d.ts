import type { ToolOutcome } from './planTools';

/** view_3d: a picture of the active floor in 3D. */
export async function runView3d(_input: Record<string, unknown>): Promise<ToolOutcome> {
  return { text: 'error: the 3D view is not available yet.', isError: true };
}
