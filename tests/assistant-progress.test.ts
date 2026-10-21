import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createDefaultProject, loadProject } from '$lib/stores/project';
import { applyStreamEvent, streamTurn, type TurnResult } from '$lib/assistant/stream';
import { assistant, send, newConversation, progressNote, type AssistantState } from '$lib/assistant/session';
import { assistantApiKey, assistantServer, checkAssistantServer } from '$lib/assistant/apiKey';

const hello = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }];

function sse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** A reply that thinks out loud in two notes, then answers. */
const thinkingReply = () => sse([
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reading the plan.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '\nMeasuring the living room.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'It is 20 m².' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('stream', () => {
  it('reports progress notes and keeps the thinking block unchanged', async () => {
    const notes: string[] = [];
    const result = await streamTurn(hello, { fetchImpl: (async () => thinkingReply()) as typeof fetch, onThinking: text => notes.push(text) });
    expect(notes).toEqual(['Reading the plan.', 'Reading the plan.\nMeasuring the living room.']);
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Reading the plan.\nMeasuring the living room.', signature: 'sig' },
      { type: 'text', text: 'It is 20 m².' },
    ]);
    // Without a listener, nothing changes.
    const blocks = new Map();
    const turn: TurnResult = { content: [], stopReason: null };
    applyStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, blocks, turn, () => {});
    applyStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } }, blocks, turn, () => {});
    expect(blocks.get(0).block).toEqual({ type: 'thinking', thinking: 'x', signature: '' });
  });
});

describe('progress notes', () => {
  it('shows the last line, cut to whole sentences', () => {
    expect(progressNote('')).toBeNull();
    expect(progressNote('First.\n\n**Now the kitchen.**')).toBe('Now the kitchen.');
    const long = `${'The walls are drawn along their centre lines. '.repeat(3)}Now the doors.`;
    expect(progressNote(long)).toBe('The walls are drawn along their centre lines. The walls are drawn along their centre lines. Now the doors.');
    const sentence = 'word '.repeat(40).trim();
    const cut = progressNote(sentence)!;
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('shows notes while the model works, and saves none of it', async () => {
    loadProject(createDefaultProject('Notes'));
    newConversation();
    assistantApiKey.set('');
    const fetchMock = vi.fn(async () => thinkingReply());
    vi.stubGlobal('fetch', fetchMock);
    const seen: AssistantState[] = [];
    const stopWatching = assistant.subscribe(state => seen.push(state));
    await send('How big is the living room?');
    stopWatching();
    const notes = seen.map(state => state.note).filter(Boolean);
    expect(notes).toEqual(['Reading the plan.', 'Measuring the living room.']);
    // Reply text takes over from the note, and the turn ends with none.
    const firstText = seen.findIndex(state => state.items.some(item => item.kind === 'assistant'));
    expect(seen[firstText].note).toBeNull();
    expect(get(assistant)).toMatchObject({ busy: false, activity: null, note: null });
    expect(JSON.stringify(get(assistant).items)).not.toContain('Measuring');
  });

});

describe('server check', () => {
  it('asks for a personal key when there is no server to run the Assistant', async () => {
    await checkAssistantServer((async () => json({ available: true })) as typeof fetch);
    expect(get(assistantServer)).toBe(true);
    await checkAssistantServer((async () => json({ available: false })) as typeof fetch);
    expect(get(assistantServer)).toBe(false);
    // Static hosting: the route doesn't exist, or the request fails outright.
    await checkAssistantServer((async () => new Response('Not found', { status: 404 })) as typeof fetch);
    expect(get(assistantServer)).toBe(false);
    await checkAssistantServer((async () => { throw new TypeError('offline'); }) as typeof fetch);
    expect(get(assistantServer)).toBe(false);
  });
});
