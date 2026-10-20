import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  currentProject, loadProject, createDefaultProject, previewActive, beginPreview, commitPreview, discardPreview, undo, undoHistoryStore,
} from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import { applyStreamEvent, keptBlocks, streamTurn, type TurnResult } from '$lib/assistant/stream';
import { richText } from '$lib/assistant/richText';
import { handleAssistantChat, parseConversation, resetChatLimits } from '$lib/server/assistantChat';
import { ASSISTANT_MODEL, ASSISTANT_MODELS, assistantMode } from '$lib/assistant/definitions';
import { buildMessagesRequest } from '$lib/assistant/request';
import { gridStep } from '$lib/assistant/drawings';
import { assistant, send, applyProposal, discardProposal, newConversation } from '$lib/assistant/session';
import { previewHighlight } from '$lib/stores/planView';

const floor = () => get(currentProject)!.floors[0];
const fresh = () => loadProject(createDefaultProject('Assistant plan'));

function twoRooms() {
  fresh();
  runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
  runPlanTool('add_room', { name: 'Bedroom', x: 500, y: 0, width: 400, depth: 400 });
}

describe('plan tools', () => {
  beforeEach(fresh);

  it('adds named rooms and shares walls with neighbours', () => {
    const first = runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    expect(first.isError).toBeFalsy();
    expect(floor().walls).toHaveLength(4);
    const second = runPlanTool('add_room', { name: 'Bedroom', x: 500, y: 0, width: 400, depth: 400 });
    expect(second.text).toContain('Bedroom');
    expect(floor().walls).toHaveLength(7);
    const plan = runPlanTool('get_plan', {}).text;
    expect(plan).toContain('"Living" 20.0 m²');
    expect(plan).toContain('"Bedroom" 16.0 m²');
  });

  it('reports inside areas and rooms nobody can get into', () => {
    runPlanTool('add_walls', { points: [[0, 0], [500, 0], [500, 400], [0, 400]], closed: true, thickness: 20 });
    runPlanTool('add_walls', { points: [[300, 0], [300, 400]], thickness: 10 });
    let plan = runPlanTool('get_plan', {}).text;
    // 300 × 400 to wall centres; inside the walls (300 - 10 - 5) × (400 - 20).
    expect(plan).toContain('12.0 m² to wall centres, 10.83 m² inside the walls');
    expect(plan).toMatch(/No door or opening into: "[^"]+", "[^"]+"\./);
    const partition = floor().walls.find(w => w.start.x === 300 && w.end.x === 300)!;
    runPlanTool('add_openings', { items: [{ kind: 'door', wallId: partition.id, offset: 200, type: 'opening' }] });
    plan = runPlanTool('get_plan', {}).text;
    expect(plan).not.toContain('No door or opening');
  });

  it('only fills the uncovered part of a partly walled edge', () => {
    runPlanTool('add_walls', { points: [[0, 0], [200, 0]] });
    runPlanTool('add_room', { name: 'Hall', x: 0, y: 0, width: 400, depth: 200 });
    const top = floor().walls.filter(w => w.start.y === 0 && w.end.y === 0);
    expect(top.map(w => [w.start.x, w.end.x].sort((a, b) => a - b))).toEqual([[0, 200], [200, 400]]);
  });

  it('places furniture and reports overlaps, items outside rooms and blocked doors', () => {
    twoRooms();
    const wall = floor().walls.find(w => w.start.x === 0 && w.end.x === 500 && w.start.y === 400 || w.start.x === 500 && w.end.x === 0 && w.start.y === 400)!;
    const door = runPlanTool('add_openings', { items: [{ kind: 'door', wallId: wall.id, offset: 250 }] });
    expect(door.isError).toBeFalsy();
    const placed = runPlanTool('place_furniture', { items: [
      { catalogId: 'sofa', x: 250, y: 60, rotation: 0 },
      { catalogId: 'sofa', x: 260, y: 70, rotation: 0 },
      { catalogId: 'chair', x: 2000, y: 2000 },
      { catalogId: 'chair', x: 250, y: 360 },
      { catalogId: 'not_a_thing', x: 10, y: 10 },
    ] });
    expect(floor().furniture).toHaveLength(4);
    expect(placed.text).toMatch(/overlaps/);
    expect(placed.text).toMatch(/outside every room/);
    expect(placed.text).toMatch(/blocks door/);
    expect(placed.text).toMatch(/Unknown catalogId not_a_thing/);
    expect(placed.changed).toHaveLength(4);
  });

  it('accepts a clear placement without warnings', () => {
    twoRooms();
    const placed = runPlanTool('place_furniture', { items: [{ catalogId: 'bed_queen', x: 700, y: 85, rotation: 0 }] });
    expect(placed.text).not.toMatch(/warning/);
  });

  it('rejects openings that do not fit', () => {
    twoRooms();
    const wall = floor().walls[0];
    const result = runPlanTool('add_openings', { items: [{ kind: 'window', wallId: wall.id, offset: 10, width: 120 }] });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/doesn't fit/);
  });

  it('moves, renames and deletes elements', () => {
    twoRooms();
    const [id] = runPlanTool('place_furniture', { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }).changed!;
    runPlanTool('update_elements', { updates: [{ id, x: 240, rotation: 90 }] });
    expect(floor().furniture[0]).toMatchObject({ position: { x: 240, y: 60 }, rotation: 90 });
    const plan = runPlanTool('get_plan', {}).text;
    const bedroom = /- (\S+) "Bedroom"/.exec(plan)![1];
    runPlanTool('update_elements', { updates: [{ id: bedroom, name: 'Guest room' }] });
    expect(runPlanTool('get_plan', {}).text).toContain('"Guest room"');
    runPlanTool('delete_elements', { ids: [bedroom] });
    // The shared wall stays with the living room.
    expect(floor().walls).toHaveLength(4);
    expect(runPlanTool('get_plan', {}).text).not.toContain('Guest room');
  });

  it('shifts a wall and stretches the walls joined to it', () => {
    twoRooms();
    const shared = floor().walls.find(w => w.start.x === 500 && w.end.x === 500)!;
    runPlanTool('update_elements', { updates: [{ id: shared.id, dx: 50 }] });
    const after = floor();
    expect(after.walls.find(w => w.id === shared.id)).toMatchObject({ start: { x: 550 }, end: { x: 550 } });
    const corners = after.walls.flatMap(w => [w.start, w.end]).filter(p => p.x === 500);
    expect(corners).toHaveLength(0);
    expect(runPlanTool('get_plan', {}).text).toContain('"Living" 22.0 m²');
  });

  it('searches the catalog and reports unknown tools and bad input', () => {
    expect(runPlanTool('search_catalog', { query: 'sofa' }).text).toContain('sofa:');
    expect(runPlanTool('nope', {}).isError).toBe(true);
    expect(runPlanTool('add_room', { name: 'X', x: 'a', y: 0, width: 10, depth: 10 }).isError).toBe(true);
  });
});

