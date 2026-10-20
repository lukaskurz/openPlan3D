import { CloudAuthError, type CloudProvider, type RemoteProject } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
/** Multipart uploads are limited to 5 MB; larger plans (embedded models) use a resumable upload. */
const MULTIPART_LIMIT = 4.5 * 1024 * 1024;
const FOLDER = 'application/vnd.google-apps.folder';

/** Plans are ordinary JSON files in an "openPlan3D" Drive folder. The `drive.file` scope only reaches
 *  files this app created, which appProperties tag with the kind and the project ID. */
interface DriveProject extends RemoteProject {
  fileId: string;
  thumbnailFileId: string | null;
}

interface DriveFile { id: string; version: string; appProperties?: Record<string, string> }

export type AccessToken = (refresh?: boolean) => Promise<string>;

export interface DriveAccount { accountId: string; label: string }

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, body = ''] = dataUrl.split(',', 2);
  const type = /^data:([^;,]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  if (!header.endsWith(';base64')) return new Blob([decodeURIComponent(body)], { type });
  const bytes = Uint8Array.from(atob(body), char => char.charCodeAt(0));
  return new Blob([bytes], { type });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/** Drive file names cannot be relied on for identity, but they are what people see in Drive. */
function fileName(raw: string) {
  let name = 'Untitled Project';
  try { name = String(JSON.parse(raw).name || name); } catch { /* The validated plan always has one. */ }
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || 'Untitled Project'}.openplan3d.json`;
}

const quote = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export function createGoogleDrive(token: AccessToken, account: DriveAccount): CloudProvider {
  let folders: Promise<{ plans: string; thumbnails: string }> | null = null;

  async function call(url: string, init: RequestInit = {}, refreshed = false): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await token(refreshed)}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) {
      if (!refreshed) return call(url, init, true);
      throw new CloudAuthError('Google Drive needs you to sign in again.');
    }
    if (!response.ok) {
      let reason = '';
      try { reason = (await response.json())?.error?.message ?? ''; } catch { /* Not JSON. */ }
      throw new Error(`Google Drive request failed (${response.status})${reason ? `: ${reason}` : ''}`);
    }
    return response;
  }
  const json = async <T>(url: string, init?: RequestInit) => (await call(url, init)).json() as Promise<T>;

  async function find(q: string, fields = 'id,version,appProperties'): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', spaces: 'drive', orderBy: 'modifiedTime desc' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await json<{ files: DriveFile[]; nextPageToken?: string }>(`${API}/files?${params}`);
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async function folder(kind: string, name: string, parent?: string): Promise<string> {
    const [existing] = await find(`mimeType = '${FOLDER}' and trashed = false and appProperties has { key='openplan3dKind' and value=${quote(kind)} }`, 'id');
    if (existing) return existing.id;
    const created = await json<{ id: string }>(`${API}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: parent ? [parent] : undefined, appProperties: { openplan3dKind: kind } }),
    });
    return created.id;
  }

  function ensureFolders() {
    folders ??= (async () => {
      const plans = await folder('folder', 'openPlan3D');
      return { plans, thumbnails: await folder('thumbnails', 'Previews', plans) };
    })().catch(error => { folders = null; throw error; });
    return folders;
  }

  async function upload(fileId: string | null, metadata: Record<string, unknown>, body: Blob): Promise<DriveFile> {
    const method = fileId ? 'PATCH' : 'POST';
    const target = `${UPLOAD}/files${fileId ? `/${encodeURIComponent(fileId)}` : ''}`;
    if (body.size <= MULTIPART_LIMIT) {
      const boundary = `openplan3d-${Math.random().toString(36).slice(2)}`;
      const multipart = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: ${body.type}\r\n\r\n`, body, `\r\n--${boundary}--`,
      ]);
      return json<DriveFile>(`${target}?uploadType=multipart&fields=id,version`, {
        method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
      });
    }
    const session = await call(`${target}?uploadType=resumable&fields=id,version`, {
      method, body: JSON.stringify(metadata),
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': body.type, 'X-Upload-Content-Length': String(body.size) },
    });
    const location = session.headers.get('Location');
    if (!location) throw new Error('Google Drive did not start the upload.');
    const uploaded = await fetch(location, { method: 'PUT', body });
    if (!uploaded.ok) throw new Error(`Google Drive upload failed (${uploaded.status}).`);
    return uploaded.json();
  }

  function entries(files: DriveFile[]): Map<string, DriveProject> {
    const plans = new Map<string, DriveProject>(), previews = new Map<string, DriveFile>();
    // Newest first: if two devices ever created the same plan at once, the newer file is the one synced.
    for (const file of files) {
      const id = file.appProperties?.openplan3dId, kind = file.appProperties?.openplan3dKind;
      if (!id) continue;
      if (kind === 'project' && !plans.has(id)) plans.set(id, { projectId: id, version: file.version, fileId: file.id, thumbnailFileId: null, thumbnailVersion: null });
      if (kind === 'thumbnail' && !previews.has(id)) previews.set(id, file);
    }
    for (const [id, preview] of previews) {
      const plan = plans.get(id);
      if (plan) { plan.thumbnailFileId = preview.id; plan.thumbnailVersion = preview.version; }
    }
    return plans;
  }

  const kinds = `(appProperties has { key='openplan3dKind' and value='project' } or appProperties has { key='openplan3dKind' and value='thumbnail' })`;

  async function putThumbnail(projectId: string, existing: string | null, thumbnail: string): Promise<DriveFile> {
    const { thumbnails } = await ensureFolders();
    const metadata = existing ? {} : { name: `${projectId}.jpg`, parents: [thumbnails], appProperties: { openplan3dKind: 'thumbnail', openplan3dId: projectId } };
    return upload(existing, metadata, dataUrlToBlob(thumbnail));
  }

  return {
    id: 'google',
    accountId: account.accountId,

    async list() { return [...entries(await find(`trashed = false and ${kinds}`)).values()]; },

    async get(projectId) {
      return entries(await find(`trashed = false and ${kinds} and appProperties has { key='openplan3dId' and value=${quote(projectId)} }`)).get(projectId) ?? null;
    },

    async read(remote) {
      return (await call(`${API}/files/${encodeURIComponent((remote as DriveProject).fileId)}?alt=media`)).text();
    },

    async readThumbnail(remote) {
      const fileId = (remote as DriveProject).thumbnailFileId;
      if (!fileId) return null;
      return blobToDataUrl(await (await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`)).blob());
    },

    // Drive has no conditional write, so a change made on another device in the moment between
    // listing and this upload is overwritten; it remains in the file's Drive revision history.
    async write(projectId, raw, remote, thumbnail) {
      const existing = remote as DriveProject | null;
      const { plans } = await ensureFolders();
      const metadata = existing ? { name: fileName(raw) }
        : { name: fileName(raw), mimeType: 'application/json', parents: [plans], appProperties: { openplan3dKind: 'project', openplan3dId: projectId } };
      const file = await upload(existing?.fileId ?? null, metadata, new Blob([raw], { type: 'application/json' }));
      const preview = thumbnail ? await putThumbnail(projectId, existing?.thumbnailFileId ?? null, thumbnail) : null;
      return { projectId, version: file.version, fileId: file.id,
        thumbnailFileId: preview?.id ?? existing?.thumbnailFileId ?? null,
        thumbnailVersion: preview?.version ?? existing?.thumbnailVersion ?? null } satisfies DriveProject;
    },

    async writeThumbnail(remote, thumbnail) {
      const existing = remote as DriveProject;
      const preview = await putThumbnail(existing.projectId, existing.thumbnailFileId, thumbnail);
      return { ...existing, thumbnailFileId: preview.id, thumbnailVersion: preview.version } satisfies DriveProject;
    },

    async remove(remote) {
      const { fileId, thumbnailFileId } = remote as DriveProject;
      for (const id of [fileId, thumbnailFileId]) {
        if (!id) continue;
        await call(`${API}/files/${encodeURIComponent(id)}?fields=id`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
        });
      }
    },
  };
}

/** Who is signed in, for the library's sync line and to key this account's sync records. */
export async function fetchDriveAccount(token: AccessToken): Promise<DriveAccount> {
  const response = await fetch(`${API}/about?fields=user(displayName,emailAddress,permissionId)`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (response.status === 401) throw new CloudAuthError('Google Drive needs you to sign in again.');
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
  const { user } = await response.json() as { user: { displayName?: string; emailAddress?: string; permissionId: string } };
  return { accountId: user.permissionId, label: user.emailAddress || user.displayName || 'Google Drive' };
}
