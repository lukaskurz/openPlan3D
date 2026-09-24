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

export function createWheelInterpreter() {
  let lastTrackpadAt = -Infinity;
  return (e: WheelLike): WheelAction => {
    // Pinch arrives as ctrl+wheel with small fractional deltas; Ctrl/Cmd+wheel zooms too.
    if (e.ctrlKey || e.metaKey) {
      if (looksLikeMouseWheel(e)) return { kind: 'zoom', factor: e.deltaY > 0 ? 0.9 : 1.1 };
      const delta = Math.max(-50, Math.min(50, e.deltaY));
      return { kind: 'zoom', factor: Math.exp(-delta * 0.01) };
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