describe('previews', () => {
  beforeEach(fresh);

  it('commits a preview as one undo step', () => {
    const before = undoHistoryStore;
    const entries = get(before).entries.length;
    beginPreview();
    expect(get(previewActive)).toBe(true);
    runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    runPlanTool('place_furniture', { items: [{ catalogId: 'sofa', x: 250, y: 60 }] });
    commitPreview('Assistant: test');
    expect(get(previewActive)).toBe(false);
    expect(get(undoHistoryStore).entries).toHaveLength(entries + 1);
    undo();
    expect(floor().walls).toHaveLength(0);
    expect(floor().furniture).toHaveLength(0);
  });

  it('discards a preview, and undo during a preview discards it', () => {
    runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    const snapshot = JSON.stringify(floor());
    beginPreview();
    runPlanTool('place_furniture', { items: [{ catalogId: 'sofa', x: 250, y: 60 }] });
    discardPreview();
    expect(JSON.stringify(floor())).toBe(snapshot);
    beginPreview();
    runPlanTool('place_furniture', { items: [{ catalogId: 'sofa', x: 250, y: 60 }] });
    undo();
    expect(get(previewActive)).toBe(false);
    expect(JSON.stringify(floor())).toBe(snapshot);
  });
});

// ── Streaming ───────────────────────────────────────────────────────

