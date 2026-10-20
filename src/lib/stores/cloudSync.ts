import { get, writable } from 'svelte/store';
import { env } from '$env/dynamic/public';
import { syncLibrary, syncProject, type SyncOutcome } from '$lib/services/cloudSync/engine';
import { clearSyncRecords } from '$lib/services/cloudSync/localLibrary';
import { createGoogleDrive, fetchDriveAccount } from '$lib/services/cloudSync/googleDrive';
import { googleHint, preloadGoogleIdentity, requestGoogleToken, storedGoogleToken, storeGoogleToken, type GoogleToken } from '$lib/services/cloudSync/googleIdentity';
import { cloudKitAccountLabel, cloudKitContainer, createCloudKit, type CloudKitConfig } from '$lib/services/cloudSync/cloudKit';
import { CloudAuthError, type CloudProvider, type CloudProviderId } from '$lib/services/cloudSync/types';

/**
 * Optional library sync with the user's own Google Drive or iCloud (docs/cloud-sync.md), entirely in the
 * browser: no backend is involved. The local library stays the working copy: saves never wait for the
 * cloud, and sync reconciles in the background.
 */
export type CloudSyncStatus =
  | { state: 'off' }
  /** Restoring a remembered connection, or waiting for the Apple sign-in button to be used. */
  | { state: 'connecting'; provider: CloudProviderId }
  /** Paused until the user signs in again: Google's hourly access ran out, or an iCloud session ended. */
  | { state: 'signed-out'; provider: CloudProviderId }
  /** The connection could not start, e.g. offline or a misconfigured provider; sync retries it. */
  | { state: 'failed'; provider: CloudProviderId; error: string }
  | ConnectedStatus;

interface ConnectedStatus {
  state: 'ready' | 'syncing';
  provider: CloudProviderId;
  label: string;
  lastSyncedAt: Date | null;
  error: string | null;
  conflicts: string[];
}

const CHOICE_KEY = 'openplan3d-cloud-provider';

export const cloudSync = writable<CloudSyncStatus>({ state: 'off' });

let provider: CloudProvider | null = null;
let starting: Promise<void> | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function cloudKitConfig(): CloudKitConfig | null {
  const containerIdentifier = env.PUBLIC_CLOUDKIT_CONTAINER, apiToken = env.PUBLIC_CLOUDKIT_API_TOKEN;
  if (!containerIdentifier || !apiToken) return null;
  return { containerIdentifier, apiToken, environment: env.PUBLIC_CLOUDKIT_ENVIRONMENT === 'production' ? 'production' : 'development' };
}

/** Which providers this deployment offers; neither is shown unless configured. */
export function availableProviders(): CloudProviderId[] {
  return [...(env.PUBLIC_GOOGLE_CLIENT_ID ? ['google' as const] : []), ...(cloudKitConfig() ? ['icloud' as const] : [])];
}

function readChoice(): CloudProviderId | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    return value === 'google' || value === 'icloud' ? value : null;
  } catch { return null; }
}

function writeChoice(value: CloudProviderId | null) {
  try { if (value) localStorage.setItem(CHOICE_KEY, value); else localStorage.removeItem(CHOICE_KEY); } catch { /* Sync still runs this visit. */ }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'Sync failed. Check your connection and try again.';
}

let googleSession: GoogleToken | null = null;

/** Google tokens cannot be renewed without a tap, so an expired or rejected token pauses sync. */
async function googleToken(rejected = false): Promise<string> {
  if (rejected) googleSession = null;
  else googleSession ??= storedGoogleToken();
  if (googleSession && googleSession.expiresAt - 60_000 > Date.now()) return googleSession.value;
  googleSession = null;
  throw new CloudAuthError('Google Drive sync is paused. Continue to sign in again.');
}

function ready(next: CloudProvider, label: string) {
  provider = next;
  cloudSync.set({ state: 'ready', provider: next.id, label, lastSyncedAt: null, error: null, conflicts: [] });
}

function signedOut(id: CloudProviderId) {
  provider = null;
  cloudSync.set({ state: 'signed-out', provider: id });
}

async function startGoogle() {
  cloudSync.set({ state: 'connecting', provider: 'google' });
  // Loaded now so a later Continue tap can open Google's popup at once.
  void preloadGoogleIdentity().catch(() => {});
  try {
    const account = await fetchDriveAccount(googleToken);
    if (googleSession) storeGoogleToken({ ...googleSession, hint: account.label.includes('@') ? account.label : googleSession.hint });
    ready(createGoogleDrive(googleToken, account), account.label);
  } catch (error) {
    if (error instanceof CloudAuthError) signedOut('google');
    else { provider = null; cloudSync.set({ state: 'failed', provider: 'google', error: message(error) }); }
  }
}

