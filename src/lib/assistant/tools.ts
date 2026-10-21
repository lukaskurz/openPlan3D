/**
 * Runs one of the Assistant's tools in the browser: plan edits, the drawing
 * tools, the 3D view, design guides and the project brief.
 */
import { isDrawingTool, runDrawingTool } from './drawings';
import { runPlanTool, type ToolOutcome } from './planTools';
import { runView3d } from './view3d';
import { updateBrief } from './brief';
import { readSkill } from './skills';

export async function runAssistantTool(name: string, input: unknown): Promise<ToolOutcome> {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (isDrawingTool(name)) return runDrawingTool(name, input);
  if (name === 'view_3d') return runView3d(args);
  if (name === 'read_skill') return readSkill(args);
  if (name === 'update_brief') return updateBrief(args);
  return runPlanTool(name, input);
}
