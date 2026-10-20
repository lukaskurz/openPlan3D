import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createDefaultProject, loadProject } from '$lib/stores/project';
import { applyStreamEvent, streamTurn, ANTHROPIC_MESSAGES_URL, ASSISTANT_ENDPOINT, AssistantRequestError, type TurnResult } from '$lib/assistant/stream';
import { createAccount, parseAccess, ACCOUNT_ENDPOINT, type AuthLayer, type AuthUser } from '$lib/assistant/account';
import { assistant, send, newConversation, progressNote, type AssistantState } from '$lib/assistant/session';
import { assistantApiKey } from '$lib/assistant/apiKey';

// The session asks the account module for a token; Firebase itself never loads in tests.
vi.mock('$lib/assistant/account', async original => ({ ...(await original<typeof import('$lib/assistant/account')>()), idToken: vi.fn(async () => 'session-token') }));

const hello = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }];

function sse(events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** A reply that thinks out loud in two notes, then answers. */
const thinkingReply = () => sse([
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reading the plan.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '\nMeasuring the living room.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'It is 20 m².' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('stream access', () => {
  it('sends the ID token to openPlan3D’s server only', async () => {
    const fetchImpl = vi.fn(async () => sse([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }]));
    await streamTurn(hello, { fetchImpl: fetchImpl as typeof fetch, idToken: 'tok' });
    expect((fetchImpl.mock.calls[0] as any)[0]).toBe(ASSISTANT_ENDPOINT);
    expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer tok');
    await streamTurn(hello, { fetchImpl: fetchImpl as typeof fetch });
    expect((fetchImpl.mock.calls[1] as any)[1].headers).not.toHaveProperty('Authorization');
    // The person's own key goes to Anthropic, never with the Firebase token.
    await streamTurn(hello, { fetchImpl: fetchImpl as typeof fetch, apiKey: 'sk-ant-test', idToken: 'tok' });
    const [url, init] = fetchImpl.mock.calls[2] as any;
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(Object.keys(init.headers).map(key => key.toLowerCase())).not.toContain('authorization');
    expect(JSON.stringify(init.headers)).not.toContain('tok"');
  });

  it('reads the access code from the server’s error', async () => {
    const fail = (body: unknown, status: number) => streamTurn(hello, { fetchImpl: (async () => json(body, status)) as typeof fetch }).catch(error => error);
    const signIn = await fail({ error: 'Sign in with Google to use the assistant.', code: 'sign-in' }, 401);
    expect(signIn).toBeInstanceOf(AssistantRequestError);
    expect(signIn).toMatchObject({ status: 401, code: 'sign-in', message: 'Sign in with Google to use the assistant.' });
    expect(await fail({ error: 'Not invited.', code: 'not-allowed' }, 403)).toMatchObject({ code: 'not-allowed' });
    expect(await fail({ error: 'Budget used.', code: 'budget' }, 429)).toMatchObject({ code: 'budget', message: 'Budget used.' });
    expect((await fail({ error: 'Down.' }, 503)).code).toBeUndefined();
    expect((await fail({ error: 'Odd.', code: 'other' }, 400)).code).toBeUndefined();
  });

  it('reports progress notes and keeps the thinking block unchanged', async () => {
    const notes: string[] = [];
    const result = await streamTurn(hello, { fetchImpl: (async () => thinkingReply()) as typeof fetch, onThinking: text => notes.push(text) });
    expect(notes).toEqual(['Reading the plan.', 'Reading the plan.\nMeasuring the living room.']);
    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Reading the plan.\nMeasuring the living room.', signature: 'sig' },
      { type: 'text', text: 'It is 20 m².' },
    ]);
    // Without a listener, nothing changes.
    const blocks = new Map();
    const turn: TurnResult = { content: [], stopReason: null };
    applyStreamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }, blocks, turn, () => {});
    applyStreamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x' } }, blocks, turn, () => {});
    expect(blocks.get(0).block).toEqual({ type: 'thinking', thinking: 'x', signature: '' });
  });
});

