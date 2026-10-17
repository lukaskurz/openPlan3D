import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, createDefaultProject, addFloor, previewActive } from '$lib/stores/project';
import { runPlanTool } from '$lib/assistant/planTools';
import { activeCheck, assistantTools, runCheck } from '$lib/assistant/checks';
import { assistantApiKey, plausibleKey } from '$lib/assistant/apiKey';
import { assistant, send, newConversation, openConversation, deleteConversation, chatHistory, activeChatId } from '$lib/assistant/session';
import { describeStrokes, simplifyStroke } from '$lib/assistant/sketch';
import { parseConversation } from '$lib/server/assistantChat';
import { ANTHROPIC_MESSAGES_URL } from '$lib/assistant/stream';

const floor = () => get(currentProject)!.floors.find(f => f.id === get(currentProject)!.activeFloorId)!;

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

function sse(events: unknown[]) {
  return new Response(events.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200 });
}
const textReply = (text: string) => sse([
  { type: 'message_start', message: { usage: {} } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
]);
const toolReply = (name: string, input: unknown) => sse([
  { type: 'message_start', message: { usage: {} } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `t-${name}`, name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
]);

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  loadProject(createDefaultProject('Features'));
  runPlanTool('add_room', { name: 'Living', x: 0, y: 0, width: 500, depth: 400 });
});

describe('floors', () => {
  it('lists floors, switches by name and adds new ones', () => {
    addFloor('Upstairs', 'empty');
    expect(floor().name).toBe('Upstairs');
    expect(runPlanTool('get_plan', {}).text).toMatch(/Floors:\n- \S+ "Ground Floor" level 0, 4 walls/);
    const switched = runPlanTool('switch_floor', { floor: 'ground floor' });
    expect(switched.isError).toBeFalsy();
    expect(floor().name).toBe('Ground Floor');
    expect(switched.text).toContain('"Living"');
    const added = runPlanTool('add_floor', { name: 'Attic', start: 'outer' });
    expect(floor().name).toBe('Attic');
    expect(floor().walls).toHaveLength(4);
    expect(added.changed).toHaveLength(4);
    expect(runPlanTool('switch_floor', { floor: 'Basement' }).isError).toBe(true);
  });
});

describe('curved walls', () => {
  it('draws, bends, straightens and opens curved walls', () => {
    const made = runPlanTool('add_walls', { points: [[0, 400], [0, 800]], curves: [{ segment: 0, control: [-150, 600] }] });
    const id = made.changed![0];
    expect(floor().walls.find(w => w.id === id)?.curvePoint).toEqual({ x: -150, y: 600 });
    expect(runPlanTool('get_plan', {}).text).toContain('curved, control (-150,600)');
    const opening = runPlanTool('add_openings', { items: [{ kind: 'window', wallId: id, offset: 200, width: 100 }] });
    expect(opening.isError).toBeFalsy();
    runPlanTool('update_elements', { updates: [{ id, straighten: true }] });
    expect(floor().walls.find(w => w.id === id)?.curvePoint).toBeUndefined();
    runPlanTool('update_elements', { updates: [{ id, curve: [-80, 600] }] });
    expect(floor().walls.find(w => w.id === id)?.curvePoint).toEqual({ x: -80, y: 600 });
    expect(runPlanTool('add_walls', { points: [[0, 0], [10, 0]], curves: [{ segment: 3, control: [0, 0] }] }).isError).toBe(true);
  });
});

