import { describe, expect, it, vi } from 'vitest';
import { blobToDataUrl, createGoogleDrive, dataUrlToBlob } from '$lib/services/cloudSync/googleDrive';
import { createCloudKit } from '$lib/services/cloudSync/cloudKit';
import { CloudAuthError, RemoteChangedError } from '$lib/services/cloudSync/types';
import { requestGoogleToken, storedGoogleToken, storeGoogleToken, DRIVE_SCOPE } from '$lib/services/cloudSync/googleIdentity';
import { mockStorage } from './fixtures/indexeddb';

const account = { accountId: 'perm-1', label: 'me@example.com' };
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Google Drive provider', () => {
  it('lists plans with their previews, keeping the newest file when a plan appears twice', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ files: [
      { id: 'f2', version: '9', appProperties: { openplan3dKind: 'project', openplan3dId: 'p1' } },
      { id: 'f1', version: '4', appProperties: { openplan3dKind: 'project', openplan3dId: 'p1' } },
      { id: 't1', version: '7', appProperties: { openplan3dKind: 'thumbnail', openplan3dId: 'p1' } },
      { id: 't2', version: '3', appProperties: { openplan3dKind: 'thumbnail', openplan3dId: 'orphan' } },
    ] }));
    vi.stubGlobal('fetch', fetch);
    const drive = createGoogleDrive(async () => 'token', account);
    expect(await drive.list()).toEqual([{ projectId: 'p1', version: '9', fileId: 'f2', thumbnailFileId: 't1', thumbnailVersion: '7' }]);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get('q')).toContain("appProperties has { key='openplan3dKind' and value='project' }");
    expect(url.searchParams.get('q')).toContain('trashed = false');
  });

  it('creates the folder once, then uploads a new plan tagged with its project ID', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push({ url, init });
      if (url.includes('/upload/')) return jsonResponse({ id: 'plan-file', version: '1' });
      if (init.method === 'POST') return jsonResponse({ id: requests.length === 2 ? 'folder' : 'previews' });
      return jsonResponse({ files: [] });
    }));
    const drive = createGoogleDrive(async () => 'token', account);
    const raw = JSON.stringify({ id: 'p1', name: 'Malena: living/dining' });
    const written = await drive.write('p1', raw, null);
    expect(written).toMatchObject({ projectId: 'p1', version: '1', fileId: 'plan-file', thumbnailVersion: null });
    const upload = requests.at(-1)!;
    expect(upload.url).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(upload.init.method).toBe('POST');
    const body = await (upload.init.body as Blob).text();
    expect(body).toContain('"name":"Malena  living dining.openplan3d.json"');
    expect(body).toContain('"appProperties":{"openplan3dKind":"project","openplan3dId":"p1"}');
    expect(body).toContain('"parents":["folder"]');
    expect(body).toContain(raw);
    expect(new Headers(upload.init.headers).get('Authorization')).toBe('Bearer token');

    // Later writes reuse the folders found or created the first time.
    const before = requests.length;
    await drive.write('p1', raw, written);
    expect(requests.length).toBe(before + 1);
    expect(requests.at(-1)!.init.method).toBe('PATCH');
    expect(requests.at(-1)!.url).toContain('/files/plan-file?uploadType=multipart');
  });

  it('retries once with a fresh token, then asks the user to sign in again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const token = vi.fn(async (refresh?: boolean) => refresh ? 'fresh' : 'stale');
    const drive = createGoogleDrive(token, account);
    await expect(drive.list()).rejects.toBeInstanceOf(CloudAuthError);
    expect(token.mock.calls).toEqual([[false], [true]]);
  });

  it('moves deleted plans and their previews to the Drive trash', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ id: 'x' }));
    vi.stubGlobal('fetch', fetch);
    await createGoogleDrive(async () => 'token', account).remove({ projectId: 'p1', version: '2', thumbnailVersion: '1', fileId: 'f1', thumbnailFileId: 't1' } as never);
    expect(fetch.mock.calls.map(([url, init]) => [url.split('?')[0].split('/').pop(), init?.method, init?.body]))
      .toEqual([['f1', 'PATCH', '{"trashed":true}'], ['t1', 'PATCH', '{"trashed":true}']]);
  });

  it('round trips preview data URLs through Blobs', async () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe('image/jpeg');
    expect(await blobToDataUrl(blob)).toBe(dataUrl);
  });
});

