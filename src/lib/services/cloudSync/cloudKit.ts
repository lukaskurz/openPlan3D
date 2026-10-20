import { CloudAuthError, RemoteChangedError, type CloudProvider, type RemoteProject } from './types';

/** CloudKit JS from Apple's CDN; Apple licenses it only for use from there. */
const SCRIPT = 'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js';
/** Plans live in a custom zone of the user's private database, so they count against their iCloud storage. */
const ZONE = { zoneName: 'openPlan3D' };
const TYPE = 'Plan';
/** Records hold up to 1 MB. Plan JSON below this travels as a string; larger plans (embedded models) as an asset. */
const INLINE_LIMIT = 700_000;
export const SIGN_IN_BUTTON_ID = 'apple-sign-in-button';
export const SIGN_OUT_BUTTON_ID = 'apple-sign-out-button';

export interface CloudKitConfig {
  containerIdentifier: string;
  apiToken: string;
  environment: 'development' | 'production';
}

/* Minimal typings for the parts of CloudKit JS this provider uses. */
interface CkError { ckErrorCode?: string; serverErrorCode?: string; reason?: string; message?: string }
interface CkRecord { recordName: string; recordType?: string; recordChangeTag: string; deleted?: boolean;
  fields: Record<string, { value: any } | undefined> }
interface CkResponse { hasErrors: boolean; errors: CkError[]; records: CkRecord[] }
interface CkZoneResponse { hasErrors: boolean; errors: CkError[];
  zones: { records: CkRecord[]; moreComing: boolean; syncToken: string; serverErrorCode?: string; ckErrorCode?: string }[] }
interface CkDatabase {
  fetchRecordZoneChanges(zones: unknown): Promise<CkZoneResponse>;
  fetchRecords(records: unknown, options?: unknown): Promise<CkResponse>;
  saveRecords(records: unknown, options?: unknown): Promise<CkResponse>;
  deleteRecords(records: unknown, options?: unknown): Promise<CkResponse>;
  saveRecordZones(zones: unknown): Promise<CkResponse>;
}
interface CkUserIdentity { userRecordName: string; nameComponents?: { givenName?: string; familyName?: string } }
interface CkContainer {
  privateCloudDatabase: CkDatabase;
  setUpAuth(): Promise<CkUserIdentity | null>;
  whenUserSignsIn(): Promise<CkUserIdentity>;
  whenUserSignsOut(): Promise<void>;
  signOut(): void;
}
interface CloudKitGlobal { configure(config: unknown): void; getDefaultContainer(): CkContainer }

let loading: Promise<CloudKitGlobal> | null = null;
let configured: CkContainer | null = null;

function loadCloudKit(): Promise<CloudKitGlobal> {
  const existing = (window as unknown as { CloudKit?: CloudKitGlobal }).CloudKit;
  if (existing) return Promise.resolve(existing);
  loading ??= new Promise<CloudKitGlobal>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const kit = (window as unknown as { CloudKit?: CloudKitGlobal }).CloudKit;
      if (kit) resolve(kit); else reject(new Error('iCloud could not be loaded.'));
    };
    script.onerror = () => { loading = null; script.remove(); reject(new Error('iCloud could not be reached. Check your connection and try again.')); };
    document.head.append(script);
  });
  return loading;
}

/** The container, configured once per page. Sign-in persists, so a returning visitor is signed in already. */
export async function cloudKitContainer(config: CloudKitConfig): Promise<CkContainer> {
  if (configured) return configured;
  const kit = await loadCloudKit();
  kit.configure({
    containers: [{
      containerIdentifier: config.containerIdentifier,
      apiTokenAuth: {
        apiToken: config.apiToken,
        persist: true,
        signInButton: { id: SIGN_IN_BUTTON_ID, theme: 'black' },
        signOutButton: { id: SIGN_OUT_BUTTON_ID, theme: 'black' },
      },
      environment: config.environment,
    }],
  });
  configured = kit.getDefaultContainer();
  return configured;
}

function failure(error: CkError | undefined): Error {
  const code = error?.ckErrorCode ?? error?.serverErrorCode;
  if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTHENTICATION_FAILED') return new CloudAuthError('iCloud needs you to sign in again.');
  if (code === 'CONFLICT' || code === 'EXISTS') return new RemoteChangedError();
  if (code === 'QUOTA_EXCEEDED') return new Error('Your iCloud storage is full. Free some space in iCloud, then sync again.');
  return new Error(`iCloud request failed${code ? ` (${code})` : ''}${error?.reason ? `: ${error.reason}` : ''}`);
}

/** CloudKit JS rejects with CKErrors for transport failures and resolves with `hasErrors` for record errors. */
async function ck<T extends { hasErrors: boolean; errors: CkError[] }>(operation: Promise<T>, allow: string[] = []): Promise<T> {
  let response: T;
  try { response = await operation; }
  catch (error) { throw failure(error as CkError); }
  const error = response.hasErrors ? response.errors.find(e => !allow.includes(e.ckErrorCode ?? e.serverErrorCode ?? '')) : undefined;
  if (error) throw failure(error);
  return response;
}