describe('progress notes', () => {
  it('shows the last line, cut to whole sentences', () => {
    expect(progressNote('')).toBeNull();
    expect(progressNote('First.\n\n**Now the kitchen.**')).toBe('Now the kitchen.');
    const long = `${'The walls are drawn along their centre lines. '.repeat(3)}Now the doors.`;
    expect(progressNote(long)).toBe('The walls are drawn along their centre lines. The walls are drawn along their centre lines. Now the doors.');
    const sentence = 'word '.repeat(40).trim();
    const cut = progressNote(sentence)!;
    expect(cut.length).toBeLessThanOrEqual(120);
    expect(cut.endsWith('…')).toBe(true);
  });

  it('shows notes while the model works, sends the token, and saves none of it', async () => {
    loadProject(createDefaultProject('Notes'));
    newConversation();
    assistantApiKey.set('');
    const fetchMock = vi.fn(async () => thinkingReply());
    vi.stubGlobal('fetch', fetchMock);
    const seen: AssistantState[] = [];
    const stopWatching = assistant.subscribe(state => seen.push(state));
    await send('How big is the living room?');
    stopWatching();
    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer session-token');
    const notes = seen.map(state => state.note).filter(Boolean);
    expect(notes).toEqual(['Reading the plan.', 'Measuring the living room.']);
    // Reply text takes over from the note, and the turn ends with none.
    const firstText = seen.findIndex(state => state.items.some(item => item.kind === 'assistant'));
    expect(seen[firstText].note).toBeNull();
    expect(get(assistant)).toMatchObject({ busy: false, activity: null, note: null });
    expect(JSON.stringify(get(assistant).items)).not.toContain('Measuring');
  });

  it('shows the server’s access message without a retry', async () => {
    loadProject(createDefaultProject('Budget'));
    newConversation();
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'You’ve used today’s $5.', code: 'budget' }, 429)));
    await send('Hello');
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'error', error: 'budget', message: 'You’ve used today’s $5.', retry: false });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Sign in first.', code: 'sign-in' }, 401)));
    await send('Hello again');
    expect(get(assistant).items.at(-1)).toMatchObject({ kind: 'error', error: 'signIn', retry: false });
  });
});

