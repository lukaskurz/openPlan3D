import type { Floor, FurnitureItem, Project } from '$lib/models/types';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { itemDetails } from '$lib/utils/itemDetails';
import { photoHeader } from '$lib/utils/rasterHeader';

/**
 * Reference photos for the AI render: furniture that carries a photo of the real
 * product (details.photos, bytes in projectPackage.assets) is sent to the image
 * model after the scene screenshot, so the render shows that product instead of
 * the procedural placeholder geometry.
 */
export interface AIRenderReference {
  /** Items this photo stands for (identical photos are sent once). */
  itemIds: string[];
  /** Short text that precedes the image, naming the item(s). */
  label: string;
  mimeType: string;
  /** Raw base64 bytes, no data: prefix. */
  data: string;
}

/** A furniture item seen by the interior camera, nearest first, with an optional image position. */
export interface VisibleItem { id: string; hint?: string }

/** Per-image limit on the base64 text; item photos are stored at ≤ 512 KiB, imports can be larger. */
export const REFERENCE_MAX_BASE64 = 2 * 1024 * 1024;
/** Limit on all reference images together; Gemini rejects inline requests above 20 MB. */
export const REFERENCE_TOTAL_BASE64 = 12 * 1024 * 1024;

const MODEL_LIMITS: Record<string, number> = {
  'gemini-2.5-flash-image': 3,
  'gemini-3-pro-image-preview': 8,
};
export const DEFAULT_REFERENCE_LIMIT = 3;
export const OPENAI_REFERENCE_LIMIT = 4;

/** How many reference photos a render request carries for this provider and model. */
export function referenceLimit(provider: 'gemini' | 'openai', model: string): number {
  if (provider === 'openai') return OPENAI_REFERENCE_LIMIT;
  return MODEL_LIMITS[model] ?? DEFAULT_REFERENCE_LIMIT;
}

/** JPG or PNG bytes of a stored attachment, or undefined when missing, oversized or not a raster. */
export function resolvePhoto(project: Project, name: string): { mimeType: string; data: string } | undefined {
  const data = project.projectPackage?.assets?.[`assets/${name}`];
  if (typeof data !== 'string' || !data || data.length > REFERENCE_MAX_BASE64) return;
  try {
    // Enough base64 (a multiple of 4) for the PNG header or the JPEG frame header after metadata.
    const head = atob(data.slice(0, 262_144));
    const info = photoHeader(Uint8Array.from(head, char => char.charCodeAt(0)));
    if (!info || info.width <= 0 || info.height <= 0) return;
    return { mimeType: info.mime, data };
  } catch { return; }
}

function itemName(item: FurnitureItem, project: Project): string {
  const custom = item.customModelId ? project.customModels?.find(model => model.id === item.customModelId) : undefined;
  return custom?.name?.trim() || getCatalogItem(item.catalogId)?.name || item.sourceCategory || 'Furniture item';
}

function itemSize(item: FurnitureItem, project: Project): string | undefined {
  const custom = item.customModelId ? project.customModels?.find(model => model.id === item.customModelId) : undefined;
  const catalog = getCatalogItem(item.catalogId);
  const size = (value: number | undefined, scale = 1) => value && Number.isFinite(value) ? Math.round(value * Math.abs(scale || 1)) : undefined;
  const w = size(item.width ?? custom?.width ?? catalog?.width, item.scale?.x);
  const d = size(item.depth ?? custom?.depth ?? catalog?.depth, item.scale?.y);
  const h = size(item.height ?? custom?.height ?? catalog?.height, item.scale?.z);
  return w && d && h ? `${w} × ${d} × ${h} cm (W × D × H)` : undefined;
}

function sourceLink(item: FurnitureItem, project: Project): string | undefined {
  const url = item.customModelId ? project.customModels?.find(model => model.id === item.customModelId)?.sourceUrl : undefined;
  return url && /^https?:\/\//i.test(url) && url.length <= 300 ? url : undefined;
}

