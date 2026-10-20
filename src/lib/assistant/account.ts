/**
 * Who is using the Assistant through openPlan3D's server. When deployed, only
 * invited people signed in with Google may use the server's key, each within a
 * daily and monthly budget; `/api/assistant/me` says which case applies. People
 * with their own API key never need this. Firebase Auth is loaded lazily in the
 * browser only, and behind `AuthLayer` so tests can swap it out.
 */
import { get, writable, type Readable } from 'svelte/store';

export const ACCOUNT_ENDPOINT = '/api/assistant/me';

export interface BudgetPeriod { spentUsd: number; limitUsd: number }

/** What `/api/assistant/me` says about the person and the server. */
export type AccountAccess =
  | { available: false }
  | { available: true; access: 'open' }
  | { available: true; access: 'sign-in' }
  | { available: true; access: 'not-allowed'; email: string }
  /** `budget` is missing when the server couldn't read the person's spend. */
  | { available: true; access: 'allowed'; email: string; budget?: { day: BudgetPeriod; month: BudgetPeriod } };

export interface AccountState {
  /** Firebase has said whether someone is signed in (restoring a session takes a moment after load). */
  ready: boolean;
  email: string | null;
  /** The latest `/me` answer; null until one arrives, and it stays as it was when a refresh fails. */
  access: AccountAccess | null;
  /** The sign-in popup is open. */
  signingIn: boolean;
  signInFailed: boolean;
}

export interface AuthUser { email: string | null; getIdToken(): Promise<string> }

/** The few Firebase Auth calls the Assistant needs. */
export interface AuthLayer {
  onChange(listener: (user: AuthUser | null) => void): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const period = (value: any): BudgetPeriod | null =>
  value && Number.isFinite(value.spentUsd) && Number.isFinite(value.limitUsd) ? { spentUsd: value.spentUsd, limitUsd: value.limitUsd } : null;

/** Read a `/me` reply; anything unexpected is null, so the panel behaves as before. */
export function parseAccess(data: any): AccountAccess | null {
  if (data?.available === false) return { available: false };
  if (data?.available !== true) return null;
  const email = typeof data.email === 'string' ? data.email : '';
  switch (data.access) {
    case 'open': return { available: true, access: 'open' };
    case 'sign-in': return { available: true, access: 'sign-in' };
    case 'not-allowed': return { available: true, access: 'not-allowed', email };
    case 'allowed': {
      const day = period(data.budget?.day), month = period(data.budget?.month);
      return { available: true, access: 'allowed', email, ...(day && month ? { budget: { day, month } } : {}) };
    }
  }
  return null;
}

/** Firebase's own codes for a sign-in the person backed out of: not worth an error line. */
const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

export function createAccount(deps: { loadAuth: () => Promise<AuthLayer>; fetchImpl?: typeof fetch }) {
  const state = writable<AccountState>({ ready: false, email: null, access: null, signingIn: false, signInFailed: false });
  let layer: AuthLayer | null = null;
  let user: AuthUser | null = null;
  let started: Promise<void> | null = null;
  let refreshes = 0;

  /** Load Firebase Auth once; resolves when it has reported the restored session (or failed to load). */
  function start(): Promise<void> {
    started ??= new Promise<void>(resolve => {
      deps.loadAuth().then(loaded => {
        layer = loaded;
        loaded.onChange(next => {
          // The first report is the restored session, which the refresh that started us is waiting for.
          const later = get(state).ready;
          const changed = (next?.email ?? null) !== (user?.email ?? null);
          user = next;
          state.update(s => ({ ...s, ready: true, email: next?.email ?? null }));
          resolve();
          // Signing in or out changes what the server allows.
          if (later && changed) void refresh();
        });
      }).catch(() => {
        // Offline or blocked: carry on signed out.
        state.update(s => ({ ...s, ready: true }));
        resolve();
      });
    });
    return started;
  }

  /** A fresh ID token for the server, or undefined when nobody is signed in. Firebase refreshes it as needed. */
  async function idToken(): Promise<string | undefined> {
    if (started) await started;
    try { return user ? await user.getIdToken() : undefined; } catch { return undefined; }
  }

  /** Ask the server what this person may do. Only the newest answer counts. */
  async function refresh(): Promise<AccountAccess | null> {
    const id = ++refreshes;
    await start();
    try {
      const token = await idToken();
      const response = await (deps.fetchImpl ?? fetch)(ACCOUNT_ENDPOINT, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const access = parseAccess(await response.json());
      if (id === refreshes && access) state.update(s => ({ ...s, access }));
      return access;
    } catch { return null; }
  }

  /**
   * Opens Google's popup. Call straight from a tap: iPad Safari blocks popups
   * that open after an await, which is why Firebase is loaded beforehand.
   */
  async function signIn() {
    state.update(s => ({ ...s, signingIn: true, signInFailed: false }));
    try {
      if (!layer) await start();
      if (!layer) throw new Error('Sign-in is unavailable.');
      await layer.signIn();
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      if (!CANCELLED.has(code)) state.update(s => ({ ...s, signInFailed: true }));
    } finally {
      state.update(s => ({ ...s, signingIn: false }));
    }
  }

  async function signOut() {
    try { await layer?.signOut(); } catch { /* already signed out */ }
  }

  return { account: { subscribe: state.subscribe } as Readable<AccountState>, start, idToken, refresh, signIn, signOut };
}

/** Firebase Auth with Google, imported only when first needed (never during SSR). */
async function firebaseAuth(): Promise<AuthLayer> {
  const [{ app }, auth] = await Promise.all([import('$lib/firebase'), import('firebase/auth')]);
  const instance = auth.getAuth(app);
  return {
    onChange: listener => { auth.onAuthStateChanged(instance, listener); },
    signIn: async () => { await auth.signInWithPopup(instance, new auth.GoogleAuthProvider()); },
    signOut: () => auth.signOut(instance),
  };
}

const browser = typeof window !== 'undefined';
const instance = createAccount({
  loadAuth: browser ? firebaseAuth : () => Promise.reject(new Error('No sign-in outside the browser.')),
});

export const account = instance.account;
export const idToken = instance.idToken;
export const refreshAccount = instance.refresh;
export const signIn = instance.signIn;
export const signOut = instance.signOut;
