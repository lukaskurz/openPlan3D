import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessConfig, googlePublicKeys, parseAllowlist, resolveAccess, verifyFirebaseToken, type KeyLookup } from '$lib/server/assistantAuth';
import { describeAssistantAccess, handleAssistantChat, resetChatLimits } from '$lib/server/assistantChat';
import { budgetKey, MemoryBudgetStore } from '$lib/server/assistantBudget';

const NOW = Date.UTC(2026, 9, 20, 12);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys: KeyLookup = async kid => kid === 'k1' ? publicKey : null;

const claims = {
  aud: 'openplan3d', iss: 'https://securetoken.google.com/openplan3d', sub: 'uid-ann',
  iat: NOW / 1000 - 60, exp: NOW / 1000 + 3600, email: 'Ann@Example.com', email_verified: true,
};
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(overrides: Record<string, unknown> = {}, { kid = 'k1', key = privateKey as KeyObject, alg = 'RS256' } = {}) {
  const head = b64({ alg, kid, typ: 'JWT' }), body = b64({ ...claims, ...overrides });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}
const verifyAt = (t: string) => verifyFirebaseToken(t, { projectId: 'openplan3d', keys, now: NOW });

describe('Firebase ID tokens', () => {
  it('accepts a current, verified sign-in and lowercases the email', async () => {
    expect(await verifyAt(token())).toEqual({ uid: 'uid-ann', email: 'ann@example.com' });
  });

  it('rejects the wrong project, expired or future tokens, unverified emails, unknown keys and bad signatures', async () => {
    expect(await verifyAt(token({ aud: 'someone-else' }))).toBeNull();
    expect(await verifyAt(token({ iss: 'https://securetoken.google.com/someone-else' }))).toBeNull();
    expect(await verifyAt(token({ exp: NOW / 1000 - 1 }))).toBeNull();
    expect(await verifyAt(token({ iat: NOW / 1000 + 600 }))).toBeNull();
    expect(await verifyAt(token({ iat: NOW / 1000 + 30 }))).not.toBeNull();
    expect(await verifyAt(token({ email_verified: false }))).toBeNull();
    expect(await verifyAt(token({ email: undefined }))).toBeNull();
    expect(await verifyAt(token({ sub: '' }))).toBeNull();
    expect(await verifyAt(token({}, { kid: 'k2' }))).toBeNull();
    expect(await verifyAt(token({}, { key: other.privateKey }))).toBeNull();
    expect(await verifyAt(token({}, { alg: 'HS256' }))).toBeNull();
    const [head, , sig] = token().split('.');
    expect(await verifyAt(`${head}.${b64({ ...claims, email: 'mallory@example.com' })}.${sig}`)).toBeNull();
    expect(await verifyAt('not-a-token')).toBeNull();
  });

  it('caches Google’s certificates for their max-age', async () => {
    const pem = `-----BEGIN CERTIFICATE-----
MIIC/zCCAeegAwIBAgIUbvUtszMUw4mf2U2K0bCh63c9ZeUwDQYJKoZIhvcNAQEL
BQAwDzENMAsGA1UEAwwEdGVzdDAeFw0yNjEwMjAyMDM1MzNaFw0zNjEwMTcyMDM1
MzNaMA8xDTALBgNVBAMMBHRlc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEK
AoIBAQCzlhIFcyr5jT33HFqdrd6zHGhQpBmcLXcg8zArrt16GRMHroRR9T2qGspk
+GnUnOefnlOehBcbOquvXIoSXTUQTHMCaAvC9m6vF1w1c+I7v+mhVrQ/vjVeLTWn
fJgzjOrIsn+tm/KoK1y4GF/l9vTmx+zLT6kSA5JDJ9voy+7uSu2JsFlwwnQIjBZJ
N9bHZMEmqp7qI1ftvfqTPuH9MH+Y799q7ajgnj541PjH1T7DWgycHa+Qnu9fB6lE
BN+wWnYYjPUlrYzWEfgUzvrW3ASxo25Pdj9ZGexqR/4KgVbWXgeQzg94T/TWN58P
IxCuqQtUtRn7BO7vmby8ur02/FfVAgMBAAGjUzBRMB0GA1UdDgQWBBQwOi0dDszG
JzOqee7p8QF66yGxIDAfBgNVHSMEGDAWgBQwOi0dDszGJzOqee7p8QF66yGxIDAP
BgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBxSBqXUELnWHzvXkZ1
JbEQ0hbRNAdhJphHRuQKo69ZuOrL9IEZh/WgX1E9lum22raDwQsjilwwUMfPGYQJ
IQJWtDmzwnMb9d4QjithzPSRIvpP06RQcVMjpQsyShAFSnFX60B8dWp6+R1jYHTV
rF1ZQlETaqRCJcilC103OarMZiSqwMZ29Qc4glNIMcFA4+C7sTMnohTaZpJ7Bd3g
eAIKAJslN+A0Tb+kOScApOKDt/9tEIDmIzeKK3Bozux+ne+VN3FmeXyYgGdaflTb
PtnKJkXtxPGZaLJtCiAoG5sdpwUTyNQRTHQTobR5vaPNbOmPX8fZ3pHBXbNRDecy
B752
-----END CERTIFICATE-----
`;
    let clock = NOW;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ c1: pem }), { headers: { 'Cache-Control': 'public, max-age=100, must-revalidate' } }));
    const lookup = googlePublicKeys(fetchImpl as unknown as typeof fetch, () => clock);
    expect((await lookup('c1'))?.asymmetricKeyType).toBe('rsa');
    expect(await lookup('c1')).not.toBeNull();
    expect(await lookup('rotated')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock += 101_000;
    await lookup('c1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const failing = googlePublicKeys((async () => new Response('', { status: 500 })) as typeof fetch, () => clock);
    await expect(failing('c1')).rejects.toThrow();
  });
});

