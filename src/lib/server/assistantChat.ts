import { ASSISTANT_BETAS, ASSISTANT_TOOL_NAMES } from '$lib/assistant/definitions';
import { buildMessagesRequest } from '$lib/assistant/request';
import { ASSISTANT_AGENTS, REVIEWER_TOOL_NAMES, type AssistantAgent } from '$lib/assistant/reviewer';

/**
 * The Assistant's model calls. The browser runs the plan tools and sends the
 * conversation; this adds the key, the fixed prompt and tools, and streams the
 * reply back. Only conversations shaped like this assistant's are accepted.
 */

/** Room for a few photos (the browser shrinks them to about 300 KB each), one PDF of up to 3 MB, and the drawing tools' pictures. */
export const CHAT_MAX_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_CHARS = 1_600_000;
const IMAGES_PER_MESSAGE = 3;
const MAX_PDF_CHARS = 4_200_000;
const PDFS_PER_MESSAGE = 1;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_MESSAGES = 240;
const MAX_TEXT = 8000;
const MAX_TOOL_RESULT = 120_000;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
/** Thinking blocks come back as the API sent them (text is usually empty; the signature carries the reasoning). */
const MAX_THINKING_CHARS = 400_000;

export interface ChatEnv {
  ANTHROPIC_API_KEY?: string;
  /** Base URL of the Messages API; tests point it at a local fake. */
  ASSISTANT_CHAT_UPSTREAM?: string;
}

export class ChatError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

// ── Limits ────────────────────────────────────────────────────────────
// A message usually takes 2–8 model calls, a whole flat up to ~20.

const WINDOW_MS = 10 * 60_000;
const PER_CLIENT_WINDOW = 120;
const PER_CLIENT_DAY = 600;
const GLOBAL_PER_MINUTE = 300;

interface Bucket { windowStart: number; window: number; dayStart: number; day: number }
const clients = new Map<string, Bucket>();
let globalMinute = -1, globalCount = 0;

export function resetChatLimits() { clients.clear(); globalMinute = -1; globalCount = 0; }

function takeQuota(client: string, now: number) {
  const minute = Math.floor(now / 60_000);
  if (minute !== globalMinute) { globalMinute = minute; globalCount = 0; }
  if (globalCount >= GLOBAL_PER_MINUTE) throw new ChatError(429, 'The assistant is busy. Try again in a minute.', 60);
  const bucket = clients.get(client) ?? { windowStart: now, window: 0, dayStart: now, day: 0 };
  if (now - bucket.windowStart > WINDOW_MS) { bucket.windowStart = now; bucket.window = 0; }
  if (now - bucket.dayStart > 24 * 3600_000) { bucket.dayStart = now; bucket.day = 0; }
  if (bucket.day >= PER_CLIENT_DAY) throw new ChatError(429, 'You have reached today’s assistant limit. Try again tomorrow.', 3600);
  if (bucket.window >= PER_CLIENT_WINDOW) throw new ChatError(429, 'That’s a lot of requests at once. Try again in a few minutes.', Math.ceil((WINDOW_MS - (now - bucket.windowStart)) / 1000));
  bucket.window++; bucket.day++; globalCount++;
  clients.set(client, bucket);
  if (clients.size > 10_000) for (const [key, value] of clients) if (now - value.dayStart > 24 * 3600_000) clients.delete(key);
}

// ── Validation ────────────────────────────────────────────────────────

type Block = Record<string, unknown>;
interface Message { role: 'user' | 'assistant'; content: Block[] }

function invalid(): never { throw new ChatError(400, 'This conversation could not be read.'); }

function checkImage(b: Block): Block {
  const source = b.source as Block | undefined;
  if (!source || source.type !== 'base64' || !IMAGE_TYPES.has(String(source.media_type))) invalid();
  if (typeof source.data !== 'string' || !source.data.length || source.data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)) invalid();
  return { type: 'image', source: { type: 'base64', media_type: source.media_type, data: source.data } };
}

