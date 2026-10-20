import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Access } from '$lib/server/assistantAuth';
import {
  BucketBudgetStore, budgetKey, budgetLimits, chargeBudget, costMicros, MemoryBudgetStore,
  type BudgetSnapshot, type BudgetState, type BudgetStore,
} from '$lib/server/assistantBudget';
import { handleAssistantChat, resetChatLimits } from '$lib/server/assistantChat';

const NOW = Date.UTC(2026, 9, 20, 18); // 6 hours before midnight UTC, 12 days before November
const ANN = 'ann@example.com';
const limits = { dailyMicros: 5_000_000, monthlyMicros: 50_000_000 };
const env = { ANTHROPIC_API_KEY: 'key', ASSISTANT_CHAT_UPSTREAM: 'http://fake' };
const signedIn = async (): Promise<Access> => ({ access: 'allowed', email: ANN, uid: 'uid-ann' });
const hello = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
const chatRequest = () => new Request('http://local/api/assistant/chat', { method: 'POST', body: JSON.stringify(hello), headers: { 'content-type': 'application/json' } });

/** An upstream reply with cache use, split at awkward places. */
function upstream(model = 'claude-opus-5-5') {
  const events = [
    { type: 'message_start', message: { model, usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 5000, cache_creation_input_tokens: 2000 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello there' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 300 } },
    { type: 'message_stop' },
  ];
  const bytes = new TextEncoder().encode(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  return new Response(new ReadableStream({
    start(controller) { for (let i = 0; i < bytes.length; i += 17) controller.enqueue(bytes.slice(i, i + 17)); controller.close(); },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
/** Opus: 100 × 4 + 300 × 20 + 5000 × 0.2 + 2000 × 5 micro-dollars. */
const CALL = 17_400;

const seed = (store: MemoryBudgetStore, state: Omit<BudgetState, 'version'>) => store.entries.set(budgetKey(ANN), { state: { version: 1, ...state }, version: 1 });
const chat = (store: BudgetStore, fetchImpl: typeof fetch = (async () => upstream()) as typeof fetch, now = NOW) =>
  handleAssistantChat(chatRequest(), { env, client: 'ip', fetchImpl, now, access: signedIn, budget: { store, limits } });

describe('assistant budget', () => {
  beforeEach(() => { resetChatLimits(); vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('prices calls by the served model, cache tokens included', () => {
    const usage = { input: 1000, output: 2000, cacheRead: 10_000, cacheWrite: 3000 };
    expect(costMicros('claude-opus-5-5', usage)).toBe(61_000);
    expect(costMicros('claude-opus-5-5-20261001', usage)).toBe(61_000);
    expect(costMicros('claude-sonnet-5-5', usage)).toBe(31_500);
    expect(costMicros('claude-fable-5-1', usage)).toBe(150_000);
    expect(costMicros('claude-mystery-9', usage)).toBe(150_000);
    expect(budgetLimits({})).toEqual(limits);
    expect(budgetLimits({ ASSISTANT_DAILY_USD: '2.5', ASSISTANT_MONTHLY_USD: 'lots' })).toEqual({ dailyMicros: 2_500_000, monthlyMicros: 50_000_000 });
  });

  it('charges what the stream used once it ends, and logs the cost', async () => {
    const store = new MemoryBudgetStore();
    const log = vi.mocked(console.log);
    const response = await chat(store);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Hello there');
    expect(store.entries.get(budgetKey(ANN))?.state).toEqual({ version: 1, day: '2026-10-20', daySpent: CALL, month: '2026-10', monthSpent: CALL });
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toEqual({ event: 'assistant_chat', model: 'claude-opus-5-5', input: 100, output: 300, cacheRead: 5000, cacheWrite: 2000, usd: 0.0174 });
    await (await chat(store)).text();
    expect(store.entries.get(budgetKey(ANN))?.state.daySpent).toBe(2 * CALL);
  });

  it('charges a model it doesn’t know at the highest price', async () => {
    const store = new MemoryBudgetStore();
    await (await chat(store, (async () => upstream('claude-fallback-1')) as typeof fetch)).text();
    expect(store.entries.get(budgetKey(ANN))?.state.daySpent).toBe(100 * 10 + 300 * 50 + 5000 * 0.25 + 2000 * 12.5);
  });

  it('refuses once today’s budget is used, until midnight UTC', async () => {
    const store = new MemoryBudgetStore();
    seed(store, { day: '2026-10-20', daySpent: 5_000_000, month: '2026-10', monthSpent: 5_000_000 });
    const fetchImpl = vi.fn(async () => upstream());
    const response = await chat(store, fetchImpl as unknown as typeof fetch);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String(6 * 3600));
    expect(await response.json()).toEqual({ error: 'You have used today’s assistant budget. It resets at midnight UTC.', code: 'budget' });
    expect(fetchImpl).not.toHaveBeenCalled();
    // The next UTC day starts afresh; the month keeps counting.
    const tomorrow = Date.UTC(2026, 9, 21, 0, 0, 1);
    const next = await chat(store, fetchImpl as unknown as typeof fetch, tomorrow);
    expect(next.status).toBe(200);
    await next.text();
    expect(store.entries.get(budgetKey(ANN))?.state).toEqual({ version: 1, day: '2026-10-21', daySpent: CALL, month: '2026-10', monthSpent: 5_000_000 + CALL });
  });

  it('refuses once this month’s budget is used, until the 1st', async () => {
    const store = new MemoryBudgetStore();
    seed(store, { day: '2026-10-19', daySpent: 4_000_000, month: '2026-10', monthSpent: 50_000_100 });
    const response = await chat(store);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(String((Date.UTC(2026, 10, 1) - NOW) / 1000));
    expect(await response.json()).toEqual({ error: 'You have used this month’s assistant budget. It resets on the 1st.', code: 'budget' });
    const november = await chat(store, undefined, Date.UTC(2026, 10, 1, 9));
    expect(november.status).toBe(200);
    await november.text();
    expect(store.entries.get(budgetKey(ANN))?.state).toEqual({ version: 1, day: '2026-11-01', daySpent: CALL, month: '2026-11', monthSpent: CALL });
  });

  it('retries the charge when another instance wrote first', async () => {
    const store = new MemoryBudgetStore();
    let conflicts = 2;
    const racing: BudgetStore = {
      read: key => store.read(key),
      async write(key, previous, state) {
        // Another instance charges 1000 between our read and our write.
        if (conflicts-- > 0) await chargeBudget(store, ANN, 1000, NOW);
        return store.write(key, previous, state);
      },
    };
    await chargeBudget(racing, ANN, CALL, NOW);
    expect(store.entries.get(budgetKey(ANN))?.state.daySpent).toBe(2000 + CALL);
    const stuck: BudgetStore = { read: async () => null, write: async () => false };
    await expect(chargeBudget(stuck, ANN, CALL, NOW)).rejects.toThrow();
  });

  it('never breaks the reply when charging fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new MemoryBudgetStore();
    const broken: BudgetStore = { read: key => store.read(key), write: async () => { throw new Error('storage down'); } };
    const response = await chat(broken);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('message_stop');
    expect(error.mock.calls.map(call => JSON.parse(call[0]))).toContainEqual({ event: 'assistant_budget_charge_failed' });
  });

  it('fails closed when the ledger can’t be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => upstream());
    const response = await chat({ read: async () => { throw new Error('down'); }, write: async () => false }, fetchImpl as unknown as typeof fetch);
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps one zero-byte bucket object per person, named without the email', async () => {
    const objects = new Map<string, { metadata: Record<string, string>; metageneration: number }>();
    const calls: string[] = [];
    const storage = {
      async create(name: string, bytes: Uint8Array, metadata: Record<string, string> = {}) {
        calls.push(`create ${name} ${bytes.byteLength}`);
        if (objects.has(name)) return false;
        objects.set(name, { metadata, metageneration: 1 });
        return true;
      },
      async metadata(name: string) {
        const object = objects.get(name);
        return object ? { metadata: object.metadata, generation: '1', metageneration: String(object.metageneration), size: 0 } : null;
      },
      async patchMetadata(name: string, metadata: Record<string, string>, metageneration: string) {
        calls.push(`patch ${name} ${metageneration}`);
        const object = objects.get(name);
        if (!object || String(object.metageneration) !== metageneration) return false;
        objects.set(name, { metadata, metageneration: object.metageneration + 1 });
        return true;
      },
    };
    const store = new BucketBudgetStore(storage);
    await chargeBudget(store, 'Ann@Example.com', 500, NOW);
    await chargeBudget(store, ANN, 700, NOW);
    const name = budgetKey(ANN);
    expect(name).toMatch(/^_system\/assistant-budget-[0-9a-f]{40}$/);
    expect(name).not.toContain('ann');
    expect(calls).toEqual([`create ${name} 0`, `patch ${name} 1`]);
    expect(JSON.parse(objects.get(name)!.metadata.budget)).toEqual({ version: 1, day: '2026-10-20', daySpent: 1200, month: '2026-10', monthSpent: 1200 });
    const snapshot = await store.read(name) as BudgetSnapshot;
    expect(snapshot.version).toBe('2');
  });
});
