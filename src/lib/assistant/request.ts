import { ASSISTANT_CONFIG, ASSISTANT_SYSTEM_PROMPT, ASSISTANT_TOOLS } from './definitions';
import { REVIEWER_MODEL, REVIEWER_SYSTEM_PROMPT, REVIEWER_TOOLS, type AssistantAgent } from './reviewer';

type Block = Record<string, unknown>;
interface Message { role: 'user' | 'assistant'; content: Block[] }

/**
 * The Messages API request for a conversation: the model, fixed prompt and
 * tools, with the prompt, tools and conversation so far
 * cached. Used by the server and, with the person's own key, by the browser.
 * The reviewer has its own model, prompt and read-only tools.
 * Send it with the ASSISTANT_BETAS header.
 */
export function buildMessagesRequest(messages: Message[], agent?: AssistantAgent) {
  const config = agent === 'reviewer' ? REVIEWER_MODEL : ASSISTANT_CONFIG;
  const toolList = agent === 'reviewer' ? REVIEWER_TOOLS : ASSISTANT_TOOLS;
  const tools = toolList.map((tool, i) => i === toolList.length - 1 ? { ...tool, cache_control: { type: 'ephemeral' } } : tool);
  const last = messages[messages.length - 1];
  const cached = [...messages.slice(0, -1), { ...last, content: last.content.map((block, i) => i === last.content.length - 1 ? { ...block, cache_control: { type: 'ephemeral' } } : block) }];
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    // Progress notes between tool calls show in the panel during long turns. Older turns get trimmed between
    // messages, which invalidates their thinking blocks: drop those instead of failing.
    thinking: { type: 'adaptive', display: 'updates', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
    output_config: { effort: config.effort },
    fallbacks: 'default',
    system: [{ type: 'text', text: agent === 'reviewer' ? REVIEWER_SYSTEM_PROMPT : ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools,
    messages: cached,
    stream: true,
  };
}
