import { mockStorage, putRaw, rawRecords } from './fixtures/indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createLocalStore } from '$lib/services/datastore';
import { createDefaultProject } from '$lib/stores/project';
import { syncLibrary, syncProject } from '$lib/services/cloudSync/engine';
import { RemoteChangedError, type CloudProvider, type RemoteProject } from '$lib/services/cloudSync/types';
import type { Project } from '$lib/models/types';

/** An in-memory cloud account with versioned plans, shared by the simulated devices. */
function memoryCloud(accountId = 'account-1') {
  const files = new Map<string, { raw: string; version: number; thumbnail: string | null; thumbnailVersion: number }>();
  let clock = 0;
  const entry = (id: string): RemoteProject => {
    const file = files.get(id)!;
    return { projectId: id, version: String(file.version), thumbnailVersion: file.thumbnail ? String(file.thumbnailVersion) : null };
  };
  const provider: CloudProvider = {
    id: 'google',
    accountId,
    async list() { return [...files.keys()].map(entry); },
    async get(id) { return files.has(id) ? entry(id) : null; },
    async read(remote) { return files.get(remote.projectId)!.raw; },
    async readThumbnail(remote) { return files.get(remote.projectId)?.thumbnail ?? null; },
    async write(id, raw, remote, thumbnail) {
      const previous = files.get(id);
      if (remote ? previous?.version !== Number(remote.version) : previous) throw new RemoteChangedError();
      files.set(id, { raw, version: ++clock, thumbnail: thumbnail ?? previous?.thumbnail ?? null,
        thumbnailVersion: thumbnail ? ++clock : previous?.thumbnailVersion ?? 0 });
      return entry(id);
    },
    async writeThumbnail(remote, thumbnail) {
      const file = files.get(remote.projectId)!;
      Object.assign(file, { thumbnail, thumbnailVersion: ++clock });
      return entry(remote.projectId);
    },
    async remove(remote) { files.delete(remote.projectId); },
  };
  /** Another device edits the plan in the cloud. */
  const edit = (id: string, change: (project: Project) => void) => {
    const file = files.get(id)!, project = JSON.parse(file.raw);
    change(project);
    Object.assign(file, { raw: JSON.stringify(project), version: ++clock });
  };
  return { provider, files, edit };
}

/** Each device has its own IndexedDB; `use` switches the global the library code opens. */
function device() {
  const factory = new IDBFactory();
  return { use() { vi.stubGlobal('indexedDB', factory); return createLocalStore(); } };
}

const names = async () => Object.values(await rawRecords()).map(raw => JSON.parse(raw).name).sort();

beforeEach(() => { mockStorage(); });

