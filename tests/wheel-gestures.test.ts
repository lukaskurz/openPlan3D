import { describe, expect, it } from 'vitest';
import { createWheelInterpreter, looksLikeMouseWheel } from '$lib/utils/wheelGestures';

const wheel = (deltaY: number, extra: Record<string, number | boolean> = {}) =>
  ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: 0, ...extra });

describe('wheel gestures', () => {
  it('tells a notched mouse wheel from a trackpad', () => {
    expect(looksLikeMouseWheel(wheel(4.000244140625, { wheelDeltaY: -120 }))).toBe(true); // macOS Chromium wheel
    expect(looksLikeMouseWheel(wheel(100, { wheelDeltaY: -120 }))).toBe(true);            // Windows wheel
    expect(looksLikeMouseWheel(wheel(3, { deltaMode: 1 }))).toBe(true);                   // Firefox lines
    expect(looksLikeMouseWheel(wheel(100))).toBe(true);                                   // Firefox pixel wheel
    expect(looksLikeMouseWheel(wheel(33.33, { wheelDeltaY: -40 }))).toBe(true);           // high-resolution wheel
    expect(looksLikeMouseWheel(wheel(-7, { wheelDeltaY: 21 }))).toBe(false);              // trackpad
    expect(looksLikeMouseWheel(wheel(2.5, { wheelDeltaY: -7 }))).toBe(false);             // rounded trackpad delta
    expect(looksLikeMouseWheel(wheel(40, { wheelDeltaY: -120 }))).toBe(false);            // fast trackpad swipe
    expect(looksLikeMouseWheel(wheel(2.5))).toBe(false);                                  // Firefox trackpad
    expect(looksLikeMouseWheel(wheel(5, { deltaX: 3, wheelDeltaY: -15 }))).toBe(false);
  });

  it('pans with vertical-only two-finger scrolling instead of zooming', () => {
    const interpret = createWheelInterpreter();
    expect(interpret(wheel(-6, { wheelDeltaY: 18 }))).toEqual({ kind: 'pan', dx: 0, dy: -6 });
    expect(interpret(wheel(0, { deltaX: 12, wheelDeltaY: 0 }))).toEqual({ kind: 'pan', dx: 12, dy: 0 });
  });

  it('keeps a trackpad gesture panning even if one event looks like a wheel', () => {
    const interpret = createWheelInterpreter();
    interpret(wheel(-3, { wheelDeltaY: 9, timeStamp: 1000 }));
    expect(interpret(wheel(100, { timeStamp: 1100 })).kind).toBe('pan');
    expect(interpret(wheel(100, { wheelDeltaY: -120, timeStamp: 2000 })).kind).toBe('wheel');
  });

  it('zooms smoothly on pinch, in proportion to the gesture', () => {
    const interpret = createWheelInterpreter();
    const small = interpret(wheel(-2, { ctrlKey: true })), large = interpret(wheel(-10, { ctrlKey: true }));
    expect(small).toEqual({ kind: 'zoom', factor: Math.exp(0.02) });
    expect(large.kind === 'zoom' && large.factor).toBeGreaterThan(small.kind === 'zoom' ? small.factor : 0);
    expect(interpret(wheel(4, { ctrlKey: true }))).toMatchObject({ kind: 'zoom' });
    expect((interpret(wheel(4, { ctrlKey: true })) as { factor: number }).factor).toBeLessThan(1);
  });

  it('zooms in fixed steps for a mouse wheel, with or without Ctrl/Cmd', () => {
    const interpret = createWheelInterpreter();
    expect(interpret(wheel(100, { wheelDeltaY: -120 }))).toEqual({ kind: 'wheel', direction: 1 });
    expect(interpret(wheel(-100, { wheelDeltaY: 120, metaKey: true }))).toEqual({ kind: 'zoom', factor: 1.1 });
  });
});