function sse(events: unknown[]): string {
  return events.map(event => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join('');
}

function reply(blocks: ({ text: string } | { tool: string; input: unknown; id: string })[], stop = blocks.some(b => 'tool' in b) ? 'tool_use' : 'end_turn') {
  const events: unknown[] = [{ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } }];
  blocks.forEach((block, index) => {
    if ('text' in block) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const piece of block.text.match(/.{1,7}/gs) ?? []) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.tool, input: {} } });
      const json = JSON.stringify(block.input);
      for (let i = 0; i < json.length; i += 9) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 9) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 20 } }, { type: 'message_stop' });
  return sse(events);
}

/** A response body delivered in awkward chunk sizes. */
function chunked(text: string, size = 13): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('drawing tools', () => {
  it('picks round grid steps for about 6–12 lines', () => {
    expect(gridStep(1000)).toBe(100);
    expect(gridStep(600)).toBe(50);
    expect(gridStep(250)).toBe(25);
    expect(gridStep(0.2, [1, 2, 5])).toBe(0.02);
    expect(gridStep(1, [1, 2, 5])).toBe(0.1);
  });
});

describe('stream', () => {
  it('assembles text and tool calls from split chunks', async () => {
    const text: string[] = [];
    const result = await streamTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      fetchImpl: async () => chunked(reply([{ text: 'Looking at the plan.' }, { tool: 'get_plan', input: {}, id: 't1' }, { tool: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 1, y: 2 }] }, id: 't2' }])),
      onText: piece => text.push(piece),
    });
    expect(text.join('')).toBe('Looking at the plan.');
    expect(result.stopReason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'text', text: 'Looking at the plan.' },
      { type: 'tool_use', id: 't1', name: 'get_plan', input: {} },
      { type: 'tool_use', id: 't2', name: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 1, y: 2 }] } },
    ]);
  });

  it('surfaces server errors with their status', async () => {
    await expect(streamTurn([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], {
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Not set up' }), { status: 503 }),
    })).rejects.toMatchObject({ status: 503, message: 'Not set up' });
  });

  it('keeps thinking blocks with their signatures', () => {
    const blocks = new Map();
    const result: TurnResult = { content: [], stopReason: null };
    for (const event of [
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Measure first.' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque' } },
    ]) applyStreamEvent(event, blocks, result, () => {});
    expect([...blocks.values()].map(p => p.block)).toEqual([
      { type: 'thinking', thinking: 'Measure first.', signature: 'sig' },
      { type: 'redacted_thinking', data: 'opaque' },
    ]);
  });

  it('keeps only text from before a fallback to another model', () => {
    expect(keptBlocks([
      { type: 'thinking', thinking: '', signature: 'a' },
      { type: 'text', text: 'Partial ' },
      { type: 'tool_use', id: 'x', name: 'get_plan', input: {} },
      { type: 'fallback' },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'tool_use', id: 'y', name: 'get_plan', input: {} },
    ])).toEqual([
      { type: 'text', text: 'Partial ' },
      { type: 'thinking', thinking: '', signature: 'b' },
      { type: 'tool_use', id: 'y', name: 'get_plan', input: {} },
    ]);
  });

  it('throws on a stream error event', () => {
    const result: TurnResult = { content: [], stopReason: null };
    expect(() => applyStreamEvent({ type: 'error', error: { message: 'Overloaded' } }, new Map(), result, () => {})).toThrow('Overloaded');
  });
});

// ── Server ──────────────────────────────────────────────────────────

const chatRequest = (body: unknown) => new Request('http://local/api/assistant/chat', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const hello = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };

