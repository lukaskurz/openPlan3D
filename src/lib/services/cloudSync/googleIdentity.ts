import { CloudAuthError } from './types';

/**
 * Browser-only Google sign-in (Google Identity Services token model), so Drive sync needs no backend.
 * Google issues one-hour access tokens and no refresh token, and a new token can only be requested
 * from a click or tap. Sync therefore pauses when a token expires and resumes with one tap; when the
 * user is still signed in to Google, the popup closes by itself.
 */
const SCRIPT = 'https://accounts.google.com/gsi/client';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'openplan3d-google-token';

interface TokenResponse { access_token?: string; expires_in?: number | string; scope?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void }
interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string; scope: string; prompt?: string; login_hint?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }): TokenClient;
}

export interface GoogleToken { value: string; expiresAt: number; hint?: string }

let loading: Promise<GoogleOAuth> | null = null;

const oauth = () => (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts?.oauth2;

/** Load Google's library ahead of time: a token request must start synchronously inside the user's tap. */
export function preloadGoogleIdentity(): Promise<GoogleOAuth> {
  const ready = oauth();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GoogleOAuth>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => { const api = oauth(); if (api) resolve(api); else reject(new Error('Google sign-in could not be loaded.')); };
    script.onerror = () => { loading = null; script.remove(); reject(new Error('Google could not be reached. Check your connection and try again.')); };
    document.head.append(script);
  });
  return loading;
}

/** Call directly from a click or tap handler, before any await, or the browser blocks Google's popup. */
export function requestGoogleToken(clientId: string, hint?: string): Promise<GoogleToken> {
  const api = oauth();
  if (!api) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
  return new Promise((resolve, reject) => {
    const client = api.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      login_hint: hint,
      callback: response => {
        // With granular consent people can leave Drive access unticked; sync cannot work without it.
        if (response.error || !response.access_token) { reject(new CloudAuthError(response.error_description || 'Google Drive was not connected.')); return; }
        if (!response.scope?.split(' ').includes(DRIVE_SCOPE)) { reject(new CloudAuthError('Allow openPlan3D to use its files in your Google Drive to sync.')); return; }
        resolve({ value: response.access_token, expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000, hint });
      },
      error_callback: error => reject(new CloudAuthError(error.type === 'popup_failed_to_open'
        ? 'Allow pop-ups for this site to connect Google Drive.' : 'Google Drive was not connected.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

/** The current token survives reloads and other tabs until it expires. It only reaches files this app created (drive.file). */
export function storedGoogleToken(): GoogleToken | null {
  try {
    const token = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as GoogleToken | null;
    return token && typeof token.value === 'string' && token.expiresAt - 60_000 > Date.now() ? token : null;
  } catch { return null; }
}

export function storeGoogleToken(token: GoogleToken | null) {
  try { if (token) localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); else localStorage.removeItem(TOKEN_KEY); } catch { /* Kept in memory this visit. */ }
}

/** The account's email, kept after the token expires so resuming preselects the same account. */
export function googleHint(): string | undefined {
  try { return (JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as GoogleToken | null)?.hint; } catch { return undefined; }
}
