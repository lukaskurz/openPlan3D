import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Floor, FurnitureItem, Project } from '$lib/models/types';
import {
  collectRenderReferences, geminiRenderParts, referenceLimit, referencePromptAddendum, resolvePhoto,
  REFERENCE_MAX_BASE64,
} from '$lib/utils/aiRenderReferences';
import { generateOpenAIRenderImage } from '$lib/utils/openaiClient';

const png = readFileSync('tests/fixtures/item-photo.png').toString('base64');
// A tiny JPEG header: SOI, then SOF0 with height 20, width 30.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x14, 0x00, 0x1e, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]).toString('base64');
const text = Buffer.from('not an image at all').toString('base64');

const item = (id: string, extra: Partial<FurnitureItem> = {}): FurnitureItem => ({
  id, catalogId: 'chair', position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra,
});
function project(furniture: FurnitureItem[], assets: Record<string, string>, extra: Partial<Project> = {}): { project: Project; floor: Floor } {
  const floor = { id: 'f1', name: 'Ground', walls: [], doors: [], windows: [], rooms: [], furniture } as unknown as Floor;
  const p = {
    id: 'p1', name: 'Test', floors: [floor], activeFloorId: 'f1',
    projectPackage: { version: 1, native: {}, mapping: [], assets: Object.fromEntries(Object.entries(assets).map(([k, v]) => [`assets/${k}`, v])) },
    ...extra,
  } as unknown as Project;
  return { project: p, floor };
}