describe('iCloud provider', () => {
  const user = { userRecordName: '_user1' };
  const record = (name: string, tag: string, fields: Record<string, unknown> = {}) =>
    ({ recordName: name, recordType: 'Plan', recordChangeTag: tag, fields: Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value }])) });
  const ok = (records: unknown[] = []) => ({ hasErrors: false, errors: [], records });
  const fail = (ckErrorCode: string) => ({ hasErrors: true, errors: [{ ckErrorCode }], records: [] });

  function fakeContainer(db: Partial<Record<string, ReturnType<typeof vi.fn>>>) {
    return { privateCloudDatabase: { saveRecordZones: vi.fn(async () => ok()), ...db } } as never;
  }

  it('lists every page of the zone, and nothing when the zone does not exist yet', async () => {
    const fetchRecordZoneChanges = vi.fn()
      .mockResolvedValueOnce({ hasErrors: false, errors: [], zones: [{ records: [record('p1', 't1', { thumbnailHash: 'h1' })], moreComing: true, syncToken: 's1' }] })
      .mockResolvedValueOnce({ hasErrors: false, errors: [], zones: [{ records: [record('p2', 't2'), { ...record('p3', 't3'), deleted: true }], moreComing: false, syncToken: 's2' }] })
      .mockResolvedValueOnce({ hasErrors: true, errors: [{ ckErrorCode: 'ZONE_NOT_FOUND' }], zones: [] });
    const icloud = createCloudKit(fakeContainer({ fetchRecordZoneChanges }), user);
    expect(await icloud.list()).toEqual([
      { projectId: 'p1', version: 't1', thumbnailVersion: 'h1' },
      { projectId: 'p2', version: 't2', thumbnailVersion: null },
    ]);
    expect(fetchRecordZoneChanges.mock.calls[1][0][0]).toMatchObject({ zoneID: { zoneName: 'openPlan3D' }, syncToken: 's1' });
    expect(await icloud.list()).toEqual([]);
  });

  it('updates with the change tag it saw and reports a concurrent change', async () => {
    const saveRecords = vi.fn().mockResolvedValueOnce(ok([record('p1', 't2')])).mockResolvedValueOnce(fail('CONFLICT'));
    const icloud = createCloudKit(fakeContainer({ saveRecords }), user);
    const raw = JSON.stringify({ id: 'p1', name: 'Plan' });
    expect(await icloud.write('p1', raw, { projectId: 'p1', version: 't1', thumbnailVersion: null }, 'data:image/jpeg;base64,AA'))
      .toEqual({ projectId: 'p1', version: 't2', thumbnailVersion: null });
    const saved = saveRecords.mock.calls[0][0][0];
    expect(saved).toMatchObject({ recordType: 'Plan', recordName: 'p1', recordChangeTag: 't1' });
    expect(saved.fields.data.value).toBe(raw);
    expect(saved.fields.thumbnail.value).toBe('data:image/jpeg;base64,AA');
    expect(saveRecords.mock.calls[0][1]).toEqual({ zoneID: { zoneName: 'openPlan3D' } });
    await expect(icloud.write('p1', raw, { projectId: 'p1', version: 't1', thumbnailVersion: null })).rejects.toBeInstanceOf(RemoteChangedError);
  });

  it('stores large plans as an asset and reads either form back', async () => {
    const saveRecords = vi.fn(async () => ok([record('big', 't1')]));
    const big = JSON.stringify({ id: 'big', name: 'Big', model: 'x'.repeat(800_000) });
    const fetchRecords = vi.fn()
      .mockResolvedValueOnce(ok([record('small', 't1', { data: '{"id":"small"}' })]))
      .mockResolvedValueOnce(ok([record('big', 't1', { data: '', dataAsset: { downloadURL: 'https://cvws.example/asset/${f}' } })]));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.endsWith('/plan.json') ? big : '', { status: 200 })));
    const icloud = createCloudKit(fakeContainer({ saveRecords, fetchRecords }), user);
    await icloud.write('big', big, null);
    const fields = (saveRecords.mock.calls[0] as unknown as [{ fields: Record<string, { value: unknown }> }[]])[0][0].fields;
    expect(fields.data.value).toBe('');
    expect(fields.dataAsset.value).toBeInstanceOf(Blob);
    expect(await icloud.read({ projectId: 'small', version: 't1', thumbnailVersion: null })).toBe('{"id":"small"}');
    expect(await icloud.read({ projectId: 'big', version: 't1', thumbnailVersion: null })).toBe(big);
  });

  it('asks the user to sign in again when the iCloud session has ended', async () => {
    const fetchRecords = vi.fn(async () => fail('AUTHENTICATION_REQUIRED'));
    await expect(createCloudKit(fakeContainer({ fetchRecords }), user).get('p1')).rejects.toBeInstanceOf(CloudAuthError);
  });
});

describe('browser-only Google sign-in', () => {
  function fakeGoogle(response: Record<string, unknown> | { error_type: string }) {
    const requests: unknown[] = [];
    vi.stubGlobal('window', { google: { accounts: { oauth2: {
      initTokenClient: (config: { callback: (r: unknown) => void; error_callback: (e: unknown) => void; login_hint?: string }) => ({
        requestAccessToken: (overrides: unknown) => {
          requests.push({ hint: config.login_hint, overrides });
          if ('error_type' in response) config.error_callback({ type: response.error_type });
          else config.callback(response);
        },
      }),
    } } } });
    return requests;
  }

  it('asks only for the drive.file scope and returns an expiring token', async () => {
    const requests = fakeGoogle({ access_token: 'tok', expires_in: 3599, scope: `${DRIVE_SCOPE} openid` });
    const token = await requestGoogleToken('client', 'me@example.com');
    expect(token).toMatchObject({ value: 'tok', hint: 'me@example.com' });
    expect(token.expiresAt).toBeGreaterThan(Date.now() + 3_500_000);
    expect(requests).toEqual([{ hint: 'me@example.com', overrides: { prompt: '' } }]);
  });

  it('refuses a grant without Drive access and explains a blocked popup', async () => {
    fakeGoogle({ access_token: 'tok', expires_in: 3599, scope: 'openid' });
    await expect(requestGoogleToken('client')).rejects.toBeInstanceOf(CloudAuthError);
    fakeGoogle({ error_type: 'popup_failed_to_open' });
    await expect(requestGoogleToken('client')).rejects.toThrow('Allow pop-ups');
  });

  it('keeps a token across reloads only until shortly before it expires', () => {
    mockStorage();
    storeGoogleToken({ value: 'tok', expiresAt: Date.now() + 30 * 60_000, hint: 'me@example.com' });
    expect(storedGoogleToken()?.value).toBe('tok');
    storeGoogleToken({ value: 'old', expiresAt: Date.now() + 30_000 });
    expect(storedGoogleToken()).toBeNull();
  });
});