/** iCloud signs in through Apple's own button, which CloudKit JS draws into the element with SIGN_IN_BUTTON_ID. */
async function startICloud(waitForSignIn: boolean) {
  const config = cloudKitConfig();
  if (!config) { cloudSync.set({ state: 'off' }); return; }
  cloudSync.set({ state: 'connecting', provider: 'icloud' });
  try {
    const container = await cloudKitContainer(config);
    const user = await container.setUpAuth();
    if (!user) {
      signedOut('icloud');
      // Apple's button is showing now; using it later completes the connection, even on a restored page.
      const signIn = container.whenUserSignsIn().then(signedIn => {
        // Disconnecting while Apple's sign-in window was open cancels the connection.
        if (readChoice() === 'icloud') ready(createCloudKit(container, signedIn), cloudKitAccountLabel(signedIn));
      });
      if (waitForSignIn) await signIn;
      return;
    }
    if (readChoice() !== 'icloud') return;
    ready(createCloudKit(container, user), cloudKitAccountLabel(user));
  } catch (error) {
    if (error instanceof CloudAuthError) signedOut('icloud');
    else { provider = null; cloudSync.set({ state: 'failed', provider: 'icloud', error: message(error) }); }
  }
}

/** Restore the connection this browser chose earlier, once per page load. */
export function initCloudSync(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  starting ??= (async () => {
    const choice = readChoice();
    if (!choice || !availableProviders().includes(choice)) return;
    if (choice === 'google') await startGoogle(); else await startICloud(false);
  })();
  return starting;
}

/** Load Google's sign-in library while the page is idle, so Connect can open its popup within the tap. */
export function prepareGoogleSignIn() {
  if (env.PUBLIC_GOOGLE_CLIENT_ID) void preloadGoogleIdentity().catch(() => {});
}

/**
 * Connect Google Drive, or continue after the hourly access ran out. Call it straight from a click or
 * tap handler: Google's popup must open within the user's gesture. Resolves once sync can run.
 */
export async function connectGoogle(): Promise<string | null> {
  const clientId = env.PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  const request = requestGoogleToken(clientId, googleHint());
  const previous = get(cloudSync);
  cloudSync.set({ state: 'connecting', provider: 'google' });
  try {
    googleSession = await request;
    storeGoogleToken(googleSession);
  } catch (error) {
    // Closing the popup leaves things as they were, including a paused connection; the reason is shown.
    cloudSync.set(previous);
    return message(error);
  }
  writeChoice('google');
  starting = startGoogle();
  await starting;
  return null;
}

/** Shows Apple's sign-in button (or signs in at once with a remembered session), then starts syncing. */
export async function connectICloud() {
  writeChoice('icloud');
  starting = startICloud(true);
  await starting;
}

export async function disconnectCloud() {
  const status = get(cloudSync);
  const current = provider;
  provider = null;
  writeChoice(null);
  cloudSync.set({ state: 'off' });
  if (pushTimer) clearTimeout(pushTimer);
  // Plans stay in the library and in the cloud; only this browser's link between them is forgotten.
  if (current) await clearSyncRecords(`${current.id}/${current.accountId}`).catch(() => {});
  // Google's grant is not revoked: that would also pause every other device. Forgetting the token is enough.
  if (status.state !== 'off' && status.provider === 'google') { googleSession = null; storeGoogleToken(null); }
  if (status.state !== 'off' && status.provider === 'icloud') {
    const config = cloudKitConfig();
    if (config) (await cloudKitContainer(config).catch(() => null))?.signOut();
  }
}

async function run(task: (p: CloudProvider) => Promise<SyncOutcome>): Promise<SyncOutcome | null> {
  // A connection that could not start (offline, say) is retried rather than left stuck.
  if (get(cloudSync).state === 'failed') { starting = null; await initCloudSync(); }
  const active = provider, status = get(cloudSync);
  if (!active || (status.state !== 'ready' && status.state !== 'syncing')) return null;
  cloudSync.set({ ...status, state: 'syncing' });
  const done = (update: Partial<ConnectedStatus>) => {
    const latest = get(cloudSync);
    if (provider === active && (latest.state === 'syncing' || latest.state === 'ready')) cloudSync.set({ ...latest, state: 'ready', ...update });
  };
  try {
    const outcome = await task(active);
    const failed = outcome.failed[0]?.error;
    done({ lastSyncedAt: new Date(), error: failed ? `Some plans could not be synced: ${message(failed)}` : null,
      conflicts: outcome.conflicts.length ? outcome.conflicts : status.conflicts });
    return outcome;
  } catch (error) {
    if (error instanceof CloudAuthError) { if (provider === active) signedOut(active.id); }
    else done({ error: message(error) });
    return null;
  }
}

/** Sync the whole library; resolves with what changed, or null when sync is off or failed. */
export function syncCloudLibrary() { return run(p => syncLibrary(p)); }

/** Sync one plan now, e.g. before the editor opens it. */
export function syncCloudProject(id: string) { return run(p => syncProject(p, id)); }

/** Upload a saved plan a moment later, so its preview (captured after the save) usually goes with it. */
export function pushCloudProjectSoon(id: string, delay = 3000) {
  if (!provider) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void syncCloudProject(id); }, delay);
}

export function dismissCloudConflicts() {
  const status = get(cloudSync);
  if (status.state === 'ready' || status.state === 'syncing') cloudSync.set({ ...status, conflicts: [] });
}
