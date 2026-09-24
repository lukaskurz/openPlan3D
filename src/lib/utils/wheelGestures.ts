/**
 * Wheel-event interpretation for the 2D plan: trackpads pan with two fingers and
 * zoom with a pinch (ctrlKey wheel events); notched mouse wheels zoom.
 */

type WheelLike = Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'ctrlKey' | 'metaKey' | 'timeStamp'> & { wheelDeltaY?: number };

export type WheelAction =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'wheel'; direction: 1 | -1 };

/** Events closer together than this belong to one trackpad gesture (including momentum). */
const GESTURE_GAP_MS = 250;

/**
 * Chromium and WebKit report trackpad deltas in pixels with wheelDeltaY = -3 × deltaY,
 * while a notched wheel reports ±120 per notch whatever its pixel delta. Line/page modes are always a wheel.
 */
export function looksLikeMouseWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true;
  if (e.deltaX !== 0) return false;
  if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) {
    return Math.abs(e.wheelDeltaY + 3 * e.deltaY) > 1.5; // wheelDelta is rounded to whole numbers
  }
  // Without wheelDelta (Firefox in pixel mode), large whole-number steps are a wheel.
  return Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50;
}

/**
 * Pinch events are ctrl+wheel with small fractional deltas and arbitrary wheelDelta values,
 * so a zoom event only counts as a notched wheel on unmistakable evidence.
 */
function looksLikeCtrlMouseWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50) return true;
  const w = e.wheelDeltaY;
  return typeof w === 'number' && w !== 0 && Math.abs(w) % 120 === 0 && Math.abs(w + 3 * e.deltaY) > 1.5;
}

export const DEFAULT_ZOOM_SPEED = 3;

/** Zoom factor for one mouse-wheel notch (1.1 at the default speed). */
export function wheelStep(speed = DEFAULT_ZOOM_SPEED): number {
  return 1 + validSpeed(speed) / 30;
}

/** Scales a pinch's native scale change; the default follows the fingers at 30%. */
export function pinchFactor(scaleChange: number, speed = DEFAULT_ZOOM_SPEED): number {
  return Math.pow(scaleChange, validSpeed(speed) / 10);
}

function validSpeed(speed: number) {
  return Number.isFinite(speed) ? Math.max(1, Math.min(10, speed)) : DEFAULT_ZOOM_SPEED;
}

export function createWheelInterpreter(speed: () => number = () => DEFAULT_ZOOM_SPEED) {
  let lastTrackpadAt = -Infinity;
  return (e: WheelLike): WheelAction => {
    // Pinch arrives as ctrl+wheel with small fractional deltas; Ctrl/Cmd+wheel zooms too.
    if (e.ctrlKey || e.metaKey) {
      if (looksLikeCtrlMouseWheel(e)) return { kind: 'zoom', factor: e.deltaY > 0 ? 1 / wheelStep(speed()) : wheelStep(speed()) };
      // Chromium encodes a pinch as deltaY = -100 × ln(scale change).
      const delta = Math.max(-50, Math.min(50, e.deltaY));
      return { kind: 'zoom', factor: pinchFactor(Math.exp(-delta / 100), speed()) };
    }
    // Stay in pan mode for the rest of a trackpad gesture, even if one event looks like a wheel.
    const trackpad = e.timeStamp - lastTrackpadAt < GESTURE_GAP_MS || !looksLikeMouseWheel(e);
    if (trackpad) {
      lastTrackpadAt = e.timeStamp;
      return { kind: 'pan', dx: e.deltaX, dy: e.deltaY };
    }
    return { kind: 'wheel', direction: e.deltaY > 0 ? 1 : -1 };
  };
}