function checkBlock(block: unknown, role: Message['role']): Block {
  if (!block || typeof block !== 'object') invalid();
  const b = block as Block;
  if (b.type === 'text') {
    if (typeof b.text !== 'string' || b.text.length > MAX_TEXT) invalid();
    return { type: 'text', text: b.text };
  }
  if (b.type === 'image' && role === 'user') return checkImage(b);
  if (b.type === 'document' && role === 'user') {
    const source = b.source as Block | undefined;
    if (!source || source.type !== 'base64' || source.media_type !== 'application/pdf') invalid();
    if (typeof source.data !== 'string' || !source.data.length || source.data.length > MAX_PDF_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)) invalid();
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.data } };
  }
  if (b.type === 'thinking' && role === 'assistant') {
    if (typeof b.thinking !== 'string' || typeof b.signature !== 'string' || b.thinking.length + b.signature.length > MAX_THINKING_CHARS) invalid();
    return { type: 'thinking', thinking: b.thinking, signature: b.signature };
  }
  if (b.type === 'redacted_thinking' && role === 'assistant') {
    if (typeof b.data !== 'string' || b.data.length > MAX_THINKING_CHARS) invalid();
    return { type: 'redacted_thinking', data: b.data };
  }
  if (b.type === 'tool_use' && role === 'assistant') {
    // A tool that doesn't exist is checked in parseConversation: the model invented it, and it must have failed.
    if (typeof b.id !== 'string' || typeof b.name !== 'string' || !TOOL_NAME.test(b.name)) invalid();
    if (!b.input || typeof b.input !== 'object' || Array.isArray(b.input)) invalid();
    return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
  }
  if (b.type === 'tool_result' && role === 'user') {
    if (typeof b.tool_use_id !== 'string') invalid();
    let content: string | Block[];
    if (typeof b.content === 'string') content = b.content;
    else {
      // The drawing tools answer with text and one picture.
      if (!Array.isArray(b.content) || !b.content.length || b.content.length > 2) invalid();
      content = (b.content as Block[]).map(part => part?.type === 'image' ? checkImage(part) : part?.type === 'text' && typeof part.text === 'string' ? { type: 'text', text: part.text } : invalid());
      if (content.filter(part => part.type === 'image').length > 1) invalid();
    }
    if (JSON.stringify(content).length > MAX_TOOL_RESULT + MAX_IMAGE_CHARS) invalid();
    if (typeof content === 'string' && content.length > MAX_TOOL_RESULT) invalid();
    return { type: 'tool_result', tool_use_id: b.tool_use_id, content, ...(b.is_error === true ? { is_error: true } : {}) };
  }
  return invalid();
}

/** Which agent a conversation is for: the Assistant (no agent) or the reviewer. */
export function parseAgent(body: unknown): AssistantAgent | undefined {
  const agent = (body as { agent?: unknown })?.agent;
  if (agent === undefined || agent === null) return undefined;
  if (typeof agent !== 'string' || !ASSISTANT_AGENTS.has(agent as AssistantAgent)) invalid();
  return agent as AssistantAgent;
}

export function parseConversation(body: unknown, agent?: AssistantAgent): Message[] {
  const toolNames = agent === 'reviewer' ? REVIEWER_TOOL_NAMES : ASSISTANT_TOOL_NAMES;
  const messages = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) invalid();
  const parsed = messages.map((message): Message => {
    const role = (message as Message)?.role;
    const content = (message as Message)?.content;
    if ((role !== 'user' && role !== 'assistant') || !Array.isArray(content) || !content.length || content.length > 64) invalid();
    const blocks = content.map(block => checkBlock(block, role));
    if (blocks.filter(block => block.type === 'image').length > IMAGES_PER_MESSAGE) invalid();
    if (blocks.filter(block => block.type === 'document').length > PDFS_PER_MESSAGE) invalid();
    return { role, content: blocks };
  });
  if (parsed[0].role !== 'user' || parsed[parsed.length - 1].role !== 'user') invalid();
  // A model now and then calls a tool that doesn't exist. The browser answers it with an error and the
  // chat goes on; any other result for an unknown tool means the conversation isn't this assistant's.
  const invented = new Set(parsed.flatMap(m => m.content).filter(b => b.type === 'tool_use' && !toolNames.has(String(b.name))).map(b => b.id));
  for (const block of parsed.flatMap(m => m.content)) if (block.type === 'tool_result' && invented.has(block.tool_use_id) && block.is_error !== true) invalid();
  return parsed;
}

