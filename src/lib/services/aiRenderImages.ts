import { photoHeader } from '$lib/utils/rasterHeader';
import type { RenderImage } from '$lib/utils/aiRenders';

/** JPEG quality for stored renders and captures; keeps a 1024×576 render near 100–200 KiB. */
export const RENDER_JPEG_QUALITY = 0.85;
/** Longest stored edge; 4K renders are scaled down to keep projects small on iPad. */
export const RENDER_MAX_EDGE = 2048;
/** Largest image data URL accepted for saving (about 24 MiB of image bytes). */
const RENDER_INPUT_LIMIT = 32 * 1024 * 1024;

const base64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

/**
 * Re-encode an image data URL (PNG, JPEG, WebP… whatever the browser decodes) as a
 * JPEG of at most RENDER_MAX_EDGE pixels on its longest edge, on a white background.
 * JPEG rather than WebP because Safari on iPad cannot encode WebP.
 */
export async function encodeRenderJPEG(dataUrl: string, quality = RENDER_JPEG_QUALITY, maxEdge = RENDER_MAX_EDGE): Promise<RenderImage> {
  if (typeof dataUrl !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) || dataUrl.length > RENDER_INPUT_LIMIT) {
    throw new Error('The render image is not an embedded image.');
  }
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); }
  catch { throw new Error('The render image could not be decoded.'); }
  try {
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error('The render image is empty.');
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image encoding is unavailable in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('The render image could not be encoded.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // A browser that cannot write JPEG falls back to PNG; store whichever it produced.
    const mime = photoHeader(bytes)?.mime;
    if (mime !== 'image/jpeg' && mime !== 'image/png') throw new Error('The render image could not be encoded.');
    canvas.width = canvas.height = 0; // Free the bitmap promptly on iPad.
    return { data: base64(bytes), mime };
  } finally {
    image.src = '';
  }
}