/** One line describing an item for the model: name, size, where it appears, product link. */
export function referenceItemText(item: FurnitureItem, project: Project, hint?: string): string {
  const parts = [itemName(item, project)];
  const size = itemSize(item, project);
  if (size) parts.push(size);
  if (hint) parts.push(hint);
  const link = sourceLink(item, project);
  if (link) parts.push(`product page ${link}`);
  return parts.join(', ');
}

/**
 * Reference photos for the furniture of `floor`. With `visible` (from a frustum test,
 * nearest first) only those items are used, in that order; without it every item
 * with a photo is. Each item contributes its first usable JPG or PNG photo; items
 * sharing the same photo are sent once. At most `limit` photos and
 * REFERENCE_TOTAL_BASE64 of image data are returned.
 */
export function collectRenderReferences(project: Project, floor: Pick<Floor, 'id' | 'furniture'>, limit: number,
  visible?: VisibleItem[]): AIRenderReference[] {
  if (limit <= 0 || !project.projectPackage) return [];
  const byId = new Map(floor.furniture.map(item => [item.id, item]));
  const candidates: { item: FurnitureItem; hint?: string }[] = visible
    ? visible.flatMap(({ id, hint }) => byId.has(id) ? [{ item: byId.get(id)!, hint }] : [])
    : floor.furniture.map(item => ({ item }));
  const groups = new Map<string, { photo: { mimeType: string; data: string }; entries: { item: FurnitureItem; hint?: string }[] }>();
  const seen = new Set<string>();
  let total = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.item.id)) continue;
    seen.add(candidate.item.id);
    const names = itemDetails(project, { floorId: floor.id, kind: 'furniture', id: candidate.item.id }).photos ?? [];
    let photo: { mimeType: string; data: string } | undefined;
    for (const name of names) if ((photo = resolvePhoto(project, name))) break;
    if (!photo) continue;
    const group = groups.get(photo.data);
    if (group) { group.entries.push(candidate); continue; }
    if (groups.size >= limit || total + photo.data.length > REFERENCE_TOTAL_BASE64) continue;
    total += photo.data.length;
    groups.set(photo.data, { photo, entries: [candidate] });
  }
  return [...groups.values()].map(({ photo, entries }, index) => {
    const first = entries[0];
    const count = entries.length > 1 ? ` (the same product is used for ${entries.length} items in the scene)` : '';
    return {
      itemIds: entries.map(entry => entry.item.id),
      label: `Reference image ${index + 2}: real product photo of the ${referenceItemText(first.item, project, first.hint)}${count}.`,
      mimeType: photo.mimeType,
      data: photo.data,
    };
  });
}

/** Extra prompt text, only when reference photos are sent. */
export function referencePromptAddendum(references: AIRenderReference[]): string {
  if (!references.length) return '';
  const count = references.length === 1 ? 'Image 2 is a reference photo' : `Images 2 to ${references.length + 1} are reference photos`;
  return `The first image is the scene to transform. ${count} of the real products for the items named before each photo. ` +
    `Render each named item to match its reference photo's shape, material and colour, while keeping the position, size and orientation it has in the first image. ` +
    `Do not copy the reference photos' backgrounds, lighting or camera angle, and do not add products that are not in the first image. ` +
    `Render every other item as a realistic real-world object of its kind rather than the simplified blocky placeholder geometry, keeping its position and size. `;
}

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/** Gemini request parts: the scene screenshot first, then each label and reference photo, then the prompt. */
export function geminiRenderParts(sceneBase64: string, prompt: string, references: AIRenderReference[]): GeminiPart[] {
  return [
    { inlineData: { mimeType: 'image/png', data: sceneBase64 } },
    ...references.flatMap((reference): GeminiPart[] => [
      { text: reference.label },
      { inlineData: { mimeType: reference.mimeType, data: reference.data } },
    ]),
    { text: prompt },
  ];
}
