import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, createDefaultProject } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import { buildMessagesRequest } from '$lib/assistant/request';
import { ASSISTANT_SYSTEM_PROMPT, READ_ONLY_TOOLS } from '$lib/assistant/definitions';
import { REVIEWER_MODEL, REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOL_NAMES, reviewBrief, reviewEnabled, runReview } from '$lib/assistant/reviewer';
import { handleAssistantChat, resetChatLimits } from '$lib/server/assistantChat';
import { assistant, newConversation, send } from '$lib/assistant/session';

const floor = () => get(currentProject)!.floors[0];

function sse(events: unknown[]): string {
  return events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function reply(blocks: ({ text: string } | { tool: string; input: unknown; id: string })[]) {
  const stop = blocks.some(b => 'tool' in b) ? 'tool_use' : 'end_turn';
  const events: unknown[] = [{ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }];
  blocks.forEach((block, index) => {
    if ('text' in block) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.tool, input: {} } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 20 } }, { type: 'message_stop' });
  return new Response(sse(events), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('reviewer definition', () => {
  it('only gets read-only tools that leave the view alone', () => {
    expect(REVIEWER_TOOL_NAMES.has('get_plan')).toBe(true);
    expect(REVIEWER_TOOL_NAMES.has('check_plan')).toBe(true);
    for (const name of REVIEWER_TOOL_NAMES) expect(READ_ONLY_TOOLS.has(name)).toBe(true);
    for (const name of ['place_furniture', 'delete_elements', 'switch_floor', 'make_tool', 'review_proposal']) expect(REVIEWER_TOOL_NAMES.has(name)).toBe(false);
  });

  it('builds the reviewer request with its own model, prompt and tools', () => {
    const request = buildMessagesRequest([{ role: 'user', content: [{ type: 'text', text: 'Review this.' }] }], 'reviewer');
    expect(request.model).toBe(REVIEWER_MODEL.model);
    expect(request.output_config).toEqual({ effort: REVIEWER_MODEL.effort });
    expect(request.system[0].text).toBe(REVIEWER_SYSTEM_PROMPT);
    expect(request.tools.map(tool => tool.name).sort()).toEqual([...REVIEWER_TOOL_NAMES].sort());
    expect(request.tools.at(-1)).toHaveProperty('cache_control');
    // The Assistant's own request is unchanged and offers the review tool.
    const main = buildMessagesRequest([{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }]);
    expect(main.system[0].text).toBe(ASSISTANT_SYSTEM_PROMPT);
    expect(main.tools.some(tool => tool.name === 'review_proposal')).toBe(true);
  });

  it('writes a brief with the request, the summary and the changed ids', () => {
    const brief = reviewBrief({ summary: 'Placed a bed and two nightstands.', focus: 'walkways' }, { personSaid: 'Furnish the bedroom', changed: ['f1', 'f2'], removed: ['f0'] });
    expect(brief).toContain('The person asked: Furnish the bedroom');
    expect(brief).toContain('Placed a bed');
    expect(brief).toContain('Check especially: walkways');
    expect(brief).toContain('f1, f2');
    expect(brief).toContain('Removed: f0');
  });
});

describe('reviewer loop', () => {
  const turn = (content: any[], stopReason: string) => Promise.resolve({ content, stopReason });

  it('runs its tools and returns its findings', async () => {
    const runTool = vi.fn(() => ({ text: 'Project "x"' }));
    const call = vi.fn()
      .mockReturnValueOnce(turn([{ type: 'tool_use', id: 'r1', name: 'get_plan', input: {} }], 'tool_use'))
      .mockReturnValueOnce(turn([{ type: 'text', text: '1. The bed f1 blocks the door d1: move it to 200, 150.' }], 'end_turn'));
    const findings = await runReview('brief', { call, runTool });
    expect(findings).toContain('blocks the door');
    expect(runTool).toHaveBeenCalledWith('get_plan', {});
    expect(call.mock.calls[1][0][2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'r1', content: 'Project "x"' });
  });

  it('refuses editing tools and never fails the Assistant’s turn', async () => {
    const runTool = vi.fn(() => ({ text: 'ok' }));
    const call = vi.fn()
      .mockReturnValueOnce(turn([{ type: 'tool_use', id: 'r1', name: 'delete_elements', input: { ids: ['w1'] } }], 'tool_use'))
      .mockRejectedValueOnce(new Error('network down'));
    const findings = await runReview('brief', { call, runTool });
    expect(runTool).not.toHaveBeenCalled();
    expect(call.mock.calls[1][0].at(-1).content[0]).toMatchObject({ is_error: true });
    expect(findings).toMatch(/review failed \(network down\)/);
  });
});

describe('server', () => {
  beforeEach(resetChatLimits);
  const chat = (body: unknown) => new Request('http://local/api/assistant/chat', { method: 'POST', body: JSON.stringify(body) });
  const ok = vi.fn(async () => new Response('data: {}\n\n', { status: 200 }));

  it('sends reviewer conversations with the reviewer prompt', async () => {
    const response = await handleAssistantChat(chat({ agent: 'reviewer', messages: [{ role: 'user', content: [{ type: 'text', text: 'brief' }] }] }), { env: { ANTHROPIC_API_KEY: 'k' }, client: 'r', fetchImpl: ok as typeof fetch });
    expect(response.status).toBe(200);
    const sent = JSON.parse(String((ok.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body));
    expect(sent.system[0].text).toBe(REVIEWER_SYSTEM_PROMPT);
    expect(sent.model).toBe(REVIEWER_MODEL.model);
  });

  it('rejects unknown agents and editing tools in reviewer conversations', async () => {
    const unknown = await handleAssistantChat(chat({ agent: 'builder', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }), { env: { ANTHROPIC_API_KEY: 'k' }, client: 'r', fetchImpl: ok as typeof fetch });
    expect(unknown.status).toBe(400);
    const editing = await handleAssistantChat(chat({ agent: 'reviewer', messages: [
      { role: 'user', content: [{ type: 'text', text: 'brief' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'place_furniture', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] },
    ] }), { env: { ANTHROPIC_API_KEY: 'k' }, client: 'r', fetchImpl: ok as typeof fetch });
    expect(editing.status).toBe(400);
  });
});

describe('conversation with a review', () => {
  beforeEach(() => {
    loadProject(createDefaultProject('Review plan'));
    runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    newConversation();
    reviewEnabled.set(true);
  });

  /** Main and reviewer requests get separate scripts. */
  function script(main: Response[], reviewer: Response[]) {
    const bodies: { main: any[]; reviewer: any[] } = { main: [], reviewer: [] };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const queue = body.agent === 'reviewer' ? reviewer : main;
      (body.agent === 'reviewer' ? bodies.reviewer : bodies.main).push(body);
      return queue.shift() ?? new Response(JSON.stringify({ error: 'no more' }), { status: 500 });
    }));
    return bodies;
  }

  it('hands the proposal to the reviewer and its findings back to the Assistant', async () => {
    const bodies = script([
      reply([{ tool: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }, id: 'a' }]),
      reply([{ tool: 'review_proposal', input: { summary: 'Put a sofa against the top wall.' }, id: 'b' }]),
      reply([{ text: 'I put a sofa against the top wall.' }]),
    ], [
      reply([{ tool: 'get_plan', input: {}, id: 'r1' }]),
      reply([{ text: 'No problems found. The sofa sits against the wall with room in front.' }]),
    ]);
    await send('Add a sofa');
    expect(bodies.reviewer).toHaveLength(2);
    const brief = bodies.reviewer[0].messages[0].content[0].text;
    expect(brief).toContain('The person asked: Add a sofa');
    expect(brief).toContain(floor().furniture[0].id);
    // The reviewer read the plan as proposed, with the new sofa.
    expect(bodies.reviewer[1].messages[2].content[0].content).toContain('"Living"');
    expect(bodies.reviewer[0].conversation).toMatch(/-review-1$/);
    const result = bodies.main[2].messages.at(-1).content[0];
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'b' });
    expect(result.content).toContain('No problems found');
    expect(get(assistant).items.map(item => item.kind)).toEqual(['user', 'assistant', 'proposal']);
  });

  it('skips the reviewer when reviews are switched off', async () => {
    reviewEnabled.set(false);
    const bodies = script([
      reply([{ tool: 'review_proposal', input: { summary: 'Nothing yet.' }, id: 'b' }]),
      reply([{ text: 'Done.' }]),
    ], []);
    await send('Check it');
    expect(bodies.reviewer).toHaveLength(0);
    expect(bodies.main[1].messages.at(-1).content[0].content).toMatch(/switched off/);
  });

  const fourItems = { items: [
    { catalogId: 'sofa', x: 250, y: 60 }, { catalogId: 'sofa', x: 250, y: 340, rotation: 180 },
    { catalogId: 'sofa', x: 60, y: 200, rotation: 270 }, { catalogId: 'sofa', x: 440, y: 200, rotation: 90 },
  ] };

  it('reviews a bigger proposal on its own when the Assistant finishes without asking', async () => {
    const bodies = script([
      reply([{ tool: 'place_furniture', input: fourItems, id: 'a' }]),
      reply([{ text: 'I put four sofas in.' }]),
      reply([{ text: 'I put four sofas in and moved one off the door.' }]),
    ], [reply([{ text: '1. One sofa blocks the walkway.' }])]);
    await send('Fill the room with sofas');
    expect(bodies.reviewer).toHaveLength(1);
    expect(bodies.reviewer[0].messages[0].content[0].text).toContain('I put four sofas in.');
    expect(bodies.main[2].messages.at(-1).content[0].text).toMatch(/second designer reviewed[\s\S]*blocks the walkway/);
    // The answer after fixing replaces the first one.
    expect(get(assistant).items.filter(item => item.kind === 'assistant')).toMatchObject([{ text: 'I put four sofas in and moved one off the door.' }]);
  });

  it('keeps the first answer when the automatic review finds nothing', async () => {
    const bodies = script([
      reply([{ tool: 'place_furniture', input: fourItems, id: 'a' }]),
      reply([{ text: 'I put four sofas in.' }]),
    ], [reply([{ text: 'No problems found. All sofas have room.' }])]);
    await send('Fill the room with sofas');
    expect(bodies.reviewer).toHaveLength(1);
    expect(bodies.main).toHaveLength(2);
    expect(get(assistant).items.find(item => item.kind === 'assistant')).toMatchObject({ text: 'I put four sofas in.' });
  });

  it('does not review small edits on its own', async () => {
    const bodies = script([
      reply([{ tool: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }, id: 'a' }]),
      reply([{ text: 'Done.' }]),
    ], []);
    await send('Add a sofa');
    expect(bodies.reviewer).toHaveLength(0);
  });

  it('allows two reviews per message', async () => {
    const review = (id: string) => reply([{ tool: 'review_proposal', input: { summary: 'Again.' }, id }]);
    const bodies = script([review('a'), review('b'), review('c'), reply([{ text: 'Done.' }])], [
      reply([{ text: 'Move the sofa.' }]),
      reply([{ text: 'No problems found.' }]),
    ]);
    await send('Do it');
    expect(bodies.reviewer).toHaveLength(2);
    expect(bodies.main[3].messages.at(-1).content[0].content).toMatch(/reviewed already/);
  });
});
