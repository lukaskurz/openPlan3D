import { afterAll, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { streamTurn, type ApiMessage } from '$lib/assistant/stream';
import { ASSISTANT_TOOLS } from '$lib/assistant/definitions';
import { REVIEWER_TOOLS } from '$lib/assistant/reviewer';

process.env.ASSISTANT_DEV_CLAUDE_BIN = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const { handleDevChat } = await import('$lib/server/assistantDevClaude');

afterAll(() => { delete process.env.ASSISTANT_DEV_CLAUDE_BIN; });

const via = (conversation: string) => (async (_url: string | URL | Request, init?: RequestInit) =>
  handleDevChat(new Request('http://local/api/assistant/chat', { method: 'POST', body: init!.body as string }))) as typeof fetch;

it('runs a conversation through claude -p, with tool calls answered by the browser', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const conversation = 'test-conversation-1';
  const messages: ApiMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'What is here?' }] }];
  const first = await streamTurn(messages, { fetchImpl: via(conversation), conversation });
  expect(first.stopReason).toBe('tool_use');
  expect(first.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'get_plan', input: {} }]);
  messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'A plan with one room' }] });
  const second = await streamTurn(messages, { fetchImpl: via(conversation), conversation });
  expect(second.stopReason).toBe('end_turn');
  expect(second.content).toEqual([{ type: 'text', text: `Saw: A plan with one room (${ASSISTANT_TOOLS.length} tools, turn 1, "What is here?")` }]);
  // The same process takes the next message.
  messages.push({ role: 'assistant', content: second.content }, { role: 'user', content: [{ type: 'text', text: 'And now?' }] });
  const third = await streamTurn(messages, { fetchImpl: via(conversation), conversation });
  expect(third.content).toEqual([{ type: 'tool_use', id: 'toolu_2', name: 'get_plan', input: {} }]);
  messages.push({ role: 'assistant', content: third.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'Still one room' }] });
  const fourth = await streamTurn(messages, { fetchImpl: via(conversation), conversation });
  expect(fourth.content[0]).toMatchObject({ text: expect.stringContaining('turn 2, "And now?"') });
}, 20_000);

it('runs a review in its own process with the reviewer’s tools, and ends it after the answer', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const conversation = 'test-conversation-1-review-1';
  const via = (async (_url: string | URL | Request, init?: RequestInit) =>
    handleDevChat(new Request('http://local/api/assistant/chat', { method: 'POST', body: init!.body as string }))) as typeof fetch;
  const messages: ApiMessage[] = [{ role: 'user', content: [{ type: 'text', text: 'Review this' }] }];
  const first = await streamTurn(messages, { fetchImpl: via, conversation, agent: 'reviewer' });
  expect(first.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'get_plan', input: {} }]);
  messages.push({ role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'The plan' }] });
  const second = await streamTurn(messages, { fetchImpl: via, conversation, agent: 'reviewer' });
  expect(second.content).toEqual([{ type: 'text', text: `Saw: The plan (${REVIEWER_TOOLS.length} tools, turn 1, "Review this")` }]);
  // Its process has ended: more results for it are refused.
  messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'y', name: 'get_plan', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'y', content: 'plan' }] });
  await expect(streamTurn(messages, { fetchImpl: via, conversation, agent: 'reviewer' })).rejects.toMatchObject({ status: 409 });
}, 20_000);

it('asks for the message again when tool results arrive for a process that is gone', async () => {
  const messages: ApiMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'get_plan', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'plan' }] },
  ];
  await expect(streamTurn(messages, { fetchImpl: via('missing-conversation'), conversation: 'missing-conversation' })).rejects.toMatchObject({ status: 409 });
});