describe('checks and tools', () => {
  it('finds narrow gaps and small rooms', () => {
    runPlanTool('place_furniture', { items: [{ catalogId: 'sofa', x: 150, y: 60 }, { catalogId: 'sofa', x: 150, y: 210 }] });
    const walkway = runCheck(floor(), 'walkway', 90);
    expect(walkway.kind === 'walkway' && walkway.gaps.some(g => g.distance === 60 && g.between.join() === 'Sofa,Sofa')).toBe(true);
    expect(runPlanTool('check_plan', { kind: 'walkway', minimum: 50 }).text).not.toContain('60 cm between Sofa and Sofa');
    runPlanTool('add_room', { name: 'Closet', x: 500, y: 0, width: 150, depth: 150 });
    expect(runPlanTool('check_plan', { kind: 'room_size', minimum: 4 }).text).toMatch(/Closet: 2\.3 m²/);
  });

  it('makes reusable tools and switches them on', () => {
    const made = runPlanTool('make_tool', { kind: 'walkway', name: 'Walkway check', description: 'Shades narrow gaps red.', minimum: 87 });
    expect(made.madeTool).toBeTruthy();
    const tool = get(assistantTools).find(t => t.id === made.madeTool)!;
    expect(tool.minimum).toBe(85);
    expect(runPlanTool('get_plan', {}).text).toContain(`${tool.id} "Walkway check" walkway, minimum 85`);
    runPlanTool('show_tool', { id: 'walkway check', minimum: 100 });
    expect(get(activeCheck)).toMatchObject({ toolId: tool.id, minimum: 100 });
    activeCheck.set(null);
    expect(runPlanTool('make_tool', { kind: 'other', name: 'x' }).isError).toBe(true);
  });
});

describe('conversation features', () => {
  beforeEach(() => newConversation());

  it('keeps the conversation per project and marks unapplied proposals after a reload', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(toolReply('place_furniture', { items: [{ catalogId: 'sofa', x: 250, y: 60 }] }))
      .mockResolvedValueOnce(textReply('Added a sofa.')));
    await send('Add a sofa');
    expect(get(previewActive)).toBe(true);
    const project = structuredClone(get(currentProject)!);
    // Leave and come back, as a reload would.
    loadProject(createDefaultProject('Other'));
    expect(get(assistant).items).toHaveLength(0);
    loadProject(project);
    const items = get(assistant).items;
    expect(items.map(i => i.kind)).toEqual(['user', 'assistant', 'proposal']);
    expect(items[2]).toMatchObject({ status: 'discarded' });
    const fetchMock = vi.fn().mockResolvedValue(textReply('Okay.'));
    vi.stubGlobal('fetch', fetchMock);
    await send('Thanks');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    // Leaving the project ended the preview, so the model hears it was discarded.
    expect(body.messages.at(-1).content[0].text).toMatch(/discarded/);
    expect(body.messages[0].content[0].text).toBe('Add a sofa');
  });

  it('tells the model when a reload dropped a pending proposal', async () => {
    const project = createDefaultProject('Reloaded');
    localStorage.setItem(`o3d_assistant_chat_${project.id}`, JSON.stringify({ v: 1, outcomeNote: null,
      items: [{ kind: 'user', id: 1, text: 'Add a sofa' }, { kind: 'proposal', id: 2, status: 'pending', counts: { furniture: 1 } }],
      api: [{ role: 'user', content: [{ type: 'text', text: 'Add a sofa' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }] }));
    loadProject(project);
    expect(get(assistant).items[1]).toMatchObject({ status: 'discarded' });
    const fetchMock = vi.fn().mockResolvedValue(textReply('Okay.'));
    vi.stubGlobal('fetch', fetchMock);
    await send('Hi again');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages.at(-1).content[0].text).toMatch(/reloaded/);
  });

  it('calls Anthropic directly with the person’s own key and sends photos', async () => {
    assistantApiKey.set('sk-ant-test-0123456789abcdefghij');
    const fetchMock = vi.fn().mockResolvedValue(textReply('Nice room.'));
    vi.stubGlobal('fetch', fetchMock);
    await send('What do you think?', [{ mediaType: 'image/jpeg', data: 'AAAA', thumb: 'data:image/jpeg;base64,AAAA' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(init.headers['x-api-key']).toBe('sk-ant-test-0123456789abcdefghij');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(init.body);
    expect(body.model).toBeTruthy();
    expect(body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(get(assistant).items[0]).toMatchObject({ kind: 'user', images: ['data:image/jpeg;base64,AAAA'] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 })));
    await send('Again');
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'error', error: 'badKey' });
    assistantApiKey.set('');
  });

  it('keeps earlier chats: a new chat leaves the old one in the history to go back to', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textReply('Hello.')));
    await send('First question');
    const first = get(activeChatId);
    newConversation();
    expect(get(assistant).items).toHaveLength(0);
    expect(get(chatHistory).map(chat => chat.title)).toEqual(['First question']);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textReply('Hi.')));
    await send('Second question');
    expect(get(chatHistory).map(chat => chat.title)).toEqual(['Second question', 'First question']);
    openConversation(first);
    expect(get(activeChatId)).toBe(first);
    expect(get(assistant).items[0]).toMatchObject({ kind: 'user', text: 'First question' });
    // The model hears this chat's own history, not the other one.
    const fetchMock = vi.fn().mockResolvedValue(textReply('Okay.'));
    vi.stubGlobal('fetch', fetchMock);
    await send('Follow-up');
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(sent.map((m: { content: { text?: string }[] }) => m.content.at(-1)?.text)).toEqual(['First question', 'Hello.', 'Follow-up']);
    // A reload reopens the chat that was open.
    const project = structuredClone(get(currentProject)!);
    loadProject(createDefaultProject('Other'));
    expect(get(chatHistory)).toHaveLength(0);
    loadProject(project);
    expect(get(activeChatId)).toBe(first);
    deleteConversation(first);
    expect(get(assistant).items).toHaveLength(0);
    expect(get(chatHistory).map(chat => chat.title)).toEqual(['Second question']);
  });

  it('sends a sketch as a picture with its strokes in plan cm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(textReply('A desk there, got it.'));
    vi.stubGlobal('fetch', fetchMock);
    const note = describeStrokes([[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 2, y: 4 }]]);
    await send('Put a desk here', [{ mediaType: 'image/jpeg', data: 'AAAA', thumb: 'data:image/jpeg;base64,AAAA', name: 'sketch', sketch: true, note }]);
    const content = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(content[0].type).toBe('image');
    expect(content[1].text).toContain('1 (closed: circles an area): (0,0) (100,0) (100,100) (0,100) (2,4)');
    expect(content.at(-1).text).toBe('Put a desk here');
  });

  it('checks the shape of keys', () => {
    expect(plausibleKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(plausibleKey('sk-proj-abc')).toBe(false);
  });
});

