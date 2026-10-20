import { ASSISTANT_BETAS, ASSISTANT_TOOL_NAMES } from '$lib/assistant/definitions';
import { buildMessagesRequest } from '$lib/assistant/request';
import type { Access } from './assistantAuth';
import { budgetBlock, budgetStatus, chargeBudget, costMicros, type AssistantBudget, type Usage } from './assistantBudget';

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
/** Thinking blocks come back as the API sent them (text is usually empty; the signature carries the reasoning). */
const MAX_THINKING_CHARS = 400_000;

export interface ChatEnv {
  ANTHROPIC_API_KEY?: string;
  /** Base URL of the Messages API; tests point it at a local fake. */
  ASSISTANT_CHAT_UPSTREAM?: string;
}

export class ChatError extends Error {
  /** `code` tells the browser what to offer: `sign-in`, `not-allowed` or `budget`. */
  constructor(public status: number, message: string, public retryAfter?: number, public code?: 'sign-in' | 'not-allowed' | 'budget') { super(message); }
}

const NOT_SET_UP = 'The assistant isn’t set up on this server.';

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
    if (typeof b.id !== 'string' || typeof b.name !== 'string' || !ASSISTANT_TOOL_NAMES.has(b.name)) invalid();
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

export function parseConversation(body: unknown): Message[] {
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
  return parsed;
}

/** Cache the fixed prompt and tools, and the conversation up to its newest block. */
export const upstreamRequest = (messages: Message[]) => buildMessagesRequest(messages);

// ── Usage log ─────────────────────────────────────────────────────────

const CHARGE_WAIT_MS = 4000;

/** Pass the stream through untouched, logging token use and cost once it ends (never content), then charging it. */
function usageLogger(requested: string, charge?: (micros: number) => Promise<unknown>): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = '';
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
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
  let finished = false;
  // Also runs when the person stops mid-reply: the tokens so far are billed all the same.
  const finish = async () => {
    if (finished) return;
    finished = true;
    scan(buffer);
    const micros = costMicros(model, usage);
    console.log(JSON.stringify({ event: 'assistant_chat', model, ...usage, usd: micros / 1e6 }));
    if (!charge) return;
    // A storage hiccup must never break the reply; wait a little so the write isn't cut off, then let it finish alone.
    const charged = charge(micros).catch(() => console.error(JSON.stringify({ event: 'assistant_budget_charge_failed' })));
    await Promise.race([charged, new Promise(resolve => setTimeout(resolve, CHARGE_WAIT_MS))]);
  };
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      buffer += decoder.decode(chunk, { stream: true });
      const cut = buffer.lastIndexOf('\n');
      if (cut >= 0) { scan(buffer.slice(0, cut)); buffer = buffer.slice(cut + 1); }
    },
    flush: finish,
    // Transformer.cancel (Node 21.5+) is missing from TypeScript's DOM types.
    cancel: finish,
  } as Transformer<Uint8Array, Uint8Array>);
}

// ── Handler ───────────────────────────────────────────────────────────

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > CHAT_MAX_BYTES) throw new ChatError(413, 'This conversation is too long. Start a new chat.');
  const text = await request.text();
  if (text.length > CHAT_MAX_BYTES) throw new ChatError(413, 'This conversation is too long. Start a new chat.');
  try { return JSON.parse(text); } catch { return invalid(); }
}

export interface ChatOptions {
  env: ChatEnv;
  /** Client address; limits are kept per signed-in email when there is one. */
  client: string;
  fetchImpl?: typeof fetch;
  now?: number;
  /** Who is calling (`resolveAccess`); the route always passes it. Without it the endpoint is open, as under `vite dev`. */
  access?: (request: Request) => Promise<Access>;
  /** Dollar budgets for signed-in people; the route always passes it. */
  budget?: AssistantBudget;
}

/** Turn the caller's access into who they are for limits and budget, or the refusal to send. */
function admitted(access: Access): { email?: string } {
  if (access.access === 'open') return {};
  if (access.access === 'allowed') return { email: access.email };
  if (access.access === 'sign-in') throw new ChatError(401, 'Sign in to use the assistant.', undefined, 'sign-in');
  if (access.access === 'not-allowed') throw new ChatError(403, 'This assistant is only for invited people. Ask the owner to add your email, or use your own API key.', undefined, 'not-allowed');
  throw new ChatError(503, NOT_SET_UP);
}

