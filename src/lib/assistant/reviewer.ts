/**
 * The reviewer: a second designer the Assistant asks to look at its proposal
 * before it answers (the review_proposal tool). It runs its own short loop
 * with read-only tools against the plan as proposed, then replies with the
 * problems it found, which go back to the Assistant as the tool's result.
 * Shared by the browser (which runs the loop) and the server (which owns the
 * reviewer's prompt and tools).
 */
import { writable } from 'svelte/store';
import { ASSISTANT_TOOLS, READ_ONLY_TOOLS } from './definitions';

/** Agents the server runs besides the Assistant itself. */
export type AssistantAgent = 'reviewer';
export const ASSISTANT_AGENTS = new Set<AssistantAgent>(['reviewer']);

export const REVIEWER_MODEL = { model: 'claude-opus-5-5', maxTokens: 32000, effort: 'high' as const, maxRounds: 12 };
/** Reviews per message: one, and one more after fixing. */
export const MAX_REVIEWS = 2;
/** A proposal this big (elements added, changed or removed) gets reviewed even when the Assistant didn't ask. */
export const AUTO_REVIEW_MIN_CHANGES = 4;

/** Off for comparison runs of the test set (EVAL_REVIEW=off). */
export const reviewEnabled = writable(true);

/** Read-only tools, minus the ones that change what the person sees or are the Assistant's own. */
const NOT_FOR_REVIEWER = new Set(['switch_floor', 'make_tool', 'show_tool', 'review_proposal']);
export const REVIEWER_TOOLS = ASSISTANT_TOOLS.filter(tool => READ_ONLY_TOOLS.has(tool.name) && !NOT_FOR_REVIEWER.has(tool.name));
export const REVIEWER_TOOL_NAMES = new Set(REVIEWER_TOOLS.map(tool => tool.name));

export const REVIEWER_SYSTEM_PROMPT = `You review a design proposal in openPlan3D, a floor plan editor, before the person sees it. Another assistant made the changes; it asked you to check them with fresh eyes. You can look but not edit.

How to review:
- Start with get_plan. The proposal is already in the plan; the brief lists the ids that were added or changed. Coordinates are centimetres; x grows right, y grows down. Furniture x, y is the item centre. Rotation 0 means the back of the item is towards the top of the plan (smaller y) and its front faces down; 90 faces left, 180 faces up, 270 faces right.
- Check it against what the person asked: is all of it there, and did anything change that wasn't asked for?
- Check that it works: furniture inside its room and not through walls or other items; backs of beds, sofas, wardrobes and counters against walls; 60–90 cm walkways in front of beds, wardrobes and sofas and about 120 cm between kitchen runs (check_plan walkway helps); door swings clear; nothing tall in front of windows; every room reachable; sizes and heights plausible (switches about 105 cm, outlets about 30 cm, a pendant over a table about 60–70 cm above its top).
- Look at the plan with the view tools you have, and read the guides you have for the topic when they apply.
- Only report real problems, not taste, unless it goes against what the person asked for.

Reply with a short list, most important first, at most 8 points. Each point: what is wrong, the ids involved, and a concrete fix (for example move to x, y, rotate to 90, use a smaller item). If nothing needs fixing, reply "No problems found." and one sentence on what you checked. Don't restate the proposal. Write in English; the person never sees your reply.`;

export interface ReviewInput { request?: unknown; summary?: unknown; focus?: unknown }

const clip = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** The reviewer's first message: what the person asked, what changed, and what the Assistant says it did. */
export function reviewBrief(input: ReviewInput, context: { personSaid: string; changed: string[]; removed: string[] }): string {
  const lines = [`The person asked: ${clip(context.personSaid, 4000) || '(no text)'}`];
  const request = clip(input.request, 2000);
  if (request) lines.push(`The assistant's reading of the request: ${request}`);
  lines.push(`What the assistant says it did: ${clip(input.summary, 4000) || '(no summary)'}`);
  const focus = clip(input.focus, 1000);
  if (focus) lines.push(`Check especially: ${focus}`);
  lines.push(context.changed.length ? `Added or changed in this proposal: ${context.changed.slice(0, 300).join(', ')}` : 'Nothing in the plan has changed yet.');
  if (context.removed.length) lines.push(`Removed: ${context.removed.slice(0, 300).join(', ')}`);
  return lines.join('\n');
}

type Block = { type: string; [key: string]: unknown };
interface Message { role: 'user' | 'assistant'; content: Block[] }
interface Turn { content: Block[]; stopReason: string | null }
interface Outcome { text: string; isError?: boolean; image?: { mediaType: string; data: string } }

/**
 * Run the reviewer's loop and return its findings. Model calls and tools are
 * passed in (the browser streams calls and runs tools against the open plan).
 * A failed review never fails the Assistant's turn: it says so instead.
 */
export async function runReview(brief: string, { call, runTool, signal }: {
  call: (messages: Message[]) => Promise<Turn>;
  runTool: (name: string, input: unknown) => Outcome | Promise<Outcome>;
  signal?: AbortSignal;
}): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: [{ type: 'text', text: brief }] }];
  try {
    for (let round = 0; round < REVIEWER_MODEL.maxRounds; round++) {
      const turn = await call(messages);
      if (turn.stopReason === 'refusal') return 'The reviewer declined to review this change. Check it yourself before you answer.';
      messages.push({ role: 'assistant', content: turn.content });
      const uses = turn.content.filter(block => block.type === 'tool_use') as (Block & { id: string; name: string; input: unknown })[];
      const text = turn.content.filter(block => block.type === 'text').map(block => String(block.text)).join('\n').trim();
      if (!uses.length || turn.stopReason !== 'tool_use') return text || 'No problems found.';
      const results: Block[] = [];
      for (const use of uses) {
        const outcome = REVIEWER_TOOL_NAMES.has(use.name) ? await runTool(use.name, use.input) : { text: `${use.name} isn't available to the reviewer.`, isError: true };
        const content = outcome.image ? [{ type: 'text', text: outcome.text }, { type: 'image', source: { type: 'base64', media_type: outcome.image.mediaType, data: outcome.image.data } }] : outcome.text;
        results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(outcome.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
    return 'The reviewer ran out of steps before finishing. Check the proposal yourself before you answer.';
  } catch (error) {
    if (signal?.aborted) throw error;
    return `The review failed (${(error as Error)?.message ?? 'unknown error'}). Check the proposal yourself before you answer.`;
  }
}