describe('sketch strokes', () => {
  it('simplifies strokes to the points that matter', () => {
    const wobbly = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: i % 2 ? 0.5 : -0.5 }));
    expect(simplifyStroke(wobbly, 2)).toEqual([wobbly[0], wobbly[49]]);
    const corner = [{ x: 0, y: 0 }, { x: 50, y: 1 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(simplifyStroke(corner, 2)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it('keeps the description inside the server limit for one text block', () => {
    const scribble = Array.from({ length: 20 }, (_, s) => Array.from({ length: 400 }, (_, i) => ({ x: s * 37 + Math.sin(i) * 300, y: i * 3 + Math.cos(i * 1.7) * 200 })));
    const note = describeStrokes(scribble, { x0: 0, y0: 0, x1: 1000, y1: 1200 });
    expect(note.length).toBeLessThan(8000);
    expect(note).toContain('x 0 to 1000 cm');
    expect(note).toMatch(/\n20( \(closed[^)]*\))?: /);
  });
});

describe('server photo validation', () => {
  const message = (content: unknown[]) => ({ messages: [{ role: 'user', content }] });
  it('accepts small base64 photos and rejects anything else', () => {
    expect(parseConversation(message([{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }, { type: 'text', text: 'hi' }]))).toHaveLength(1);
    expect(() => parseConversation(message([{ type: 'image', source: { type: 'url', url: 'http://x' } }]))).toThrow();
    expect(() => parseConversation(message([{ type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'AAAA' } }]))).toThrow();
    expect(() => parseConversation(message([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'not base64!' } }]))).toThrow();
    const photo = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
    expect(() => parseConversation(message([photo, photo, photo, photo]))).toThrow();
  });
});
