/**
 * A scripted stand-in for the Messages API, for EVAL_DRY=1: proves the
 * harness end to end (session loop, recorder, checks, grader, results)
 * without spending anything. Per conversation it reads the plan, places one
 * nightstand in the first room, then answers; the grader gets a fixed grade.
 */
import { ANTHROPIC_MESSAGES_URL } from '$lib/assistant/stream';

function sse(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map(e => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  // Awkward chunk sizes, as a real network delivers them.
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 97) controller.enqueue(bytes.slice(i, i + 97));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

type Block = { text: string } | { tool: string; input: unknown; id: string } | { thinking: string };

function turn(model: string, blocks: Block[]): Response {
  const stop = blocks.some(b => 'tool' in b) ? 'tool_use' : 'end_turn';
  const events: unknown[] = [{ type: 'message_start', message: { id: 'msg_dry', model, role: 'assistant', content: [], usage: { input_tokens: 900, cache_read_input_tokens: 5200, cache_creation_input_tokens: 700, output_tokens: 1 } } }];
  blocks.forEach((block, index) => {
    if ('thinking' in block) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      events.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'dry-signature' } });
    } else if ('text' in block) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const piece of block.text.match(/.{1,11}/gs) ?? []) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
    } else {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.tool, input: {} } });
      const json = JSON.stringify(block.input);
      for (let i = 0; i < json.length; i += 13) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json.slice(i, i + 13) } });
    }
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 180 } }, { type: 'message_stop' });
  return sse(events);
}

/** The centre of the first room in a get_plan readout. */
function firstRoomCentre(readout: string): [number, number] {
  const corners = /corners ((?:\(-?\d+,-?\d+\) ?)+)/.exec(readout)?.[1];
  const points = [...(corners ?? '').matchAll(/\((-?\d+),(-?\d+)\)/g)].map(m => [Number(m[1]), Number(m[2])]);
  if (!points.length) return [100, 100];
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

function lastToolResult(messages: { role: string; content: any[] }[]): string {
  const last = messages[messages.length - 1];
  const block = Array.isArray(last?.content) ? last.content.find(b => b?.type === 'tool_result') : null;
  return typeof block?.content === 'string' ? block.content : '';
}

const GRADE = {
  criteria: [{ criterion: 'dry run', score: 3, reason: 'Scripted grade from the dry run.' }],
  overall: 3,
  summary: 'Dry run: the fake grader always returns 3.',
};

export function fakeMessagesApi(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== ANTHROPIC_MESSAGES_URL) return new Response('not found', { status: 404 });
    const body = JSON.parse(String(init?.body ?? '{}'));
    const model = String(body.model ?? 'claude-sonnet-5-5');
    if (!body.stream) {
      // The grader: one structured answer.
      return new Response(JSON.stringify({
        id: 'msg_dry_grade', type: 'message', role: 'assistant', model, stop_reason: 'end_turn',
        content: [{ type: 'thinking', thinking: '', signature: 'dry' }, { type: 'text', text: JSON.stringify(GRADE) }],
        usage: { input_tokens: 9000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const system = Array.isArray(body.system) ? String(body.system[0]?.text ?? '') : String(body.system ?? '');
    if (/^You review/.test(system)) return turn(model, [{ text: 'No problems found. Checked overlaps and doors.' }]);
    const messages = body.messages as { role: string; content: any[] }[];
    const rounds = messages.filter(m => m.role === 'assistant').length;
    if (rounds === 0) return turn(model, [{ thinking: 'Read the plan first.' }, { tool: 'get_plan', input: {}, id: 'toolu_dry_1' }]);
    if (rounds === 1) {
      const [x, y] = firstRoomCentre(lastToolResult(messages));
      return turn(model, [{ text: 'Placing a nightstand.' }, { tool: 'place_furniture', input: { items: [{ catalogId: 'nightstand', x, y, rotation: 0 }] }, id: 'toolu_dry_2' }]);
    }
    return turn(model, [{ text: 'Dry run: I put a nightstand in the middle of the first room.' }]);
  }) as typeof fetch;
}