describe('chat endpoint', () => {
  beforeEach(() => resetChatLimits());

  it('is unavailable without a key', async () => {
    const response = await handleAssistantChat(chatRequest(hello), { env: {}, client: 'a' });
    expect(response.status).toBe(503);
  });

  it('rejects conversations that are not this assistant’s', () => {
    // A tool the model invented comes back with an error result; the chat must go on.
    expect(parseConversation({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'Move the outlet' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'update_elements_placeholder', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Unknown tool update_elements_placeholder.', is_error: true }] },
    ] })).toHaveLength(3);
    expect(() => parseConversation({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'x' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'not a tool name!', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] },
    ] })).toThrow();
    expect(() => parseConversation({ messages: [] })).toThrow();
    expect(() => parseConversation({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'x' }] }] })).toThrow();
    expect(() => parseConversation({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'x' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'run_shell', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    ] })).toThrow();
    expect(() => parseConversation({ messages: [{ role: 'user', content: [{ type: 'image', source: {} }] }] })).toThrow();
    expect(parseConversation(hello)).toHaveLength(1);
    const pdf = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } };
    expect(parseConversation({ messages: [{ role: 'user', content: [pdf, { type: 'text', text: 'read this' }] }] })[0].content[0]).toEqual(pdf);
    expect(() => parseConversation({ messages: [{ role: 'user', content: [pdf, pdf] }] })).toThrow();
    expect(() => parseConversation({ messages: [{ role: 'user', content: [{ type: 'document', source: { ...pdf.source, media_type: 'text/html' } }] }] })).toThrow();
  });

  it('adds the model, prompt, tools and caching, and streams the reply through', async () => {
    let sent: any;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init!.body));
      expect((init!.headers as Record<string, string>)['x-api-key']).toBe('key');
      return chunked(reply([{ text: 'Hi!' }]));
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const response = await handleAssistantChat(chatRequest(hello), { env: { ANTHROPIC_API_KEY: 'key', ASSISTANT_CHAT_UPSTREAM: 'http://fake' }, client: 'a', fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://fake/v1/messages');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hi!');
    expect(sent.model).toBe(ASSISTANT_MODEL);
    expect(sent.stream).toBe(true);
    expect(sent.thinking).toEqual({ type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    expect(sent.fallbacks).toBe('default');
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>)['anthropic-beta']).toContain('thinking-binding-controls-2026-08-01');
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(sent.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(sent.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ event: 'assistant_chat', input: 10, output: 20 });
  });

  it('accepts drawing tool results with one picture', () => {
    const picture = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } };
    const turn = (content: unknown) => ({ messages: [
      { role: 'user', content: [{ type: 'text', text: 'Draw it' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'view_drawing', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content }] },
    ] });
    expect(parseConversation(turn([{ type: 'text', text: 'Page 1' }, picture]))[2].content[0]).toEqual({ type: 'tool_result', tool_use_id: 't', content: [{ type: 'text', text: 'Page 1' }, picture] });
    expect(() => parseConversation(turn([picture, picture]))).toThrow();
    expect(() => parseConversation(turn([{ type: 'document', source: {} }]))).toThrow();
  });

  it('runs a turn that starts with a photo or PDF on the build model', () => {
    const pdf = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjQ=' } };
    const turn = [
      { role: 'user' as const, content: [pdf, { type: 'text', text: 'Draw this plan' }] },
      { role: 'assistant' as const, content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 't', name: 'get_plan', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 't', content: 'Project' }] },
    ];
    expect(assistantMode(turn)).toBe('build');
    const sent = buildMessagesRequest(turn);
    expect(sent.model).toBe(ASSISTANT_MODELS.build.model);
    expect(sent.output_config).toEqual({ effort: 'high' });
    expect(sent.messages[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 's' });
    // The next plain message goes back to the chat model.
    const next = [...turn, { role: 'assistant' as const, content: [{ type: 'text', text: 'Done.' }] }, { role: 'user' as const, content: [{ type: 'text', text: 'Thanks' }] }];
    expect(assistantMode(next)).toBe('chat');
    expect(buildMessagesRequest(next).model).toBe(ASSISTANT_MODEL);
    expect(parseConversation({ messages: turn })[1].content[0]).toEqual({ type: 'thinking', thinking: '', signature: 's' });
  });

  it('maps upstream overload to 429 and limits each client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const overloaded = async () => new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 });
    const busy = await handleAssistantChat(chatRequest(hello), { env: { ANTHROPIC_API_KEY: 'k' }, client: 'b', fetchImpl: overloaded as typeof fetch });
    expect(busy.status).toBe(429);
    const ok = (async () => chunked(reply([{ text: 'ok' }]))) as typeof fetch;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let last: Response | undefined;
    for (let i = 0; i < 125; i++) last = await handleAssistantChat(chatRequest(hello), { env: { ANTHROPIC_API_KEY: 'k' }, client: 'c', fetchImpl: ok, now: 1_000_000 });
    expect(last!.status).toBe(429);
    expect(last!.headers.get('Retry-After')).toBeTruthy();
  });
});