/** Cache the fixed prompt and tools, and the conversation up to its newest block. */
export const upstreamRequest = (messages: Message[], agent?: AssistantAgent) => buildMessagesRequest(messages, agent);

// ── Usage log ─────────────────────────────────────────────────────────

/** Pass the stream through untouched, logging token use once it ends (never content). */
function usageLogger(requested: string, agent?: AssistantAgent): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let model = requested;
  const scan = (text: string) => {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:') || !(line.includes('usage') || line.includes('message_start'))) continue;
      try {
        const event = JSON.parse(line.slice(5));
        if (typeof event.message?.model === 'string') model = event.message.model;
        const u = event.message?.usage ?? event.usage;
        if (!u) continue;
        usage.input = Math.max(usage.input, u.input_tokens ?? 0);
        usage.output = Math.max(usage.output, u.output_tokens ?? 0);
        usage.cacheRead = Math.max(usage.cacheRead, u.cache_read_input_tokens ?? 0);
        usage.cacheWrite = Math.max(usage.cacheWrite, u.cache_creation_input_tokens ?? 0);
      } catch { /* partial or non-JSON line */ }
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const cut = buffer.lastIndexOf('\n');
      if (cut >= 0) { scan(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1); }
    },
    flush() {
      scan(buffer);
      console.log(JSON.stringify({ event: 'assistant_chat', model, ...(agent ? { agent } : {}), ...usage }));
    },
  });
}

// ── Handler ───────────────────────────────────────────────────────────

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > CHAT_MAX_BYTES) throw new ChatError(413, 'This conversation is too long. Start a new chat.');
  const text = await request.text();
  if (text.length > CHAT_MAX_BYTES) throw new ChatError(413, 'This conversation is too long. Start a new chat.');
  try { return JSON.parse(text); } catch { return invalid(); }
}

export async function handleAssistantChat(
  request: Request,
  { env, client, fetchImpl = fetch, now = Date.now() }: { env: ChatEnv; client: string; fetchImpl?: typeof fetch; now?: number },
): Promise<Response> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  try {
    if (!env.ANTHROPIC_API_KEY) throw new ChatError(503, 'The assistant isn’t set up on this server.');
    const body = await readBody(request);
    const agent = parseAgent(body);
    const messages = parseConversation(body, agent);
    takeQuota(client, now);
    const upstreamBody = upstreamRequest(messages, agent);
    const base = (env.ASSISTANT_CHAT_UPSTREAM || 'https://api.anthropic.com').replace(/\/$/, '');
    const upstream = await fetchImpl(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': ASSISTANT_BETAS },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    });
    if (!upstream.ok || !upstream.body) {
      const status = upstream.status;
      let detail = '';
      try { detail = String((await upstream.json())?.error?.type ?? ''); } catch { /* no body */ }
      console.error(JSON.stringify({ event: 'assistant_chat_upstream_error', status, type: detail }));
      if (status === 429 || status === 529) throw new ChatError(429, 'The assistant is busy. Try again in a minute.', 60);
      if (status === 400 && detail === 'invalid_request_error') throw new ChatError(400, 'The assistant couldn’t read this conversation. Start a new chat.');
      throw new ChatError(503, 'The assistant is unavailable right now.');
    }
    return new Response(upstream.body.pipeThrough(usageLogger(upstreamBody.model, agent)), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' },
    });
  } catch (error) {
    const known = error instanceof ChatError;
    if (!known && (error as Error)?.name !== 'AbortError') console.error(JSON.stringify({ event: 'assistant_chat_failed', message: String((error as Error)?.message ?? error) }));
    if (known && error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
    return new Response(JSON.stringify({ error: known ? error.message : 'The assistant is unavailable right now.' }), {
      status: known ? error.status : 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}
