import type { Attachment } from './session';

/** The model reads images up to about 1568 px on the long side; anything larger only costs upload time. */
const MAX_EDGE = 1568;
const THUMB_EDGE = 160;

function draw(bitmap: ImageBitmap, edge: number, quality: number): string {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export const PDF_MAX_BYTES = 3 * 1024 * 1024;

/** A PDF is sent as it is; the model reads its text and pages itself. */
export async function preparePdf(file: File): Promise<Attachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mediaType: 'application/pdf', data: btoa(binary), thumb: '', name: file.name, source: file };
}

/** A photo or sketch, shrunk and re-encoded as JPEG for the Assistant. */
export async function prepareImage(file: Blob): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  try {
    const full = draw(bitmap, MAX_EDGE, 0.85);
    return { mediaType: 'image/jpeg', data: full.slice(full.indexOf(',') + 1), thumb: draw(bitmap, THUMB_EDGE, 0.7), source: file };
  } finally {
    bitmap.close();
  }
}
