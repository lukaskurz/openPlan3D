import { ASSISTANT_MODELS, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS, assistantMode } from './definitions';

type Block = Record<string, unknown>;
interface Message { role: 'user' | 'assistant'; content: Block[] }

/**
 * The Messages API request for a conversation: the model for the turn's mode,
 * fixed prompt and tools, with the prompt, tools and conversation so far
 * cached. Used by the server and, with the person's own key, by the browser.
 * Send it with the ASSISTANT_BETAS header.
 */
export function buildMessagesRequest(messages: Message[]) {
  const mode = ASSISTANT_MODELS[assistantMode(messages as never)];
  const tools = ASSISTANT_TOOLS.map((tool, i) => i === ASSISTANT_TOOLS.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool);
  const last = messages[messages.length - 1];
  const cached = [...messages.slice(0, -1), { ...last, content: last.content.map((block, i) => i === last.content.length - 1 ? { ...block, cache_control: { type: 'ephemeral' } } : block) }];
  return {
    model: mode.model,
    max_tokens: mode.maxTokens,
    // Older turns get trimmed between messages, which invalidates their thinking blocks: drop those instead of failing.
    thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    ...(mode.effort ? { output_config: { effort: mode.effort } } : {}),
    fallbacks: 'default',
    system: [{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: cached,
    stream: true,
  };
}
