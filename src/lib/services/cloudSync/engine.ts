import { readProject } from '$lib/utils/projectValidation';
import { contentHash, readLocalEntries, replaceLocalProject, replaceLocalThumbnail, writeSyncRecord, type LocalEntry, type SyncRecord } from './localLibrary';
import { CloudAuthError, RemoteChangedError, type CloudProvider, type RemoteProject } from './types';

export interface SyncOutcome {
  uploaded: number;
  downloaded: number;
  deleted: number;
  /** Names of local copies made when a plan changed on two devices since they last synced. */
  conflicts: string[];
  /** Plans that could not be synced this time; the rest of the library still was. */
  failed: { id: string; error: unknown }[];
}

const emptyOutcome = (): SyncOutcome => ({ uploaded: 0, downloaded: 0, deleted: 0, conflicts: [], failed: [] });
const newId = () => globalThis.crypto?.randomUUID?.() ?? `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const accountOf = (provider: CloudProvider) => `${provider.id}/${provider.accountId}`;

/** One sync at a time per browser, across tabs: two runs would each upload the same new plan. */
async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    const outcome = await navigator.locks.request('openplan3d-cloud-sync', async () => {
      try { return { ok: true as const, value: await run() }; }
      catch (error) { return { ok: false as const, error }; }
    });
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  return run();
}

/** Bring the whole library and the cloud account into agreement. */
export function syncLibrary(provider: CloudProvider): Promise<SyncOutcome> {
  return exclusive(async () => {
    const outcome = emptyOutcome();
    const remote = new Map((await provider.list()).map(entry => [entry.projectId, entry]));
    const local = await readLocalEntries(accountOf(provider));
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
      await syncEntry(provider, id, local.get(id) ?? { raw: null, thumbnail: null, record: null }, remote.get(id) ?? null, outcome);
    }
    return outcome;
  });
}

/** Sync a single plan, such as the one an editor is opening or has just saved. */
export function syncProject(provider: CloudProvider, id: string): Promise<SyncOutcome> {
  return exclusive(async () => {
    const outcome = emptyOutcome();
    const local = (await readLocalEntries(accountOf(provider), [id])).get(id)!;
    await syncEntry(provider, id, local, await provider.get(id), outcome);
    return outcome;
  });
}

async function syncEntry(provider: CloudProvider, id: string, local: LocalEntry, remote: RemoteProject | null, outcome: SyncOutcome, retried = false) {
  try {
    await reconcile(provider, id, local, remote, outcome);
  } catch (error) {
    if (error instanceof RemoteChangedError && !retried) {
      const fresh = (await readLocalEntries(accountOf(provider), [id])).get(id)!;
      return syncEntry(provider, id, fresh, await provider.get(id), outcome, true);
    }
    if (error instanceof CloudAuthError) throw error;
    outcome.failed.push({ id, error });
  }
}

/** Remote bytes become a local plan only when they are a valid project with this ID. */
function validRemote(id: string, raw: string) {
  const project = readProject(JSON.parse(raw));
  if (project.id !== id) throw new Error('The cloud copy of this plan has a different project ID.');
  return project;
}

async function reconcile(provider: CloudProvider, id: string, local: LocalEntry, remote: RemoteProject | null, outcome: SyncOutcome) {
  const account = accountOf(provider);
  const { raw, thumbnail, record } = local;
  const hash = raw === null ? null : contentHash(raw);
  const localChanged = raw !== null && hash !== record?.hash;
  const remoteChanged = remote !== null && remote.version !== record?.version;

  const push = async (target: RemoteProject | null) => {
    const thumbnailHash = thumbnail === null ? null : contentHash(thumbnail);
    const sendThumbnail = thumbnail !== null && (target === null || thumbnailHash !== record?.thumbnailHash);
    const written = await provider.write(id, raw!, target, sendThumbnail ? thumbnail! : undefined);
    await writeSyncRecord(account, id, { version: written.version, hash: hash!, thumbnailVersion: written.thumbnailVersion,
      thumbnailHash: sendThumbnail ? thumbnailHash : record?.thumbnailHash ?? null });
    outcome.uploaded++;
  };

  const pull = async (source: RemoteProject, expected: string | null) => {
    const next = await provider.read(source);
    validRemote(id, next);
    const preview = source.thumbnailVersion ? await provider.readThumbnail(source) : null;
    const synced: SyncRecord = { version: source.version, hash: contentHash(next), thumbnailVersion: source.thumbnailVersion,
      thumbnailHash: preview === null ? null : contentHash(preview) };
    // An edit saved meanwhile wins this round; the next pass sees it as a local change.
    if (await replaceLocalProject(account, id, expected, { raw: next, thumbnail: preview }, synced)) outcome.downloaded++;
  };

  if (raw !== null && remote === null) {
    // A plan this device synced before and has not changed since was deleted in the cloud. Listing can
    // lag behind, so confirm the deletion before removing anything locally.
    if (record && !localChanged) {
      const confirmed = await provider.get(id);
      if (confirmed) return reconcile(provider, id, local, confirmed, outcome);
      if (await replaceLocalProject(account, id, raw, null, null)) outcome.deleted++;
      return;
    }
    return push(null);
  }

  if (raw === null && remote !== null) {
    // Deleted here after the last sync, and unchanged in the cloud since: delete it there too.
    // Edits made on another device meanwhile win over the deletion and come back.
    if (record && !remoteChanged) {
      await provider.remove(remote);
      await writeSyncRecord(account, id, null);
      outcome.deleted++;
      return;
    }
    return pull(remote, null);
  }

  if (raw === null || remote === null) {
    if (record) await writeSyncRecord(account, id, null);
    return;
  }

  if (!localChanged && !remoteChanged) return syncThumbnail(provider, id, raw, thumbnail, remote, record!);
  if (!remoteChanged) return push(remote);
  if (!localChanged) return pull(remote, raw);

  // Changed on both sides since the last sync, or never synced on this device. Identical bytes just link up.
  const remoteRaw = await provider.read(remote);
  if (remoteRaw === raw) {
    await writeSyncRecord(account, id, { version: remote.version, hash: hash!, thumbnailVersion: remote.thumbnailVersion,
      thumbnailHash: record?.thumbnailHash ?? null });
    return;
  }
  // Keep both: the cloud version becomes a separate local plan (uploaded as its own plan), then this
  // device's version replaces it under the original ID.
  const copy = validRemote(id, remoteRaw);
  copy.id = newId();
  copy.name = `${copy.name || 'Untitled Project'} (Conflicted copy)`;
  const copyRaw = JSON.stringify(copy);
  const preview = remote.thumbnailVersion ? await provider.readThumbnail(remote).catch(() => null) : null;
  if (await replaceLocalProject(account, copy.id, null, { raw: copyRaw, thumbnail: preview }, null)) {
    outcome.conflicts.push(copy.name);
    await reconcile(provider, copy.id, { raw: copyRaw, thumbnail: preview, record: null }, null, outcome);
  }
  await push(remote);
}

async function syncThumbnail(provider: CloudProvider, id: string, raw: string, thumbnail: string | null, remote: RemoteProject, record: SyncRecord) {
  const account = accountOf(provider);
  const thumbnailHash = thumbnail === null ? null : contentHash(thumbnail);
  if (thumbnail !== null && thumbnailHash !== record.thumbnailHash) {
    // Previews are captured just after a save, so they often trail the plan's own upload.
    const written = await provider.writeThumbnail(remote, thumbnail);
    await writeSyncRecord(account, id, { ...record, version: written.version, thumbnailVersion: written.thumbnailVersion, thumbnailHash });
  } else if (remote.thumbnailVersion && remote.thumbnailVersion !== record.thumbnailVersion) {
    const preview = await provider.readThumbnail(remote);
    if (preview) await replaceLocalThumbnail(account, id, raw, preview, { ...record, thumbnailVersion: remote.thumbnailVersion, thumbnailHash: contentHash(preview) });
  }
}
