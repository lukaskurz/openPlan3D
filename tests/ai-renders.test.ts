import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import type { Project } from '$lib/models/types';

// Node has no canvas: stand in for the JPEG encoder and keep the bytes, marked as JPEG.
// A plain function (not vi.fn), since the config's restoreMocks would undo a mock implementation.
const encoder = vi.hoisted(() => ({ hold: null as Promise<void> | null, calls: 0 }));
vi.mock('$lib/services/aiRenderImages', () => ({
  async encodeRenderJPEG(url: string) {
    encoder.calls++;
    if (encoder.hold) await encoder.hold;
    return { data: url.slice(url.indexOf(',') + 1), mime: 'image/jpeg' as const };
  },
}));

import { addAIRender, createAlternative, currentProject, deleteAIRender, loadProject, redo, undo, undoHistoryStore } from '$lib/stores/project';
import { readProject } from '$lib/utils/projectValidation';
import { listAIRenders, renderAlternativeLabel } from '$lib/utils/aiRenders';
import { projectPackageBytes, readProjectPackage } from '$lib/services/projectPackage';
import { readSnapshotStorage, writeSnapshotStorage } from '$lib/utils/snapshotStorage';
import { deleteUnusedPhoto, usedPhotoNames } from '$lib/services/itemPhotos';
import { createLocalStore } from '$lib/services/datastore';
import { roomProject } from './fixtures/project';
import { mockStorage } from './fixtures/indexeddb';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6WQAAAAASUVORK5CYII=';
const PHOTO = readFileSync('tests/fixtures/item-photo.png').toString('base64');
const UNDERLAY = readFileSync('tests/fixtures/underlay-orientation.png').toString('base64');
const png = (data: string) => `data:image/png;base64,${data}`;
const project = () => get(currentProject)!;
const assets = () => project().projectPackage!.assets;

function open(): Project {
  const p = roomProject();
  p.id = 'render-test-project';
  loadProject(p);
  return p;
}

beforeEach(() => { mockStorage(); encoder.hold = null; encoder.calls = 0; });

describe('addAIRender', () => {
  it('stores the render and its 3D input as JPEG attachments in one undoable step', async () => {
    open();
    const record = await addAIRender({ provider: 'gemini', model: 'gemini-3.1-flash-image', prompt: 'Make it real',
      camera: { position: { x: 1, y: 160, z: 2 }, target: { x: 100, y: 120, z: 2 }, fov: 90 } }, png(PHOTO), png(PIXEL));
    expect(encoder.calls).toBe(2);
    expect(record.assetName).toBe(`render-${record.id}.jpg`);
    expect(record.inputAssetName).toBe(`render-${record.id}-input.jpg`);
    expect(record.floorId).toBe(project().activeFloorId);
    expect(Number.isFinite(Date.parse(record.createdAt))).toBe(true);
    expect(project().renders).toEqual([record]);
    expect(assets()[`assets/${record.assetName}`]).toBe(PHOTO);
    expect(assets()[`assets/${record.inputAssetName}`]).toBe(PIXEL);
    expect(get(undoHistoryStore).entries.map(entry => entry.description)).toEqual(['Saved AI render']);

    undo();
    expect(project().renders).toBeUndefined();
    expect(project().projectPackage).toBeUndefined();
    redo();
    expect(project().renders).toEqual([record]);
    expect(assets()[`assets/${record.assetName}`]).toBe(PHOTO);
  });

  it('keeps images as given with encode: false and rejects images that are not PNG or JPEG', async () => {
    open();
    const record = await addAIRender({ provider: 'script', model: 'external', note: 'From a script' }, png(PHOTO), undefined, { encode: false });
    expect(encoder.calls).toBe(0);
    expect(record.assetName).toMatch(/\.png$/);
    expect(record.inputAssetName).toBeUndefined();
    await expect(addAIRender({ provider: 'x', model: 'y' }, 'data:image/webp;base64,AAAA', undefined, { encode: false })).rejects.toThrow(/PNG or JPEG/);
    expect(project().renders).toHaveLength(1);
  });

  it('records the plan alternative and filters by it', async () => {
    open();
    const before = await addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO), png(PIXEL));
    expect(before.alternativeId).toBeUndefined();
    createAlternative({ name: 'Open kitchen' });
    const [original, second] = project().alternatives!;
    // A render made before there were alternatives belongs to the original plan.
    expect(project().renders![0]).toMatchObject({ alternativeId: original.id, alternativeCode: original.code, alternativeName: original.name });
    const after = await addAIRender({ provider: 'gemini', model: 'm' }, png(UNDERLAY), png(PIXEL));
    expect(after).toMatchObject({ alternativeId: second.id, alternativeCode: 'B', alternativeName: 'Open kitchen' });
    expect(renderAlternativeLabel(after)).toBe('B · Open kitchen');
    expect(listAIRenders(project(), 'current').map(r => r.id)).toEqual([after.id]);
    expect(listAIRenders(project(), 'all').map(r => r.id)).toEqual([after.id, before.id]);
  });

  it('does not save into a project opened while the images were being encoded', async () => {
    open();
    let release!: () => void;
    encoder.hold = new Promise(resolve => { release = resolve; });
    const pending = addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO));
    const other = roomProject(); other.id = 'another-project';
    loadProject(other);
    release();
    await expect(pending).rejects.toThrow(/project changed/);
    expect(project().renders).toBeUndefined();
  });
});

