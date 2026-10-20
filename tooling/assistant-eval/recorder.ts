/**
 * Watches the Messages API calls the assistant makes during one case: wraps
 * fetch, tees each event stream and reads the model, usage, tool calls and stop
 * reason from it. The session reads its own copy of the stream unchanged.
 */
import { ANTHROPIC_MESSAGES_URL } from '$lib/assistant/stream';
import { costOf, emptyUsage, priceFor, readUsage, type Usage } from './pricing';

export type Agent = 'assistant' | 'reviewer';

export interface ToolCallRecord {
  agent: Agent;
  /** Which model call asked for it (0-based). */
  call: number;
  id: string;
  name: string;
  input: unknown;
  /** The result the session sent back, cut to 1500 characters. Missing when no later call carried it. */
  result?: string;
  isError?: boolean;
}

export interface CallRecord {
  agent: Agent;
  requestedModel: string;
  /** The model that answered (differs after a server-side fallback). */
  model: string;
  status: number;
  stopReason: string | null;
  usage: Usage;
  costUsd: number;
  unpriced?: boolean;
  ms: number;
  requestBytes: number;
  text: string;
  error?: string;
}

const REVIEWER_PROMPT = /^You review a design proposal/;

function agentOf(body: Record<string, unknown>): Agent {
  const system = body.system;
  const text = Array.isArray(system) ? String((system[0] as { text?: unknown })?.text ?? '') : String(system ?? '');
  return REVIEWER_PROMPT.test(text) ? 'reviewer' : 'assistant';
}

const clip = (text: string, max = 1500) => text.length > max ? `${text.slice(0, max)}…` : text;

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => part?.type === 'text' ? String(part.text) : `[${part?.type ?? 'part'}]`).join('\n');
  return '';
}

export function createRecorder(baseFetch: typeof fetch) {
  const calls: CallRecord[] = [];
  const toolCalls: ToolCallRecord[] = [];
  const pending: Promise<void>[] = [];

  /** Tool results travel in the next request; attach them to the calls that asked. */
  function noteResults(body: Record<string, unknown>) {
    const messages = Array.isArray(body.messages) ? body.messages as { role: string; content: unknown }[] : [];
    for (const message of messages) {
      if (message.role !== 'user' || !Array.isArray(message.content)) continue;
      for (const block of message.content as Record<string, unknown>[]) {
        if (block?.type !== 'tool_result') continue;
        const call = toolCalls.find(t => t.id === block.tool_use_id && t.result === undefined);
        if (!call) continue;
        call.result = clip(resultText(block.content));
        if (block.is_error) call.isError = true;
      }
    }
  }

  async function readStream(stream: NonNullable<Response['body']>, record: CallRecord, index: number) {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    const blocks = new Map<number, { id: string; name: string; json: string } | { text: string }>();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let split: number;
      while ((split = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const raw = buffer.slice(0, split);
        buffer = buffer.slice(split).replace(/^\r?\n\r?\n/, '');
        const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data) continue;
        let event: any;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.type === 'message_start') {
          if (event.message?.model) record.model = event.message.model;
          readUsage(event.message?.usage, record.usage);
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block?.type === 'tool_use') blocks.set(event.index, { id: block.id, name: block.name, json: '' });
          else if (block?.type === 'text') blocks.set(event.index, { text: block.text ?? '' });
        } else if (event.type === 'content_block_delta') {
          const block = blocks.get(event.index);
          if (block && 'json' in block && event.delta?.type === 'input_json_delta') block.json += event.delta.partial_json ?? '';
          else if (block && 'text' in block && event.delta?.type === 'text_delta') block.text += event.delta.text ?? '';
        } else if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) record.stopReason = event.delta.stop_reason;
          readUsage(event.usage, record.usage);
        } else if (event.type === 'error') {
          record.error = String(event.error?.message ?? 'stream error');
        }
      }
    }
    for (const [, block] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
      if ('text' in block) { record.text += block.text; continue; }
      let input: unknown = {};
      try { input = block.json ? JSON.parse(block.json) : {}; } catch { input = { unparsed: block.json }; }
      toolCalls.push({ agent: record.agent, call: index, id: block.id, name: block.name, input });
    }
  }

  function finish(record: CallRecord, started: number) {
    record.ms = Date.now() - started;
    record.costUsd = costOf(record.model, record.usage);
    if (!priceFor(record.model)) record.unpriced = true;
  }

  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== ANTHROPIC_MESSAGES_URL) return baseFetch(input, init);
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(bodyText); } catch { /* not JSON: recorded as is */ }
    noteResults(body);
    const record: CallRecord = {
      agent: agentOf(body), requestedModel: String(body.model ?? ''), model: String(body.model ?? ''), status: 0,
      stopReason: null, usage: emptyUsage(), costUsd: 0, ms: 0, requestBytes: bodyText.length, text: '',
    };
    const index = calls.push(record) - 1;
    const started = Date.now();
    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (error) {
      record.error = (error as Error)?.message ?? 'fetch failed';
      finish(record, started);
      throw error;
    }
    record.status = response.status;
    if (!response.ok || !response.body) {
      try { record.error = clip(await response.clone().text(), 500); } catch { /* unreadable */ }
      finish(record, started);
      return response;
    }
    const [mine, theirs] = response.body.tee();
    pending.push(readStream(mine, record, index)
      .catch(error => { record.error = (error as Error)?.message ?? 'unreadable stream'; })
      .finally(() => finish(record, started)));
    return new Response(theirs, { status: response.status, statusText: response.statusText, headers: response.headers });
  }) as typeof fetch;

  return {
    fetch: wrapped,
    calls,
    toolCalls,
    /** Wait until every stream has been read. */
    settle: () => Promise.all(pending).then(() => undefined),
  };
}

export type Recorder = ReturnType<typeof createRecorder>;
