import { get } from 'svelte/store';
import { locale } from '$lib/i18n';
import {
  currentProject, viewMode, setBackgroundImage, canvasCamX, canvasCamY, createDefaultProject,
} from '$lib/stores/project';
import { exportAsJSON, exportAsSVG } from '$lib/utils/export';
import { exportDXF } from '$lib/utils/cadExport';
import { exportNotice, exportPNGWithFeedback, exportPDFWithFeedback } from '$lib/stores/exportNotice';
import { captureMain3DPNG } from '$lib/utils/captureMain3D';
import { openProject } from '$lib/services/projectOpening';
import { createProjectFromRoomPlan, extractRoomJsonFromZip, isRoomPlanJson } from '$lib/utils/roomplanImport';
import { roomPresets } from '$lib/utils/roomPresets';
import { roomTemplates, placeRoomTemplate } from '$lib/utils/roomTemplates';

/** Ask for a file with a hidden input. Resolves with null when the picker is dismissed. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Trace image: put a photo or drawing under the plan at 40% opacity. */
export async function traceImage() {
  const file = await pickFile('image/*');
  if (!file) return;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  setBackgroundImage({
    dataUrl,
    position: { x: get(canvasCamX), y: get(canvasCamY) },
    scale: 1,
    opacity: 0.4,
    rotation: 0,
    locked: false,
  });
}

/** Drop a ready-made room shape at the centre of the view. */
export function placeRoomShape(presetId: string, templateName?: string) {
  const preset = roomPresets.find(p => p.id === presetId);
  if (!preset) return;
  const template = templateName ? roomTemplates.find(t => t.name === templateName) ?? null : null;
  placeRoomTemplate(preset, { x: get(canvasCamX), y: get(canvasCamY) }, template);
}

/** Open a project file (JSON, or an iPhone RoomPlan scan) as a new project. */
export async function importProjectFile(signal?: AbortSignal) {
  const file = await pickFile('.json,.zip');
  if (!file) return;
  await openProject(async () => {
    const data = /\.zip$/i.test(file.name)
      ? await extractRoomJsonFromZip(file)
      : JSON.parse(await file.text());
    return isRoomPlanJson(data)
      ? createProjectFromRoomPlan(data, file.name.replace(/\.(json|zip)$/i, ''))
      : data;
  }, 'import', signal);
}

export async function newProject(signal?: AbortSignal) {
  await openProject(() => createDefaultProject(), 'new', signal);
}

export type ExportFormat = 'pdf' | 'png' | 'png3d' | 'svg' | 'dxf' | 'json' | 'package';

export async function exportAs(format: ExportFormat, signal?: AbortSignal) {
  const project = get(currentProject);
  if (!project) return;
  switch (format) {
    case 'pdf': await exportPDFWithFeedback(project); break;
    case 'png': await exportPNGWithFeedback(project); break;
    case 'svg': exportAsSVG(project, get(locale)); break;
    case 'dxf': exportDXF(project, get(locale)); break;
    case 'json': exportAsJSON(project); break;
    case 'package': {
      const snapshot = structuredClone(project);
      const { downloadProjectPackage } = await import('$lib/services/projectPackage');
      if (!signal?.aborted) downloadProjectPackage(snapshot);
      break;
    }
    case 'png3d': await export3DImage(signal); break;
  }
}

/** Switch to 3D long enough to capture a picture, then come back. */
export async function export3DImage(signal?: AbortSignal) {
  const project = get(currentProject);
  const oldMode = get(viewMode);
  exportNotice.set(null);
  viewMode.set('3d');
  try {
    const blob = await captureMain3DPNG(signal ?? new AbortController().signal);
    const current = get(currentProject);
    if (current?.id !== project?.id || current?.activeFloorId !== project?.activeFloorId) return;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url; link.download = `${project?.name || 'floorplan'}-3d.png`; link.click();
    } finally { URL.revokeObjectURL(url); }
  } catch {
    if (!signal?.aborted) exportNotice.set({ title: 'exportNotice.png3DTitle', message: 'exportNotice.png3DFailed' });
  } finally {
    if (!signal?.aborted && oldMode === '2d' && get(viewMode) === '3d') viewMode.set('2d');
  }
}