describe('deleteAIRender', () => {
  it('shares an identical 3D input and removes images only when nothing uses them', async () => {
    open();
    const first = await addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO), png(PIXEL));
    const second = await addAIRender({ provider: 'gemini', model: 'm' }, png(UNDERLAY), png(PIXEL));
    expect(second.inputAssetName).toBe(first.inputAssetName);
    expect(Object.keys(assets())).toHaveLength(3);

    deleteAIRender(first.id);
    expect(project().renders!.map(r => r.id)).toEqual([second.id]);
    expect(assets()[`assets/${first.assetName}`]).toBeUndefined();
    expect(assets()[`assets/${first.inputAssetName}`]).toBe(PIXEL);

    deleteAIRender(second.id);
    expect(project().renders).toBeUndefined();
    expect(assets()).toEqual({});
    expect(get(undoHistoryStore).entries.at(-1)?.description).toBe('Deleted AI render');

    undo();
    expect(project().renders!.map(r => r.id)).toEqual([second.id]);
    expect(assets()[`assets/${second.assetName}`]).toBe(UNDERLAY);
    deleteAIRender('missing');
    expect(project().renders).toHaveLength(1);
  });

  it('counts render images as used attachments, so Item details cannot delete them', async () => {
    open();
    const record = await addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO), png(PIXEL));
    const used = usedPhotoNames(project());
    expect(used.has(record.assetName)).toBe(true);
    expect(used.has(record.inputAssetName!)).toBe(true);
    expect(() => deleteUnusedPhoto(project(), record.assetName)).toThrow(/still used/);
  });
});

describe('validation and storage', () => {
  const base = () => {
    const p: any = roomProject();
    p.projectPackage = { version: 1, native: { furniture: [], rooms: [], walls: [], openings: [] }, mapping: [], assets: { 'assets/render-a.jpg': PHOTO, 'assets/render-a-input.jpg': PIXEL } };
    p.renders = [{ id: 'a', assetName: 'render-a.jpg', inputAssetName: 'render-a-input.jpg', createdAt: '2026-11-08T10:00:00.000Z', provider: 'gemini', model: 'm',
      camera: { position: { x: 0, y: 160, z: 0 }, target: { x: 1, y: 160, z: 0 }, fov: 90 } }];
    return p;
  };

  it('keeps valid renders and rejects malformed ones', () => {
    expect(readProject(base()).renders).toEqual(base().renders);
    const cases: [(p: any) => void, RegExp][] = [
      [p => { p.renders = {}; }, /renders must be an array/],
      [p => { p.renders.push({ ...p.renders[0] }); }, /renders\[1\]\.id duplicates another render/],
      [p => { p.renders[0].assetName = '../escape.jpg'; }, /assetName has an unsupported value/],
      [p => { p.renders[0].assetName = 'render-a.glb'; }, /assetName has an unsupported value/],
      [p => { p.renders[0].createdAt = 'yesterday'; }, /createdAt must be a valid date/],
      [p => { p.renders[0].model = ''; }, /model must be nonempty text/],
      [p => { p.renders[0].note = 5; }, /note must be text/],
      [p => { p.renders[0].camera.fov = 0; }, /camera\.fov must be a finite number/],
      [p => { p.renders[0].camera.target = null; }, /camera\.target must be an object/],
    ];
    for (const [change, message] of cases) {
      const p = base(); change(p);
      expect(() => readProject(p)).toThrow(message);
    }
  });

  it('drops renders whose image is missing, but keeps detached renders without attachment storage', () => {
    const missing = base();
    delete missing.projectPackage.assets['assets/render-a-input.jpg'];
    expect(readProject(missing).renders![0].inputAssetName).toBeUndefined();
    delete missing.projectPackage.assets['assets/render-a.jpg'];
    expect(readProject(missing).renders).toEqual([]);
    const detached = base(); delete detached.projectPackage;
    expect(readProject(detached).renders).toEqual(base().renders);
  });

  it('round-trips renders and their images through a project package', async () => {
    open();
    const record = await addAIRender({ provider: 'openai', model: 'gpt-image-1', prompt: 'p' }, png(PHOTO), png(PIXEL));
    const { project: imported } = readProjectPackage(projectPackageBytes(project()));
    expect(imported.renders).toEqual([record]);
    expect(imported.projectPackage!.assets[`assets/${record.assetName}`]).toBe(PHOTO);
    expect(imported.projectPackage!.assets[`assets/${record.inputAssetName}`]).toBe(PIXEL);
  });

  it('survives a save and reload from the local library', async () => {
    open();
    const record = await addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO), png(PIXEL));
    await createLocalStore().save(project());
    const loaded = await createLocalStore().load(project().id);
    expect(loaded?.renders).toEqual([record]);
    expect(loaded?.projectPackage?.assets[`assets/${record.assetName}`]).toBe(PHOTO);
  });

  it('stores each render image once across saved versions', async () => {
    open();
    await addAIRender({ provider: 'gemini', model: 'm' }, png(PHOTO), png(PIXEL));
    const one = JSON.stringify(project());
    await addAIRender({ provider: 'gemini', model: 'm' }, png(UNDERLAY), png(PIXEL));
    const two = JSON.stringify(project());
    const snapshots = [one, one, two, two].map((data, i) => ({ timestamp: i, description: `v${i}`, data }));
    const raw = writeSnapshotStorage(snapshots), stored = JSON.parse(raw);
    // PHOTO, PIXEL (shared input) and UNDERLAY: three images for four versions.
    expect(Object.values(stored.assets).sort()).toEqual([PHOTO, PIXEL, UNDERLAY].sort());
    for (const image of [PHOTO, UNDERLAY]) expect(raw.split(image).length - 1).toBe(1);
    expect(readSnapshotStorage(raw)).toEqual(snapshots);
    expect(JSON.parse((readSnapshotStorage(raw)[3] as any).data).renders).toHaveLength(2);
  });
});
