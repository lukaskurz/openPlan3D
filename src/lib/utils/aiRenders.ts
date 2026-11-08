import type { AIRenderRecord, Project } from '$lib/models/types';
import { safePackagePath } from './projectPackageZip';
import { allPlanFloors } from './planAlternatives';

/**
 * Saved AI renders (Project.renders). Each record names a JPEG attachment in
 * projectPackage.assets for the render and, optionally, one for the 3D capture that
 * was sent to the model. The functions here are pure and edit the project passed in;
 * the store (stores/project.ts addAIRender / deleteAIRender) wraps them in Undo steps.
 */

/** Most renders one project keeps; each uses one or two of the package's 507 attachments. */
export const AI_RENDER_LIMIT = 250;
/** Attachments a project package can hold (services/projectPackage.ts). */
export const ATTACHMENT_LIMIT = 507;
const RENDER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RENDER_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:jpe?g|png)$/i;
const TEXT_LIMITS = { provider: 64, model: 256, alternativeId: 256, alternativeCode: 32, alternativeName: 1000, floorId: 256, prompt: 20_000, note: 4000 } as const;

/** Raw base64 bytes (no data: prefix) of a stored render image. */
export interface RenderImage { data: string; mime: 'image/jpeg' | 'image/png' }

export type NewAIRender = Omit<AIRenderRecord, 'assetName' | 'inputAssetName'>;

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A plain attachment filename a render may use. */
export function validRenderAssetName(name: unknown): name is string {
  return typeof name === 'string' && RENDER_ASSET.test(name) && safePackagePath(name);
}

/**
 * Validate `project.renders` (from readProject) and return the copy to keep.
 * Structural errors throw "Invalid project: …" like the rest of readProject. With
 * `assets` (the project has attachment storage), a render whose image is missing is
 * dropped and a missing input image is forgotten; without it (web.json inside a
 * package, whose attachments travel separately) the references are kept as they are.
 */
export function validateAIRenders(value: unknown, assets?: Record<string, string>): AIRenderRecord[] {
  const fail = (path: string, reason: string): never => { throw new Error(`Invalid project: ${path} ${reason}.`); };
  if (!Array.isArray(value)) fail('document.renders', 'must be an array');
  const list = value as unknown[];
  if (list.length > AI_RENDER_LIMIT) fail('document.renders', 'has an unsupported value');
  const seen = new Set<string>();
  const kept: AIRenderRecord[] = [];
  for (const [i, item] of list.entries()) {
    const path = `renders[${i}]`;
    if (!object(item)) fail(path, 'must be an object');
    const record = item as Record<string, any>;
    if (typeof record.id !== 'string' || !record.id.trim()) fail(`${path}.id`, 'must be nonempty text');
    if (!RENDER_ID.test(record.id)) fail(`${path}.id`, 'has an unsupported value');
    if (seen.has(record.id)) fail(`${path}.id`, 'duplicates another render');
    seen.add(record.id);
    if (!validRenderAssetName(record.assetName)) fail(`${path}.assetName`, 'has an unsupported value');
    if (record.inputAssetName !== undefined && !validRenderAssetName(record.inputAssetName)) fail(`${path}.inputAssetName`, 'has an unsupported value');
    const date = typeof record.createdAt === 'string' ? new Date(record.createdAt) : undefined;
    if (!date || !Number.isFinite(date.getTime())) fail(`${path}.createdAt`, 'must be a valid date');
    for (const key of ['provider', 'model'] as const) {
      if (typeof record[key] !== 'string' || !record[key].trim()) fail(`${path}.${key}`, 'must be nonempty text');
    }
    for (const [key, limit] of Object.entries(TEXT_LIMITS)) {
      if (record[key] === undefined) continue;
      if (typeof record[key] !== 'string') fail(`${path}.${key}`, 'must be text');
      if (record[key].length > limit) fail(`${path}.${key}`, 'has an unsupported value');
    }
    if (record.camera !== undefined) {
      const camera = record.camera;
      if (!object(camera)) fail(`${path}.camera`, 'must be an object');
      for (const key of ['position', 'target'] as const) {
        if (!object(camera[key])) fail(`${path}.camera.${key}`, 'must be an object');
        for (const axis of ['x', 'y', 'z']) {
          const n = camera[key][axis];
          if (typeof n !== 'number' || !Number.isFinite(n)) fail(`${path}.camera.${key}.${axis}`, 'must be a finite number in range');
        }
      }
      if (typeof camera.fov !== 'number' || !Number.isFinite(camera.fov) || camera.fov <= 0 || camera.fov >= 180) fail(`${path}.camera.fov`, 'must be a finite number in range');
    }
    if (assets !== undefined) {
      if (typeof assets[`assets/${record.assetName}`] !== 'string') continue;
      if (record.inputAssetName !== undefined && typeof assets[`assets/${record.inputAssetName}`] !== 'string') delete record.inputAssetName;
    }
    kept.push(record as AIRenderRecord);
  }
  return kept;
}