describe('AI render reference photos', () => {
  it('caps references per model', () => {
    expect(referenceLimit('gemini', 'gemini-2.5-flash-image')).toBe(3);
    expect(referenceLimit('gemini', 'gemini-3-pro-image-preview')).toBe(8);
    expect(referenceLimit('gemini', 'some-future-model')).toBe(3);
    expect(referenceLimit('openai', 'gpt-4.1')).toBe(4);
  });

  it('resolves stored attachments to raster base64 and skips missing, non-raster or oversized ones', () => {
    const { project: p } = project([], { 'a.png': png, 'b.jpg': jpeg, 'c.txt': text, 'd.png': 'A'.repeat(REFERENCE_MAX_BASE64 + 4), 'e.png': '%%%' });
    expect(resolvePhoto(p, 'a.png')).toEqual({ mimeType: 'image/png', data: png });
    expect(resolvePhoto(p, 'b.jpg')).toEqual({ mimeType: 'image/jpeg', data: jpeg });
    expect(resolvePhoto(p, 'c.txt')).toBeUndefined();
    expect(resolvePhoto(p, 'd.png')).toBeUndefined();
    expect(resolvePhoto(p, 'e.png')).toBeUndefined();
    expect(resolvePhoto(p, 'missing.png')).toBeUndefined();
  });

  it('labels each item with its name and size, uses the first usable photo and skips items without photos', () => {
    const { project: p, floor } = project([
      item('plain'),
      item('chair', { details: { photos: ['broken.txt', 'chair.png', 'other.jpg'] }, width: 90, scale: { x: 2, y: 1, z: 1 } }),
      item('custom', { catalogId: 'unknown_thing', customModelId: 'm1', details: { photos: ['lamp.jpg'] } }),
    ], { 'broken.txt': text, 'chair.png': png, 'other.jpg': jpeg, 'lamp.jpg': jpeg }, {
      customModels: [{ id: 'm1', name: 'Arco floor lamp', assetName: 'arco.glb', sourceFilename: 'arco.glb', sha256: '', byteLength: 1,
        width: 40, depth: 200, height: 240, sourceUrl: 'https://shop.example/arco-lamp' }],
    });
    const refs = collectRenderReferences(p, floor, 3);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ itemIds: ['chair'], mimeType: 'image/png', data: png });
    expect(refs[0].label).toBe('Reference image 2: real product photo of the Armchair, 180 × 80 × 90 cm (W × D × H).');
    expect(refs[1]).toMatchObject({ itemIds: ['custom'], mimeType: 'image/jpeg' });
    expect(refs[1].label).toContain('Arco floor lamp, 40 × 200 × 240 cm (W × D × H), product page https://shop.example/arco-lamp');
    expect(refs[1].label).toMatch(/^Reference image 3:/);
  });

  it('prefers the visible items in their order with their position hints, and caps the count', () => {
    const items = ['a', 'b', 'c', 'd'].map(id => item(id, { details: { photos: [`${id}.png`] } }));
    // Different bytes per photo so none are merged.
    const assets = Object.fromEntries(['a', 'b', 'c', 'd'].map((id, i) =>
      [`${id}.png`, Buffer.concat([Buffer.from(png, 'base64'), Buffer.alloc(i + 1)]).toString('base64')]));
    const { project: p, floor } = project(items, assets);
    expect(collectRenderReferences(p, floor, 3).map(r => r.itemIds[0])).toEqual(['a', 'b', 'c']);
    const visible = collectRenderReferences(p, floor, 8, [{ id: 'd', hint: 'on the left of the scene' }, { id: 'ghost' }, { id: 'b' }]);
    expect(visible.map(r => r.itemIds[0])).toEqual(['d', 'b']);
    expect(visible[0].label).toContain('on the left of the scene');
    expect(collectRenderReferences(p, floor, 8, [])).toEqual([]);
    expect(collectRenderReferences(p, floor, 0)).toEqual([]);
  });

  it('sends a photo shared by several items once', () => {
    const { project: p, floor } = project([
      item('c1', { catalogId: 'dining_chair', details: { photos: ['chair.png'] } }),
      item('c2', { catalogId: 'dining_chair', details: { photos: ['chair.png'] } }),
    ], { 'chair.png': png });
    const refs = collectRenderReferences(p, floor, 3);
    expect(refs).toHaveLength(1);
    expect(refs[0].itemIds).toEqual(['c1', 'c2']);
    expect(refs[0].label).toContain('Dining Chair');
    expect(refs[0].label).toContain('used for 2 items');
  });

  it('builds Gemini parts with the scene first and extends the prompt only with references', () => {
    expect(referencePromptAddendum([])).toBe('');
    expect(geminiRenderParts('SCENE', 'prompt', [])).toEqual([{ inlineData: { mimeType: 'image/png', data: 'SCENE' } }, { text: 'prompt' }]);
    const refs = [{ itemIds: ['a'], label: 'Reference image 2: sofa.', mimeType: 'image/jpeg', data: 'JPG' }];
    expect(geminiRenderParts('SCENE', 'prompt', refs)).toEqual([
      { inlineData: { mimeType: 'image/png', data: 'SCENE' } },
      { text: 'Reference image 2: sofa.' },
      { inlineData: { mimeType: 'image/jpeg', data: 'JPG' } },
      { text: 'prompt' },
    ]);
    const addendum = referencePromptAddendum(refs);
    expect(addendum).toContain('Image 2 is a reference photo');
    expect(addendum).toContain('position, size and orientation');
    expect(addendum).toContain('blocky placeholder');
    expect(referencePromptAddendum([...refs, ...refs])).toContain('Images 2 to 3 are reference photos');
  });

  it('passes labelled reference images to the OpenAI Responses request after the scene', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ output: [{ type: 'image_generation_call', result: 'iVBORw0KGgo=' }] }),
      { headers: { 'content-type': 'application/json' } }));
    await generateOpenAIRenderImage({ apiKey: 'k' }, 'SCENE', 'prompt', fetcher, undefined, [{ label: 'Reference image 2: sofa.', mimeType: 'image/jpeg', data: 'JPG' }]);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).input[0].content).toEqual([
      { type: 'input_image', image_url: 'data:image/png;base64,SCENE' },
      { type: 'input_text', text: 'Reference image 2: sofa.' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,JPG' },
      { type: 'input_text', text: 'prompt' },
    ]);
  });
});
