/**
 * Development only: run the in-app Assistant on your own Claude subscription.
 *
 * Instead of the Messages API, each conversation gets one long-lived
 * `claude -p` process (streaming JSON in and out, signed in with your Claude
 * login). Its plan tools come from tooling/assistant-dev-bridge.mjs, which
 * forwards every call here; the call is handed to the browser as a normal
 * tool_use, and answered when the browser sends the tool_result back. The
 * browser can't tell the difference from production.
 *
 * Enabled with ASSISTANT_DEV_CLAUDE=1 under `vite dev` only.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASSISTANT_MODELS, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS, assistantMode, type AssistantMode } from '$lib/assistant/definitions';
import { ChatError, CHAT_MAX_BYTES, parseConversation } from './assistantChat';

const TOOL_PREFIX = 'mcp__plan__';
const IDLE_MS = 30 * 60_000;
const CALL_TIMEOUT_MS = 10 * 60_000;

interface ToolResult { text: string; isError: boolean; image?: { mediaType: string; data: string } }
interface Expected { id: string; name: string; key: string }

interface Session {
  id: string;
  proc: ChildProcessWithoutNullStreams;
  alive: boolean;
  mode: AssistantMode;
  /** Events not yet delivered to a browser request. */
  queue: string[];
  /** The open response for the current model call, if any. */
  listener: ReadableStreamDefaultController<Uint8Array> | null;
  /** Tool calls the model has made, waiting for the bridge to ask for them. */
  expected: Expected[];
  results: Map<string, ToolResult>;
  waiting: Map<string, (result: ToolResult) => void>;
  blocks: Map<number, { id: string; name: string; json: string }>;
  stopReason: string | null;
  lastUsed: number;
}

const sessions = new Map<string, Session>();
const encoder = new TextEncoder();
const token = randomBytes(24).toString('hex');
let bridge: Promise<string> | null = null;
let workdir: string | null = null;

/** Stable JSON, so a tool call's input matches however its keys were ordered. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

// ── The local endpoint the MCP bridge talks to ───────────────────────

function startBridge(): Promise<string> {
  return bridge ??= new Promise((resolve, reject) => {
    const server: Server = createServer(async (req, res) => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.headers.authorization !== `Bearer ${token}`) return json(403, { error: 'forbidden' });
      if (req.method === 'GET' && req.url === '/tools') {
        return json(200, ASSISTANT_TOOLS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.input_schema })));
      }
      if (req.method === 'POST' && req.url === '/call') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const { conversation, name, input } = JSON.parse(raw);
        const session = sessions.get(conversation);
        if (!session) return json(200, { text: 'error: this conversation has ended.', isError: true });
        return json(200, await awaitResult(session, String(name), input));
      }
      json(404, { error: 'not found' });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no bridge address'));
      server.unref();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

/** Match a bridge call to the tool_use the browser was given, then wait for the browser's result. */
function awaitResult(session: Session, name: string, input: unknown): Promise<ToolResult> {
  const key = `${name}:${stable(input)}`;
  const index = session.expected.findIndex(item => item.key === key);
  const fallback = index < 0 ? session.expected.findIndex(item => item.name === name) : index;
  if (fallback < 0) return Promise.resolve({ text: 'error: unexpected tool call.', isError: true });
  const [{ id }] = session.expected.splice(fallback, 1);
  const ready = session.results.get(id);
  if (ready) { session.results.delete(id); return Promise.resolve(ready); }
  return new Promise(resolve => {
    const timer = setTimeout(() => { session.waiting.delete(id); resolve({ text: 'error: the plan did not answer in time.', isError: true }); }, CALL_TIMEOUT_MS);
    session.waiting.set(id, result => { clearTimeout(timer); resolve(result); });
  });
}

// ── claude -p processes ──────────────────────────────────────────────