/** Attachment names the saved renders use (render and input images). */
export function aiRenderAssetNames(project: Pick<Project, 'renders'>): Set<string> {
  const names = new Set<string>();
  for (const render of project.renders ?? []) {
    names.add(render.assetName);
    if (render.inputAssetName) names.add(render.inputAssetName);
  }
  return names;
}

/** Saved renders newest first: all of them, or those of the plan alternative being edited. */
export function listAIRenders(project: Pick<Project, 'renders' | 'activeAlternativeId'>, scope: 'current' | 'all' = 'all'): AIRenderRecord[] {
  const renders = [...(project.renders ?? [])].reverse();
  const sorted = renders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (scope === 'all') return sorted;
  return sorted.filter(render => (render.alternativeId ?? null) === (project.activeAlternativeId ?? null));
}

/** "B · Kitchen open" style label of the alternative a render was made from, or ''. */
export function renderAlternativeLabel(render: Pick<AIRenderRecord, 'alternativeCode' | 'alternativeName'>): string {
  return [render.alternativeCode, render.alternativeName].filter(Boolean).join(' · ');
}

/** `data:image/…;base64,` URL of a stored render attachment, or undefined when missing. */
export function renderImageURL(project: Project, name: string | undefined): string | undefined {
  if (!name) return;
  const data = project.projectPackage?.assets?.[`assets/${name}`];
  if (typeof data !== 'string' || !data) return;
  return `data:${/\.png$/i.test(name) ? 'image/png' : 'image/jpeg'};base64,${data}`;
}

/** Split a `data:image/(png|jpeg);base64,` URL into its type and bytes. */
export function parseRenderDataURL(url: string): RenderImage | undefined {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  return match ? { mime: match[1] as RenderImage['mime'], data: match[2] } : undefined;
}

/** Whether something other than render `exceptId` uses attachment `name`. */
function referencedElsewhere(project: Project, name: string, exceptId: string): boolean {
  for (const render of project.renders ?? []) {
    if (render.id !== exceptId && (render.assetName === name || render.inputAssetName === name)) return true;
  }
  if (project.customModels?.some(model => model.assetName === name)) return true;
  for (const floor of allPlanFloors(project)) {
    for (const item of [...floor.walls, ...floor.doors, ...floor.windows, ...floor.furniture, ...floor.rooms]) {
      if (item.details?.photos?.includes(name)) return true;
    }
  }
  const native = project.projectPackage?.native;
  if (native?.underlay?.imageFilename === name) return true;
  for (const item of [...(native?.furniture ?? []), ...(native?.rooms ?? [])]) if (item?.photos?.includes?.(name)) return true;
  return false;
}

/**
 * Add a render record and its images to `project` (which must have attachment
 * storage). Identical image bytes already stored are reused, so two renders from the
 * same camera share one input attachment. Returns the stored record.
 */
export function insertAIRender(project: Project, record: NewAIRender, result: RenderImage, input?: RenderImage): AIRenderRecord {
  const state = project.projectPackage;
  if (!state) throw new Error('This project has no attachment storage for renders.');
  if (!RENDER_ID.test(record.id)) throw new Error('Invalid render id.');
  if (project.renders?.some(render => render.id === record.id)) throw new Error('A render with this id is already saved.');
  if ((project.renders?.length ?? 0) >= AI_RENDER_LIMIT) throw new Error(`This project already keeps ${AI_RENDER_LIMIT} renders. Delete older renders first.`);
  const assets = state.assets;
  const store = (image: RenderImage, base: string): string => {
    const reused = Object.entries(assets).find(([path, data]) => data === image.data && validRenderAssetName(path.slice(7)))?.[0];
    if (reused) return reused.slice(7);
    const name = `${base}.${image.mime === 'image/png' ? 'png' : 'jpg'}`;
    if (assets[`assets/${name}`] !== undefined) throw new Error('A different attachment has the same filename.');
    if (Object.keys(assets).length >= ATTACHMENT_LIMIT) throw new Error('This project already has the maximum number of attachments. Delete older renders first.');
    assets[`assets/${name}`] = image.data;
    return name;
  };
  const stored: AIRenderRecord = { ...structuredClone(record), assetName: store(result, `render-${record.id}`) };
  if (input) stored.inputAssetName = store(input, `render-${record.id}-input`);
  project.renders = [...(project.renders ?? []), stored];
  return structuredClone(stored);
}

/** Remove a render and the images nothing else uses. Returns false when it is not saved. */
export function removeAIRenderFrom(project: Project, id: string): boolean {
  const render = project.renders?.find(item => item.id === id);
  if (!render) return false;
  const assets = project.projectPackage?.assets;
  for (const name of new Set([render.assetName, render.inputAssetName].filter((n): n is string => !!n))) {
    if (!assets || referencedElsewhere(project, name, id)) continue;
    delete assets[`assets/${name}`];
    if (project.attachmentNames && Object.hasOwn(project.attachmentNames, name)) delete project.attachmentNames[name];
  }
  project.renders = project.renders!.filter(item => item.id !== id);
  if (!project.renders.length) delete project.renders;
  return true;
}

