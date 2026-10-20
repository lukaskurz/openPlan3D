import { mutateLibrary } from '../datastore';
import { notifyLibraryChange, request, transaction, withDatabase } from '../localDatabase';

/** What this device last agreed with the cloud about one plan: the remote versions it saw and
 *  the hashes of the local bytes that matched them. A local or remote change shows as a difference. */
export interface SyncRecord {
  version: string;
  hash: string;
  thumbnailVersion: string | null;
  thumbnailHash: string | null;
}

export interface LocalEntry {
  raw: string | null;
  thumbnail: string | null;
  record: SyncRecord | null;
}

/** Sync records live in the library's meta store, keyed by account, so another account never inherits them. */
export const syncRecordKey = (account: string, id: string) => `cloud:${account}:${id}`;

/** cyrb53: a fast 53-bit hash that needs no secure context. It only detects changes; equality is still rechecked on conflicts. */
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${text.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** The meta store is small, so filtering its keys avoids depending on IDBKeyRange. */
async function accountKeys(meta: IDBObjectStore, prefix: string): Promise<string[]> {
  return (await request(meta.getAllKeys())).map(String).filter(key => key.startsWith(prefix));
}

/** Every plan, preview and sync record the library holds for an account, or only `ids`. */
export async function readLocalEntries(account: string, ids?: string[]): Promise<Map<string, LocalEntry>> {
  return withDatabase(db => transaction(db, ['projects', 'thumbnails', 'meta'], 'readonly', async tx => {
    const projects = tx.objectStore('projects'), thumbnails = tx.objectStore('thumbnails'), meta = tx.objectStore('meta');
    const prefix = syncRecordKey(account, '');
    let wanted = ids;
    if (!wanted) {
      const keys = new Set((await request(projects.getAllKeys())).map(String));
      for (const key of await accountKeys(meta, prefix)) keys.add(key.slice(prefix.length));
      wanted = [...keys];
    }
    const entries = new Map<string, LocalEntry>();
    for (const id of wanted) {
      const raw = (await request(projects.get(id))) ?? null;
      const thumbnail = (await request(thumbnails.get(id))) ?? null;
      const record = (await request(meta.get(syncRecordKey(account, id)))) ?? null;
      entries.set(id, { raw: typeof raw === 'string' ? raw : null, thumbnail: typeof thumbnail === 'string' ? thumbnail : null, record });
    }
    return entries;
  }));
}

export async function writeSyncRecord(account: string, id: string, record: SyncRecord | null): Promise<void> {
  await withDatabase(db => transaction(db, ['meta'], 'readwrite', async tx => {
    const meta = tx.objectStore('meta'), key = syncRecordKey(account, id);
    if (record) meta.put(record, key); else meta.delete(key);
  }));
}

/** Forget every sync record of an account; its plans stay in the library. */
export async function clearSyncRecords(account: string): Promise<void> {
  const prefix = syncRecordKey(account, '');
  await withDatabase(db => transaction(db, ['meta'], 'readwrite', async tx => {
    const meta = tx.objectStore('meta');
    for (const key of await accountKeys(meta, prefix)) meta.delete(key);
  }));
}

/**
 * Replace (or with `next` null, delete) a plan only while its stored bytes still equal `expected`,
 * so an edit saved since sync read the library is never lost: sync sees it on its next pass.
 * The sync record commits in the same transaction. Returns whether the change applied.
 */
export async function replaceLocalProject(account: string, id: string, expected: string | null,
  next: { raw: string; thumbnail: string | null } | null, record: SyncRecord | null): Promise<boolean> {
  return mutateLibrary(async () => {
    const applied = await withDatabase(db => transaction(db, ['projects', 'thumbnails', 'history', 'meta'], 'readwrite', async tx => {
      const projects = tx.objectStore('projects'), thumbnails = tx.objectStore('thumbnails');
      if (((await request(projects.get(id))) ?? null) !== expected) return false;
      if (next) {
        projects.put(next.raw, id);
        if (next.thumbnail) thumbnails.put(next.thumbnail, id); else thumbnails.delete(id);
      } else {
        projects.delete(id);
        thumbnails.delete(id);
        tx.objectStore('history').delete(id);
      }
      const meta = tx.objectStore('meta'), key = syncRecordKey(account, id);
      if (record) meta.put(record, key); else meta.delete(key);
      return true;
    }));
    if (applied) notifyLibraryChange(id);
    return applied;
  });
}

/** Previews are optional: store one only while the plan is still the bytes it belongs to. */
export async function replaceLocalThumbnail(account: string, id: string, expected: string, thumbnail: string, record: SyncRecord): Promise<boolean> {
  return withDatabase(db => transaction(db, ['projects', 'thumbnails', 'meta'], 'readwrite', async tx => {
    if ((await request(tx.objectStore('projects').get(id))) !== expected) return false;
    tx.objectStore('thumbnails').put(thumbnail, id);
    tx.objectStore('meta').put(record, syncRecordKey(account, id));
    return true;
  }));
}
