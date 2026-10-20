/** One model call, read as a server-sent event stream: through /api/assistant/chat, or straight to Anthropic with the person's own key. */
import { ASSISTANT_BETAS } from './definitions';
import { buildMessagesRequest } from './request';

export interface ImageSource { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; data: string }

export interface PdfSource { type: 'base64'; media_type: 'application/pdf'; data: string }

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'document'; source: PdfSource }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'fallback' }
  | { type: 'tool_result'; tool_use_id: string; content: string | ToolResultPart[]; is_error?: boolean };

/** A tool result with a picture: its text, then the image. */
export type ToolResultPart = { type: 'text'; text: string } | { type: 'image'; source: ImageSource };

export interface ApiMessage { role: 'user' | 'assistant'; content: ContentBlock[] }

export interface TurnResult {
  content: ContentBlock[];
  stopReason: string | null;
}

export const ASSISTANT_ENDPOINT = '/api/assistant/chat';
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** Why openPlan3D's server turned a request away: nobody signed in, not invited, or over budget. */
export type AccessCode = 'sign-in' | 'not-allowed' | 'budget';

const ACCESS_CODES = new Set<string>(['sign-in', 'not-allowed', 'budget']);

export class AssistantRequestError extends Error {
  constructor(public status: number, message: string, public ownKey = false, public code?: AccessCode) { super(message); }
}

interface Partial { block: ContentBlock; json: string }

/**
 * The blocks to keep in the conversation. After a mid-reply fallback to another
 * model, only text survives from before the switch (the declined model's
 * thinking and tool calls must not be sent back or run); the marker itself is dropped.
 */
export function keptBlocks(content: ContentBlock[]): ContentBlock[] {
  const boundary = content.map(block => block.type).lastIndexOf('fallback');
  return content
    .filter((block, i) => i > boundary || block.type === 'text')
    .filter(block => block.type !== 'text' || block.text.length > 0);
}

/**
 * Apply one SSE event to the blocks being assembled. `onThinking` gets the
 * current thinking block's text so far (with `display: 'updates'`, the model's
 * progress notes). Exported for tests.
 */
export function applyStreamEvent(event: any, blocks: Map<number, Partial>, result: TurnResult, onText: (text: string) => void, onThinking?: (text: string) => void) {
  switch (event?.type) {
    case 'content_block_start': {
      const block = event.content_block;
      if (block?.type === 'text') blocks.set(event.index, { block: { type: 'text', text: block.text ?? '' }, json: '' });
      else if (block?.type === 'tool_use') blocks.set(event.index, { block: { type: 'tool_use', id: block.id, name: block.name, input: {} }, json: '' });
      else if (block?.type === 'thinking') blocks.set(event.index, { block: { type: 'thinking', thinking: block.thinking ?? '', signature: block.signature ?? '' }, json: '' });
      else if (block?.type === 'redacted_thinking') blocks.set(event.index, { block: { type: 'redacted_thinking', data: block.data ?? '' }, json: '' });
      else if (block?.type === 'fallback') blocks.set(event.index, { block: { type: 'fallback' }, json: '' });
      break;
    }
    case 'content_block_delta': {
      const partial = blocks.get(event.index);
      if (!partial) break;
      if (event.delta?.type === 'text_delta' && partial.block.type === 'text') {
        partial.block.text += event.delta.text;
        onText(event.delta.text);
      } else if (event.delta?.type === 'input_json_delta') partial.json += event.delta.partial_json ?? '';
      else if (event.delta?.type === 'thinking_delta' && partial.block.type === 'thinking') {
        partial.block.thinking += event.delta.thinking ?? '';
        onThinking?.(partial.block.thinking);
      }
      else if (event.delta?.type === 'signature_delta' && partial.block.type === 'thinking') partial.block.signature += event.delta.signature ?? '';
      break;
    }
    case 'content_block_stop': {
      const partial = blocks.get(event.index);
      if (partial?.block.type === 'tool_use') {
        try { partial.block.input = partial.json ? JSON.parse(partial.json) : {}; }
        catch { partial.block.input = {}; }
      }
      break;
    }
    case 'message_delta':
      if (event.delta?.stop_reason) result.stopReason = event.delta.stop_reason;
      break;
    case 'error':
      throw new AssistantRequestError(503, event.error?.message ?? 'The assistant stopped unexpectedly.');
  }
}

export async function streamTurn(
  messages: ApiMessage[],
  options: {
    signal?: AbortSignal; onText?: (text: string) => void; onThinking?: (text: string) => void; fetchImpl?: typeof fetch; conversation?: string; apiKey?: string;
    /** Firebase ID token of the signed-in person; only ever sent to openPlan3D's server. */
    idToken?: string;
  } = {},
): Promise<TurnResult> {
  const doFetch = options.fetchImpl ?? fetch;
  // With the person's own key, go straight to Anthropic; otherwise through openPlan3D's server.
  const response = options.apiKey
    ? await doFetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': ASSISTANT_BETAS,
      },
      body: JSON.stringify(buildMessagesRequest(messages as never)),
      signal: options.signal,
    })
    : await doFetch(ASSISTANT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.idToken ? { Authorization: `Bearer ${options.idToken}` } : {}) },
      body: JSON.stringify({ messages, conversation: options.conversation }),
      signal: options.signal,
    });
  if (!response.ok || !response.body) {
    let message = '';
    let code: AccessCode | undefined;
    try {
      const data = await response.json();
      const error = data?.error;
      message = String(typeof error === 'object' && error ? error.message ?? '' : error ?? '');
      if (!options.apiKey && ACCESS_CODES.has(data?.code)) code = data.code;
    } catch { /* non-JSON error */ }
    throw new AssistantRequestError(response.status, message || `The assistant is unavailable (HTTP ${response.status}).`, !!options.apiKey, code);
  }
  const blocks = new Map<number, Partial>();
  const result: TurnResult = { content: [], stopReason: null };
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const onText = options.onText ?? (() => {});
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
      let event: unknown;
      try { event = JSON.parse(data); } catch { continue; }
      applyStreamEvent(event, blocks, result, onText, options.onThinking);
    }
  }
  result.content = keptBlocks([...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, partial]) => partial.block));
  return result;
}