// ── Conversation loop ───────────────────────────────────────────────

describe('conversation', () => {
  beforeEach(() => {
    fresh();
    runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
    newConversation();
  });

  function script(replies: string[]) {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const next = replies.shift();
      return next ? chunked(next) : new Response(JSON.stringify({ error: 'no more' }), { status: 500 });
    }));
    return bodies;
  }

  it('runs tools, shows a proposal and applies it as one undo step', async () => {
    const bodies = script([
      reply([{ tool: 'get_plan', input: {}, id: 'a' }]),
      reply([{ tool: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }, id: 'b' }]),
      reply([{ text: 'I put a sofa against the top wall.' }]),
    ]);
    const entries = get(undoHistoryStore).entries.length;
    await send('Add a sofa');
    const state = get(assistant);
    expect(state.busy).toBe(false);
    expect(state.items.map(item => item.kind)).toEqual(['user', 'assistant', 'proposal']);
    expect(state.items[1]).toMatchObject({ text: 'I put a sofa against the top wall.' });
    expect(state.items[2]).toMatchObject({ status: 'pending', counts: { furniture: 1 } });
    expect(get(previewActive)).toBe(true);
    expect(get(previewHighlight).size).toBe(1);
    // The model saw the plan readout and the placement result.
    expect(bodies[1].messages[2].content[0].content).toContain('"Living"');
    expect(bodies[2].messages[4].content[0].content).toMatch(/ok/);
    applyProposal();
    expect(get(previewActive)).toBe(false);
    expect(get(assistant).items[2]).toMatchObject({ status: 'applied' });
    expect(floor().furniture).toHaveLength(1);
    expect(get(undoHistoryStore).entries).toHaveLength(entries + 1);
  });

  it('discards a proposal and tells the model on the next message', async () => {
    script([
      reply([{ tool: 'place_furniture', input: { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }, id: 'b' }]),
      reply([{ text: 'Done.' }]),
    ]);
    await send('Add a sofa');
    discardProposal();
    expect(floor().furniture).toHaveLength(0);
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'proposal', status: 'discarded' });
    const bodies = script([reply([{ text: 'Okay.' }])]);
    await send('Never mind');
    expect(bodies[0].messages.at(-1).content[0].text).toMatch(/discarded/);
  });

  it('shows an error when the assistant is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 503 })));
    await send('Hello');
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'error', error: 'unavailable', retry: false });
    expect(get(assistant).busy).toBe(false);
  });
});

describe('rich text', () => {
  it('reads paragraphs, lists and bold without HTML', () => {
    expect(richText('Hello **there**.\n\n- one\n- two <b>\n\n1. a')).toEqual([
      { kind: 'p', spans: [{ text: 'Hello ', bold: false }, { text: 'there', bold: true }, { text: '.', bold: false }] },
      { kind: 'list', ordered: false, items: [[{ text: 'one', bold: false }], [{ text: 'two <b>', bold: false }]] },
      { kind: 'list', ordered: true, items: [[{ text: 'a', bold: false }]] },
    ]);
  });
});
