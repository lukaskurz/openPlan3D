import { expect, it, vi } from 'vitest';
import type { Room } from '$lib/models/types';

vi.mock('$lib/utils/textureGenerator', () => ({
  getWallTextureCanvas: () => null,
  getFloorTextureCanvas: () => ({}) as HTMLCanvasElement,
}));

const { drawRoomFloorPattern } = await import('$lib/utils/canvasRenderer');
const { worldToScreen } = await import('$lib/utils/canvasInteraction');

/** Where the texture's pattern origin lands in world coordinates, and how many world cm one texture pixel covers. */
function patternFrame(zoom: number, camX: number, camY: number) {
  let tx = 0, ty = 0, s = 1;
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clip() {}, fillRect() {},
    translate(x: number, y: number) { tx += x * s; ty += y * s; },
    scale(k: number) { s *= k; },
    createPattern: () => ({}),
  } as unknown as CanvasRenderingContext2D;
  const cs = { ctx, width: 1180, height: 820, zoom, camX, camY };
  const poly = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }].map(p => worldToScreen(cs, p.x, p.y));
  drawRoomFloorPattern(cs, { id: 'r', name: 'Living Room', walls: [], area: 12, floorTexture: 'oak' } as unknown as Room, poly);
  return { x: (tx - cs.width / 2) / zoom + camX, y: (ty - cs.height / 2) / zoom + camY, cmPerPixel: s / zoom };
}

it('keeps the floor texture fixed to the plan while panning and zooming', () => {
  const reference = patternFrame(1, 200, 150);
  for (const [zoom, camX, camY] of [[1, -350, 80], [2.5, 200, 150], [0.4, 900, -600], [1.18, 13, 7]]) {
    const frame = patternFrame(zoom, camX, camY);
    expect(frame.x).toBeCloseTo(reference.x, 6);
    expect(frame.y).toBeCloseTo(reference.y, 6);
    expect(frame.cmPerPixel).toBeCloseTo(reference.cmPerPixel, 9);
  }
});