export async function handleAssistantChat(
  request: Request,
  { env, client, fetchImpl = fetch, now = Date.now(), access, budget }: ChatOptions,
): Promise<Response> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  try {
    if (!env.ANTHROPIC_API_KEY) throw new ChatError(503, NOT_SET_UP);
    // Before reading the body, so strangers can't make the server parse 12 MB.
    const { email } = access ? admitted(await access(request)) : {};
    const messages = parseConversation(await readBody(request));
    takeQuota(email ? `email:${email}` : client, now);
    const charged = email && budget ? budget : undefined;
    if (charged) {
      let status;
      try { status = await budgetStatus(charged, email!, now); }
      catch (error) {
        // Fail closed: without the ledger nobody's spending can be bounded.
        console.error(JSON.stringify({ event: 'assistant_budget_unavailable', message: String((error as Error)?.message ?? error) }));
        throw new ChatError(503, 'The assistant is unavailable right now.');
      }
      const blocked = budgetBlock(status, now);
      if (blocked) throw new ChatError(429, blocked.message, blocked.retryAfter, 'budget');
    }
    const upstreamBody = upstreamRequest(messages);
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
    const charge = charged ? (micros: number) => chargeBudget(charged.store, email!, micros, now) : undefined;
    return new Response(upstream.body.pipeThrough(usageLogger(upstreamBody.model, charge)), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no' },
    });
  } catch (error) {
    const known = error instanceof ChatError;
    if (!known && (error as Error)?.name !== 'AbortError') console.error(JSON.stringify({ event: 'assistant_chat_failed', message: String((error as Error)?.message ?? error) }));
    if (known && error.retryAfter) headers['Retry-After'] = String(error.retryAfter);
    return new Response(JSON.stringify({ error: known ? error.message : 'The assistant is unavailable right now.', ...(known && error.code ? { code: error.code } : {}) }), {
      status: known ? error.status : 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
}

// ── Who am I ──────────────────────────────────────────────────────────

const cents = (micros: number) => Math.round(micros / 10_000) / 100;

export type AssistantMe =
  | { available: false }
  | { available: true; access: 'open' | 'sign-in' }
  | { available: true; access: 'not-allowed'; email: string }
  | { available: true; access: 'allowed'; email: string; budget?: { day: { spentUsd: number; limitUsd: number }; month: { spentUsd: number; limitUsd: number } } };

/** What the panel should show: `GET /api/assistant/me`, always 200. `budget` is left out only when the ledger can't be read. */
export async function describeAssistantAccess(
  request: Request,
  { env, access, budget, now = Date.now() }: { env: ChatEnv; access: (request: Request) => Promise<Access>; budget?: AssistantBudget; now?: number },
): Promise<AssistantMe> {
  if (!env.ANTHROPIC_API_KEY) return { available: false };
  let who: Access;
  try { who = await access(request); }
  catch (error) {
    console.error(JSON.stringify({ event: 'assistant_access_unavailable', message: String((error as Error)?.message ?? error) }));
    return { available: false };
  }
  if (who.access === 'unavailable') return { available: false };
  if (who.access === 'open' || who.access === 'sign-in') return { available: true, access: who.access };
  if (who.access === 'not-allowed') return { available: true, access: 'not-allowed', email: who.email };
  if (!budget) return { available: true, access: 'allowed', email: who.email };
  try {
    const status = await budgetStatus(budget, who.email, now);
    return {
      available: true, access: 'allowed', email: who.email,
      budget: {
        day: { spentUsd: cents(status.day.spent), limitUsd: cents(status.day.limit) },
        month: { spentUsd: cents(status.month.spent), limitUsd: cents(status.month.limit) },
      },
    };
  } catch (error) {
    console.error(JSON.stringify({ event: 'assistant_budget_unavailable', message: String((error as Error)?.message ?? error) }));
    return { available: true, access: 'allowed', email: who.email };
  }
}
