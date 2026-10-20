import { verify, X509Certificate, type KeyObject } from 'node:crypto';

/**
 * Who is calling the Assistant. The browser signs in with Google through
 * Firebase Auth and sends the Firebase ID token; this checks it with Google's
 * published keys (node:crypto, no Admin SDK) and the owner's allowlist, so the
 * server's API key only serves invited people.
 */

export type KeyLookup = (kid: string) => Promise<KeyObject | null>;
export interface VerifiedUser { uid: string; email: string }

/** `open`: development without an allowlist. `unavailable`: production without one. */
export type Access =
  | { access: 'open' }
  | { access: 'unavailable' }
  | { access: 'sign-in' }
  | { access: 'not-allowed'; email: string }
  | { access: 'allowed'; email: string; uid: string };

export interface AccessConfig { allowlist: ReadonlySet<string> | null; dev: boolean; projectId: string; keys: KeyLookup }

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
/** Clocks on Google's side and ours differ a little; a token issued "in the future" by this much still counts. */
const CLOCK_SKEW_S = 60;
const MAX_TOKEN_CHARS = 4096;

/** Google's token-signing keys, cached for the response's max-age; an unknown kid refetches at most once a minute (rotation). */
export function googlePublicKeys(fetchImpl: typeof fetch = fetch, clock = () => Date.now()): KeyLookup {
  let keys = new Map<string, KeyObject>(), expires = 0, fetchedAt = -Infinity;
  let pending: Promise<void> | null = null;
  const refresh = async () => {
    const started = clock();
    const response = await fetchImpl(CERTS_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Token keys unavailable (${response.status})`);
    const certs = await response.json() as Record<string, unknown>;
    const next = new Map<string, KeyObject>();
    for (const [kid, pem] of Object.entries(certs)) if (typeof pem === 'string') next.set(kid, new X509Certificate(pem).publicKey);
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    keys = next; fetchedAt = started; expires = started + maxAge * 1000;
  };
  return async kid => {
    const now = clock();
    if (now >= expires || (!keys.has(kid) && now - fetchedAt > 60_000)) {
      pending ??= refresh().finally(() => { pending = null; });
      await pending;
    }
    return keys.get(kid) ?? null;
  };
}

const defaultKeys = googlePublicKeys();

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

/** The signed-in person, or null for any token that isn't a current, verified Firebase sign-in for this project. Key-fetch failures throw. */
export async function verifyFirebaseToken(token: string, { projectId, keys, now = Date.now() }: { projectId: string; keys: KeyLookup; now?: number }): Promise<VerifiedUser | null> {
  if (token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const header = decodePart(parts[0]), payload = decodePart(parts[1]);
  if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
  const key = await keys(header.kid);
  if (!key) return null;
  let valid = false;
  try { valid = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url')); }
  catch { return null; }
  if (!valid) return null;
  const seconds = now / 1000;
  const { aud, iss, exp, iat, sub, email, email_verified } = payload;
  if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof exp !== 'number' || exp <= seconds || typeof iat !== 'number' || iat > seconds + CLOCK_SKEW_S) return null;
  if (typeof sub !== 'string' || !sub || sub.length > 128) return null;
  if (typeof email !== 'string' || !email.includes('@') || email_verified !== true) return null;
  return { uid: sub, email: email.trim().toLowerCase() };
}

/** Comma-separated emails, compared trimmed and lowercased; null when none are set. */
export function parseAllowlist(value: string | undefined): Set<string> | null {
  const emails = (value ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return emails.length ? new Set(emails) : null;
}

export function accessConfig(env: Record<string, string | undefined>, dev: boolean, keys: KeyLookup = defaultKeys): AccessConfig {
  return { allowlist: parseAllowlist(env.ASSISTANT_ALLOWED_EMAILS), dev, projectId: env.ASSISTANT_FIREBASE_PROJECT?.trim() || 'openplan3d', keys };
}

export function bearerToken(request: Request): string | null {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization')?.trim() ?? '')?.[1] ?? null;
}

/** Without an allowlist, development stays open (as before sign-in existed) and production refuses. */
export async function resolveAccess(request: Request, config: AccessConfig, now = Date.now()): Promise<Access> {
  if (!config.allowlist) return config.dev ? { access: 'open' } : { access: 'unavailable' };
  const token = bearerToken(request);
  const user = token ? await verifyFirebaseToken(token, { projectId: config.projectId, keys: config.keys, now }) : null;
  if (!user) return { access: 'sign-in' };
  return config.allowlist.has(user.email) ? { access: 'allowed', ...user } : { access: 'not-allowed', email: user.email };
}