const toRemote = (record: CkRecord): RemoteProject => ({
  projectId: record.recordName,
  version: record.recordChangeTag,
  thumbnailVersion: record.fields.thumbnailHash?.value || null,
});

/** Thumbnails are stored as their data URL; their hash names the version without fetching them. */
function thumbnailFields(thumbnail: string) {
  let h = 0;
  for (let i = 0; i < thumbnail.length; i++) h = Math.imul(h ^ thumbnail.charCodeAt(i), 2654435761);
  return { thumbnail: { value: thumbnail }, thumbnailHash: { value: `${thumbnail.length.toString(36)}-${(h >>> 0).toString(36)}` } };
}

export function createCloudKit(container: CkContainer, user: CkUserIdentity): CloudProvider {
  const db = container.privateCloudDatabase;
  let zoneReady: Promise<void> | null = null;
  const ensureZone = () => {
    zoneReady ??= ck(db.saveRecordZones([ZONE])).then(() => {}, error => { zoneReady = null; throw error; });
    return zoneReady;
  };

  async function fetchRecord(projectId: string, desiredKeys: string[]): Promise<CkRecord | null> {
    const response = await ck(db.fetchRecords([{ recordName: projectId }], { zoneID: ZONE, desiredKeys }), ['NOT_FOUND', 'ZONE_NOT_FOUND']);
    return response.records.find(record => record.recordName === projectId && !record.deleted) ?? null;
  }

  async function save(record: Record<string, unknown>): Promise<RemoteProject> {
    await ensureZone();
    const response = await ck(db.saveRecords([record], { zoneID: ZONE }));
    return toRemote(response.records[0]);
  }

  return {
    id: 'icloud',
    accountId: user.userRecordName,

    async list() {
      const plans: RemoteProject[] = [];
      let syncToken: string | undefined;
      for (;;) {
        // Without a stored sync token this returns every record in the zone, without the plan bytes.
        const response = await ck(db.fetchRecordZoneChanges([{ zoneID: ZONE, desiredKeys: ['thumbnailHash'], syncToken }]), ['ZONE_NOT_FOUND']);
        const zone = response.zones?.[0];
        if (!zone || zone.serverErrorCode === 'ZONE_NOT_FOUND' || zone.ckErrorCode === 'ZONE_NOT_FOUND') return plans;
        for (const record of zone.records) if (!record.deleted && record.recordType === TYPE) plans.push(toRemote(record));
        if (!zone.moreComing) return plans;
        syncToken = zone.syncToken;
      }
    },

    async get(projectId) {
      const record = await fetchRecord(projectId, ['thumbnailHash']);
      return record ? toRemote(record) : null;
    },

    async read(remote) {
      const record = await fetchRecord(remote.projectId, ['data', 'dataAsset']);
      if (!record) throw new Error('This plan is no longer in iCloud.');
      const inline = record.fields.data?.value;
      if (typeof inline === 'string' && inline) return inline;
      const url: string | undefined = record.fields.dataAsset?.value?.downloadURL;
      if (!url) throw new Error('The iCloud copy of this plan is empty.');
      const response = await fetch(url.replace('${f}', 'plan.json'));
      if (!response.ok) throw new Error(`iCloud download failed (${response.status}).`);
      return response.text();
    },

    async readThumbnail(remote) {
      const value = (await fetchRecord(remote.projectId, ['thumbnail']))?.fields.thumbnail?.value;
      return typeof value === 'string' && value ? value : null;
    },

    async write(projectId, raw, remote, thumbnail) {
      const inline = new Blob([raw]).size <= INLINE_LIMIT;
      const fields: Record<string, { value: unknown }> = {
        name: { value: (() => { try { return String(JSON.parse(raw).name ?? ''); } catch { return ''; } })() },
        data: { value: inline ? raw : '' },
        ...(inline ? {} : { dataAsset: { value: new Blob([raw], { type: 'application/json' }) } }),
        ...(thumbnail ? thumbnailFields(thumbnail) : {}),
      };
      // With a change tag this is an update that fails if the record changed since; without one, a create
      // that fails if another device created it first. Both surface as RemoteChangedError.
      return save({ recordType: TYPE, recordName: projectId, recordChangeTag: remote?.version, fields });
    },

    async writeThumbnail(remote, thumbnail) {
      return save({ recordType: TYPE, recordName: remote.projectId, recordChangeTag: remote.version, fields: thumbnailFields(thumbnail) });
    },

    async remove(remote) {
      await ck(db.deleteRecords([{ recordName: remote.projectId }], { zoneID: ZONE }), ['NOT_FOUND', 'ZONE_NOT_FOUND']);
    },
  };
}

export function cloudKitAccountLabel(user: CkUserIdentity) {
  const name = [user.nameComponents?.givenName, user.nameComponents?.familyName].filter(Boolean).join(' ');
  return name;
}

export type { CkContainer, CkUserIdentity };