describe('account', () => {
  it('reads /me replies and ignores anything unexpected', () => {
    expect(parseAccess({ available: false })).toEqual({ available: false });
    expect(parseAccess({ available: true, access: 'open' })).toEqual({ available: true, access: 'open' });
    expect(parseAccess({ available: true, access: 'sign-in' })).toEqual({ available: true, access: 'sign-in' });
    expect(parseAccess({ available: true, access: 'not-allowed', email: 'a@b.c' })).toEqual({ available: true, access: 'not-allowed', email: 'a@b.c' });
    const budget = { day: { spentUsd: 1.2, limitUsd: 5 }, month: { spentUsd: 8.4, limitUsd: 50 } };
    expect(parseAccess({ available: true, access: 'allowed', email: 'a@b.c', budget })).toEqual({ available: true, access: 'allowed', email: 'a@b.c', budget });
    // Spend the server couldn't read: still allowed, just without the budget line.
    expect(parseAccess({ available: true, access: 'allowed', email: 'a@b.c', budget: { day: {} } })).toEqual({ available: true, access: 'allowed', email: 'a@b.c' });
    expect(parseAccess({ available: true, access: 'allowed', email: 'a@b.c' })).toEqual({ available: true, access: 'allowed', email: 'a@b.c' });
    expect(parseAccess({ available: true, access: 'admin' })).toBeNull();
    expect(parseAccess(null)).toBeNull();
  });

  /** A stand-in for Firebase Auth: one restored session, and sign-in/out that report back like Firebase does. */
  const person = (email: string): AuthUser => ({ email, getIdToken: vi.fn(async () => `token-${email}`) });

  function fakeAuth(restored: AuthUser | null) {
    let listener: (user: AuthUser | null) => void = () => {};
    const layer: AuthLayer = {
      onChange: next => { listener = next; queueMicrotask(() => listener(restored)); },
      signIn: vi.fn(async () => { listener(person('ana@family.test')); }),
      signOut: vi.fn(async () => { listener(null); }),
    };
    return { layer };
  }

  function server() {
    const budget = { day: { spentUsd: 0.5, limitUsd: 5 }, month: { spentUsd: 3, limitUsd: 50 } };
    return vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (!auth) return json({ available: true, access: 'sign-in' });
      if (auth === 'Bearer token-ana@family.test') return json({ available: true, access: 'allowed', email: 'ana@family.test', budget });
      return json({ available: true, access: 'not-allowed', email: auth.replace('Bearer token-', '') });
    });
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('goes from signed out to signed in with a budget and back', async () => {
    const { layer } = fakeAuth(null);
    const fetchImpl = server();
    const { account, refresh, signIn, signOut, idToken } = createAccount({ loadAuth: async () => layer, fetchImpl: fetchImpl as typeof fetch });
    expect(get(account)).toMatchObject({ ready: false, access: null });
    expect(await refresh()).toEqual({ available: true, access: 'sign-in' });
    expect(fetchImpl.mock.calls[0][0]).toBe(ACCOUNT_ENDPOINT);
    expect(get(account)).toMatchObject({ ready: true, email: null, access: { access: 'sign-in' } });
    expect(await idToken()).toBeUndefined();

    await signIn();
    await settle();
    expect(get(account)).toMatchObject({ email: 'ana@family.test', signingIn: false, signInFailed: false, access: { access: 'allowed', budget: { day: { spentUsd: 0.5, limitUsd: 5 } } } });
    expect(await idToken()).toBe('token-ana@family.test');

    await signOut();
    await settle();
    expect(get(account)).toMatchObject({ email: null, access: { access: 'sign-in' } });
    // Loading Firebase and the first /me happened once each, not twice.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('waits for the restored session before asking the server', async () => {
    const { layer } = fakeAuth(person('bo@elsewhere.test'));
    const fetchImpl = server();
    const { account, refresh } = createAccount({ loadAuth: async () => layer, fetchImpl: fetchImpl as typeof fetch });
    await refresh();
    expect(get(account)).toMatchObject({ email: 'bo@elsewhere.test', access: { access: 'not-allowed', email: 'bo@elsewhere.test' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the last answer when the server can’t be reached, and stays signed out when Firebase can’t load', async () => {
    const { layer } = fakeAuth(null);
    let up = true;
    const fetchImpl = vi.fn(async () => { if (!up) throw new TypeError('offline'); return json({ available: true, access: 'open' }); });
    const online = createAccount({ loadAuth: async () => layer, fetchImpl: fetchImpl as typeof fetch });
    await online.refresh();
    up = false;
    expect(await online.refresh()).toBeNull();
    expect(get(online.account).access).toEqual({ available: true, access: 'open' });

    const blocked = createAccount({ loadAuth: async () => { throw new Error('blocked'); }, fetchImpl: (async () => json({ available: false })) as typeof fetch });
    expect(await blocked.refresh()).toEqual({ available: false });
    expect(get(blocked.account)).toMatchObject({ ready: true, email: null });
    expect(await blocked.idToken()).toBeUndefined();
  });

  it('says so when sign-in fails, but not when the person closes the popup', async () => {
    const { layer } = fakeAuth(null);
    const { account, start, signIn } = createAccount({ loadAuth: async () => layer, fetchImpl: (async () => json({ available: true, access: 'sign-in' })) as typeof fetch });
    await start();
    layer.signIn = vi.fn(async () => { throw Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' }); });
    await signIn();
    expect(get(account)).toMatchObject({ signingIn: false, signInFailed: false });
    layer.signIn = vi.fn(async () => { throw Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }); });
    await signIn();
    expect(get(account).signInFailed).toBe(true);
  });
});