function emit(session: Session, event: unknown) {
  const line = `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (session.listener) session.listener.enqueue(encoder.encode(line));
  else session.queue.push(line);
}

/** End the browser's request after each model call, like the Messages API does. */
function finishCall(session: Session) {
  const listener = session.listener;
  session.listener = null;
  try { listener?.close(); } catch { /* already closed */ }
}

function onOutput(session: Session, message: any) {
  session.lastUsed = Date.now();
  if (message.type === 'stream_event') {
    const event = message.event;
    if (event?.type === 'message_start') { session.blocks.clear(); session.stopReason = null; }
    if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      const name = String(event.content_block.name).replace(TOOL_PREFIX, '');
      session.blocks.set(event.index, { id: event.content_block.id, name, json: '' });
      event.content_block = { ...event.content_block, name };
    }
    if (event?.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      const block = session.blocks.get(event.index);
      if (block) block.json += event.delta.partial_json ?? '';
    }
    if (event?.type === 'content_block_stop') {
      const block = session.blocks.get(event.index);
      if (block) {
        let input: unknown = {};
        try { input = block.json ? JSON.parse(block.json) : {}; } catch { /* model sent bad JSON */ }
        session.expected.push({ id: block.id, name: block.name, key: `${block.name}:${stable(input)}` });
      }
    }
    if (event?.type === 'message_delta' && event.delta?.stop_reason) session.stopReason = event.delta.stop_reason;
    emit(session, event);
    if (event?.type === 'message_stop') finishCall(session);
    return;
  }
  if (message.type === 'result') {
    console.log(JSON.stringify({ event: 'assistant_chat_dev', model: ASSISTANT_MODELS[session.mode].model, turns: message.num_turns, apiEquivalentUsd: message.total_cost_usd }));
    if (message.is_error || message.subtype !== 'success') {
      emit(session, { type: 'error', error: { message: String(message.result ?? message.subtype ?? 'claude -p failed') } });
      finishCall(session);
    }
  }
}

async function startSession(id: string, mode: AssistantMode): Promise<Session> {
  const url = await startBridge();
  workdir ??= mkdtempSync(path.join(tmpdir(), 'openplan3d-assistant-'));
  const mcp = { mcpServers: { plan: {
    command: process.execPath,
    args: [path.resolve('tooling/assistant-dev-bridge.mjs')],
    env: { BRIDGE_URL: url, BRIDGE_TOKEN: token, BRIDGE_CONVERSATION: id },
  } } };
  // Without an API key in its environment, claude uses your Claude login (subscription).
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  const proc = spawn(process.env.ASSISTANT_DEV_CLAUDE_BIN || 'claude', [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', ASSISTANT_MODELS[mode].model, ...(ASSISTANT_MODELS[mode].effort ? ['--effort', ASSISTANT_MODELS[mode].effort!] : []),
    '--system-prompt', ASSISTANT_SYSTEM_PROMPT,
    '--tools', '', '--mcp-config', JSON.stringify(mcp), '--strict-mcp-config', '--allowedTools', 'mcp__plan',
    '--setting-sources', '', '--no-session-persistence',
  ], { cwd: workdir, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const session: Session = {
    id, proc, alive: true, mode, queue: [], listener: null, expected: [], results: new Map(), waiting: new Map(),
    blocks: new Map(), stopReason: null, lastUsed: Date.now(),
  };
  let buffer = '', stderr = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let cut: number;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      try { onOutput(session, JSON.parse(line)); } catch { /* not JSON */ }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
  proc.on('error', error => { stderr += String(error.message); });
  proc.on('exit', code => {
    session.alive = false;
    if (sessions.get(id) === session) sessions.delete(id);
    for (const resolve of session.waiting.values()) resolve({ text: 'error: stopped.', isError: true });
    if (session.listener) {
      console.error(JSON.stringify({ event: 'assistant_chat_dev_exit', code, stderr: stderr.trim().slice(-500) }));
      emit(session, { type: 'error', error: { message: `claude -p stopped (${stderr.trim().split('\n').pop() || `exit ${code}`}). Is Claude Code installed and signed in?` } });
      finishCall(session);
    }
  });
  sessions.set(id, session);
  return session;
}

function endSession(session: Session) {
  sessions.delete(session.id);
  finishCall(session);
  if (session.alive) session.proc.kill();
}

setInterval(() => {
  for (const session of sessions.values()) if (Date.now() - session.lastUsed > IDLE_MS && !session.listener) endSession(session);
}, 60_000).unref();

/** A fresh process only knows the new message, so earlier text turns go along as context. */
function catchUp(messages: ReturnType<typeof parseConversation>): string {
  const lines: string[] = [];
  for (const message of messages.slice(0, -1)) {
    for (const block of message.content) {
      if (block.type === 'text' && !String(block.text).startsWith('[')) lines.push(`${message.role === 'user' ? 'Person' : 'You'}: ${block.text}`);
    }
  }
  return lines.length ? `Earlier in this conversation:\n${lines.join('\n')}\n\nNew message:\n` : '';
}

export async function handleDevChat(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (raw.length > CHAT_MAX_BYTES) throw new ChatError(413, 'This conversation is too long. Start a new chat.');
    let body: { conversation?: unknown };
    try { body = JSON.parse(raw); } catch { throw new ChatError(400, 'This conversation could not be read.'); }
    const messages = parseConversation(body);
    const id = typeof body.conversation === 'string' && /^[\w-]{8,64}$/.test(body.conversation) ? body.conversation : 'default';
    const last = messages[messages.length - 1];
    const results = last.content.filter(block => block.type === 'tool_result');
    let session = sessions.get(id);

    if (results.length) {
      if (!session?.alive) throw new ChatError(409, 'The development assistant restarted. Send your message again.');
      for (const block of results) {
        const parts = Array.isArray(block.content) ? block.content as { type: string; text?: string; source?: { media_type: string; data: string } }[] : null;
        const picture = parts?.find(part => part.type === 'image')?.source;
        const result: ToolResult = {
          text: parts ? parts.filter(part => part.type === 'text').map(part => part.text).join('\n') : String(block.content),
          isError: block.is_error === true,
          ...(picture ? { image: { mediaType: picture.media_type, data: picture.data } } : {}),
        };
        const waiter = session.waiting.get(String(block.tool_use_id));
        if (waiter) { session.waiting.delete(String(block.tool_use_id)); waiter(result); }
        else session.results.set(String(block.tool_use_id), result);
      }
    } else {
      // A new message. A process still waiting on tools belongs to a stopped turn: start over.
      if (session && (session.waiting.size || session.expected.length || session.listener)) { endSession(session); session = undefined; }
      // A photo or PDF moves the conversation to the build model; it then stays there, so the process keeps its context.
      const mode = assistantMode(messages);
      if (session?.alive && mode === 'build' && session.mode !== 'build') { endSession(session); session = undefined; }
      session?.queue.splice(0);
      const fresh = !session?.alive;
      if (fresh) session = await startSession(id, mode);
      const text = last.content.filter(block => block.type === 'text').map(block => String(block.text)).join('\n\n');
      const images = last.content.filter(block => block.type === 'image' || block.type === 'document');
      const content = [...images, { type: 'text', text: (fresh ? catchUp(messages) : '') + text }];
      session!.proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
    }

    const active = session!;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        active.listener = controller;
        for (const line of active.queue.splice(0)) controller.enqueue(encoder.encode(line));
      },
      cancel() {
        // The browser stopped: end this conversation's process.
        if (active.listener) { active.listener = null; endSession(active); }
      },
    });
    request.signal.addEventListener('abort', () => { if (active.listener) { active.listener = null; endSession(active); } });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof ChatError;
    if (!known) console.error(JSON.stringify({ event: 'assistant_chat_dev_failed', message: String((error as Error)?.message ?? error) }));
    return new Response(JSON.stringify({ error: known ? error.message : 'The development assistant failed. See the dev server log.' }), {
      status: known ? error.status : 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