describe('library cloud sync', () => {
  it('uploads a library, downloads it to a second device, and does nothing when both agree', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    let store = mac.use();
    await store.save(createDefaultProject('Living room'));
    await store.save(createDefaultProject('Kitchen'));
    await store.saveThumbnail((await store.list())[0].id, 'data:image/jpeg;base64,AAAA');
    expect(await syncLibrary(cloud.provider)).toMatchObject({ uploaded: 2, downloaded: 0 });
    expect(cloud.files.size).toBe(2);

    ipad.use();
    expect(await syncLibrary(cloud.provider)).toMatchObject({ uploaded: 0, downloaded: 2 });
    expect(await names()).toEqual(['Kitchen', 'Living room']);
    expect(Object.values(await rawRecords('thumbnails'))).toEqual(['data:image/jpeg;base64,AAAA']);
    expect(await syncLibrary(cloud.provider)).toMatchObject({ uploaded: 0, downloaded: 0, deleted: 0 });

    store = mac.use();
    expect(await syncLibrary(cloud.provider)).toMatchObject({ uploaded: 0, downloaded: 0, deleted: 0 });
  });

  it('carries edits and deletions to the other device', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Plan');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    let ipadStore = ipad.use();
    await syncLibrary(cloud.provider);

    const edited = (await ipadStore.load(plan.id))!;
    edited.name = 'Edited on iPad';
    await ipadStore.save(edited);
    expect(await syncProject(cloud.provider, plan.id)).toMatchObject({ uploaded: 1 });

    const macStore = mac.use();
    expect(await syncLibrary(cloud.provider)).toMatchObject({ downloaded: 1 });
    expect((await macStore.load(plan.id))!.name).toBe('Edited on iPad');

    await macStore.list();
    await macStore.delete(plan.id);
    expect(await syncLibrary(cloud.provider)).toMatchObject({ deleted: 1 });
    expect(cloud.files.size).toBe(0);

    ipadStore = ipad.use();
    expect(await syncLibrary(cloud.provider)).toMatchObject({ deleted: 1 });
    expect(await rawRecords()).toEqual({});
  });

  it('keeps both versions when a plan changed on two devices', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Flat');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    const ipadStore = ipad.use();
    await syncLibrary(cloud.provider);

    // The Mac's edit reaches the cloud first; the iPad edited offline meanwhile.
    cloud.edit(plan.id, project => { project.name = 'Flat (Mac)'; });
    const offline = (await ipadStore.load(plan.id))!;
    offline.name = 'Flat (iPad)';
    await ipadStore.save(offline);

    const outcome = await syncLibrary(cloud.provider);
    expect(outcome.conflicts).toEqual(['Flat (Mac) (Conflicted copy)']);
    expect(await names()).toEqual(['Flat (Mac) (Conflicted copy)', 'Flat (iPad)']);
    // The iPad's version keeps the original ID; the other version is its own plan in the cloud.
    expect(JSON.parse(cloud.files.get(plan.id)!.raw).name).toBe('Flat (iPad)');
    expect(cloud.files.size).toBe(2);

    mac.use();
    await syncLibrary(cloud.provider);
    expect(await names()).toEqual(['Flat (Mac) (Conflicted copy)', 'Flat (iPad)']);
  });

  it('links identical plans that both devices already hold without copying them', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Restored from backup');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    ipad.use();
    await putRaw('projects', plan.id, cloud.files.get(plan.id)!.raw);
    expect(await syncLibrary(cloud.provider)).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: [] });
    expect(await names()).toEqual(['Restored from backup']);
  });

  it('never overwrites a local edit saved while a download was in flight', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Plan');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    const ipadStore = ipad.use();
    await syncLibrary(cloud.provider);

    cloud.edit(plan.id, project => { project.name = 'From the cloud'; });
    const local = (await ipadStore.load(plan.id))!;
    const read = cloud.provider.read;
    cloud.provider.read = async (remote) => {
      local.name = 'Saved during sync';
      await ipadStore.save(local);
      return read(remote);
    };
    expect(await syncProject(cloud.provider, plan.id)).toMatchObject({ downloaded: 0 });
    expect((await ipadStore.load(plan.id))!.name).toBe('Saved during sync');

    // The next pass sees both changes and keeps both.
    cloud.provider.read = read;
    expect((await syncProject(cloud.provider, plan.id)).conflicts).toHaveLength(1);
  });

  it('leaves the local plan alone when the cloud copy is not a valid plan', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Plan');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    const ipadStore = ipad.use();
    await syncLibrary(cloud.provider);
    const before = await rawRecords();

    cloud.files.get(plan.id)!.raw = '{"broken":';
    cloud.files.get(plan.id)!.version += 100;
    const outcome = await syncLibrary(cloud.provider);
    expect(outcome.downloaded).toBe(0);
    expect(outcome.failed.map(failure => failure.id)).toEqual([plan.id]);
    expect(await rawRecords()).toEqual(before);
    expect(await ipadStore.load(plan.id)).toMatchObject({ name: 'Plan' });
  });

  it('does not delete local plans when a different account is connected', async () => {
    const first = memoryCloud('account-1'), second = memoryCloud('account-2'), mac = device();
    await mac.use().save(createDefaultProject('Mine'));
    await syncLibrary(first.provider);
    expect(await syncLibrary(second.provider)).toMatchObject({ uploaded: 1, deleted: 0 });
    expect(await names()).toEqual(['Mine']);
  });

  it('confirms a plan is gone from the cloud before deleting it locally', async () => {
    const cloud = memoryCloud(), mac = device();
    const plan = createDefaultProject('Plan');
    await mac.use().save(plan);
    await syncLibrary(cloud.provider);
    // A listing that lags behind must not delete a plan that still exists.
    const list = cloud.provider.list;
    cloud.provider.list = async () => [];
    expect(await syncLibrary(cloud.provider)).toMatchObject({ deleted: 0 });
    expect(await names()).toEqual(['Plan']);
    cloud.provider.list = list;
  });

  it('sends previews captured after the plan was uploaded, and fetches newer ones', async () => {
    const cloud = memoryCloud(), mac = device(), ipad = device();
    const plan = createDefaultProject('Plan');
    let store = mac.use();
    await store.save(plan);
    await syncLibrary(cloud.provider);
    expect(cloud.files.get(plan.id)!.thumbnail).toBeNull();

    await store.load(plan.id);
    await store.saveThumbnail(plan.id, 'data:image/jpeg;base64,MAC');
    await syncLibrary(cloud.provider);
    expect(cloud.files.get(plan.id)!.thumbnail).toBe('data:image/jpeg;base64,MAC');

    ipad.use();
    await syncLibrary(cloud.provider);
    await cloud.provider.writeThumbnail((await cloud.provider.get(plan.id))!, 'data:image/jpeg;base64,NEWER');
    await syncLibrary(cloud.provider);
    expect(await rawRecords('thumbnails')).toEqual({ [plan.id]: 'data:image/jpeg;base64,NEWER' });
    store = createLocalStore();
    expect(await store.getThumbnail(plan.id)).toBe('data:image/jpeg;base64,NEWER');
  });

  it('rereads a plan that changed in the cloud during the upload, then decides again', async () => {
    const cloud = memoryCloud(), mac = device();
    const plan = createDefaultProject('Plan');
    const store = mac.use();
    await store.save(plan);
    await syncLibrary(cloud.provider);
    plan.name = 'Renamed';
    await store.save(plan);
    // Another device saves between this device's listing and its upload.
    const write = cloud.provider.write;
    cloud.provider.write = async (...args) => {
      cloud.provider.write = write;
      cloud.edit(plan.id, project => { project.name = 'Elsewhere'; });
      return write(...args);
    };
    const outcome = await syncLibrary(cloud.provider);
    expect(outcome.failed).toEqual([]);
    expect(outcome.conflicts).toEqual(['Elsewhere (Conflicted copy)']);
    expect(JSON.parse(cloud.files.get(plan.id)!.raw).name).toBe('Renamed');
  });
});