// ── Access ──────────────────────────────────────────────────────────

const hello = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
const chatRequest = (auth?: string) => new Request('http://local/api/assistant/chat', {
  method: 'POST', body: JSON.stringify(hello), headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
});
const env = { ANTHROPIC_API_KEY: 'key', ASSISTANT_CHAT_UPSTREAM: 'http://fake' };
const okStream = () => new Response(
  `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 1 } } })}\n\n` +
  `event: message_stop\ndata: {"type":"message_stop"}\n\n`,
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
);
const access = (allowed: string | undefined, dev = false) => {
  const config = { ...accessConfig({ ASSISTANT_ALLOWED_EMAILS: allowed }, dev), keys };
  return (request: Request) => resolveAccess(request, config, NOW);
};

describe('assistant access', () => {
  beforeEach(() => { resetChatLimits(); vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('reads the allowlist trimmed and lowercased', () => {
    expect(parseAllowlist(' Ann@Example.com , bob@example.com,')).toEqual(new Set(['ann@example.com', 'bob@example.com']));
    expect(parseAllowlist(' , ')).toBeNull();
    expect(parseAllowlist(undefined)).toBeNull();
    expect(accessConfig({}, false).projectId).toBe('openplan3d');
    expect(accessConfig({ ASSISTANT_FIREBASE_PROJECT: 'other' }, false).projectId).toBe('other');
  });

  it('asks for sign-in without a valid token, and turns away people not on the list', async () => {
    const fetchImpl = vi.fn(async () => okStream());
    const run = (auth?: string) => handleAssistantChat(chatRequest(auth), { env, client: 'ip', fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW, access: access('ann@example.com') });
    for (const auth of [undefined, 'Bearer nonsense', `Bearer ${token({ exp: NOW / 1000 - 10 })}`, `Basic ${token()}`]) {
      const response = await run(auth);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Sign in to use the assistant.', code: 'sign-in' });
    }
    const stranger = await run(`Bearer ${token({ email: 'eve@example.com' })}`);
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: 'This assistant is only for invited people. Ask the owner to add your email, or use your own API key.', code: 'not-allowed' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const ann = await run(`Bearer ${token()}`);
    expect(ann.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('is off in production without an allowlist and open under vite dev', async () => {
    const fetchImpl = vi.fn(async () => okStream()) as unknown as typeof fetch;
    const production = await handleAssistantChat(chatRequest(), { env, client: 'ip', fetchImpl, now: NOW, access: access(undefined) });
    expect(production.status).toBe(503);
    expect(await production.json()).toEqual({ error: 'The assistant isn’t set up on this server.' });
    const store = new MemoryBudgetStore();
    const development = await handleAssistantChat(chatRequest(), { env, client: 'ip', fetchImpl, now: NOW, access: access(undefined, true), budget: { store, limits: { dailyMicros: 0, monthlyMicros: 0 } } });
    expect(development.status).toBe(200);
    await development.text();
    expect(store.entries.size).toBe(0);
  });

  it('counts calls per signed-in person, whatever their address', async () => {
    const fetchImpl = (async () => okStream()) as unknown as typeof fetch;
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) {
      last = await handleAssistantChat(chatRequest(`Bearer ${token()}`), { env, client: `ip-${i}`, fetchImpl, now: NOW, access: access('ann@example.com') });
      await last.body?.cancel();
    }
    expect(last!.status).toBe(429);
  });
});

// ── /api/assistant/me ───────────────────────────────────────────────

describe('assistant me', () => {
  const me = (auth: string | undefined, options: Partial<Parameters<typeof describeAssistantAccess>[1]> = {}) =>
    describeAssistantAccess(chatRequest(auth), { env, access: access('ann@example.com'), now: NOW, ...options });

  it('describes each kind of caller', async () => {
    expect(await me(undefined, { env: {} })).toEqual({ available: false });
    expect(await me(undefined, { access: access(undefined) })).toEqual({ available: false });
    expect(await me(undefined, { access: access(undefined, true) })).toEqual({ available: true, access: 'open' });
    expect(await me(undefined)).toEqual({ available: true, access: 'sign-in' });
    expect(await me('Bearer broken')).toEqual({ available: true, access: 'sign-in' });
    expect(await me(`Bearer ${token({ email: 'Eve@example.com' })}`)).toEqual({ available: true, access: 'not-allowed', email: 'eve@example.com' });
    const store = new MemoryBudgetStore();
    store.entries.set(budgetKey('ann@example.com'), { state: { version: 1, day: '2026-10-20', daySpent: 1_234_567, month: '2026-10', monthSpent: 12_345_678 }, version: 1 });
    expect(await me(`Bearer ${token()}`, { budget: { store, limits: { dailyMicros: 5_000_000, monthlyMicros: 50_000_000 } } })).toEqual({
      available: true, access: 'allowed', email: 'ann@example.com',
      budget: { day: { spentUsd: 1.23, limitUsd: 5 }, month: { spentUsd: 12.35, limitUsd: 50 } },
    });
  });

  it('reports the assistant unavailable when Google’s keys can’t be fetched', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = async () => { throw new Error('offline'); };
    const config = { ...accessConfig({ ASSISTANT_ALLOWED_EMAILS: 'ann@example.com' }, false), keys: failing };
    expect(await me(`Bearer ${token()}`, { access: request => resolveAccess(request, config, NOW) })).toEqual({ available: false });
  });
});
