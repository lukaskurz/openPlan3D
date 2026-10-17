import { describe, expect, it } from 'vitest';
import { createWheelInterpreter, looksLikeMouseWheel, pinchFactor, wheelStep } from '$lib/utils/wheelGestures';

const wheel = (deltaY: number, extra: Record<string, number | boolean> = {}) =>
  ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, timeStamp: 0, ...extra });
const factor = (action: unknown) => (action as { kind: 'zoom'; factor: number }).factor;

// Recorded from a MacBook trackpad pinch in Chromium: small fractional deltas, wheelDeltaY always ±120.
const recordedPinchOut = [-0.3168802261352539, -1.4978206157684326, -1.9477652311325073, -2.2749509811401367, -2.7837672233581543, -2.8134424686431885, -2.9661312103271484, -2.700629234313965];
const recordedPinchIn = [0.2000901848077774, 1.0507279634475708, 0.9644134044647217, 1.9086636304855347, 1.0769453048706055];

describe('wheel gestures', () => {
  it('tells a notched mouse wheel from a trackpad', () => {
    expect(looksLikeMouseWheel(wheel(4.000244140625, { wheelDeltaY: -120 }))).toBe(true); // macOS Chromium wheel
    expect(looksLikeMouseWheel(wheel(100, { wheelDeltaY: -120 }))).toBe(true);            // Windows wheel
    expect(looksLikeMouseWheel(wheel(33.33, { wheelDeltaY: -40 }))).toBe(true);           // high-resolution wheel
    expect(looksLikeMouseWheel(wheel(3, { deltaMode: 1 }))).toBe(true);                   // Firefox lines
    expect(looksLikeMouseWheel(wheel(100))).toBe(true);                                   // Firefox pixel wheel
    expect(looksLikeMouseWheel(wheel(-7, { wheelDeltaY: 21 }))).toBe(false);              // trackpad
    expect(looksLikeMouseWheel(wheel(2.5, { wheelDeltaY: -7 }))).toBe(false);             // rounded trackpad delta
    expect(looksLikeMouseWheel(wheel(1.5, { wheelDeltaY: -120 }))).toBe(false);           // sub-notch delta
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

  it('follows a recorded trackpad pinch continuously, 1:1 at the default speed', () => {
    const interpret = createWheelInterpreter();
    let zoom = 1;
    for (const deltaY of recordedPinchOut) zoom *= factor(interpret(wheel(deltaY, { ctrlKey: true, wheelDeltaY: 120 })));
    const total = recordedPinchOut.reduce((sum, d) => sum + d, 0);
    expect(zoom).toBeCloseTo(Math.exp(-total / 100), 10);
    expect(zoom).toBeGreaterThan(1.15); expect(zoom).toBeLessThan(1.2);
    for (const deltaY of recordedPinchIn) expect(factor(interpret(wheel(deltaY, { ctrlKey: true, wheelDeltaY: -120 })))).toBeLessThan(1);
    // A bigger finger movement zooms proportionally more; no fixed steps.
    expect(factor(interpret(wheel(-2, { ctrlKey: true, wheelDeltaY: 120 })))).toBeCloseTo(Math.exp(0.02), 12);
  });

  it('only treats large or line-mode Ctrl+wheel events as notches', () => {
    const interpret = createWheelInterpreter();
    expect(interpret(wheel(100, { ctrlKey: true, wheelDeltaY: -120 }))).toEqual({ kind: 'zoom', factor: 1 / wheelStep() });
    expect(interpret(wheel(-3, { ctrlKey: true, deltaMode: 1 }))).toEqual({ kind: 'zoom', factor: wheelStep() });
    expect(interpret(wheel(-100, { wheelDeltaY: 120, metaKey: true }))).toEqual({ kind: 'zoom', factor: wheelStep() });
  });

  it('follows the zoom speed setting', () => {
    let speed = 5;
    const interpret = createWheelInterpreter(() => speed);
    const at = (s: number) => { speed = s; return factor(interpret(wheel(-5, { ctrlKey: true }))); };
    expect(at(5)).toBeCloseTo(Math.exp(0.05), 12);
    expect(at(1)).toBeLessThan(at(5)); expect(at(10)).toBeGreaterThan(at(5));
    expect(wheelStep(5)).toBeCloseTo(1.1);
    expect(wheelStep(10)).toBeGreaterThan(wheelStep(1));
    expect(pinchFactor(2, 5)).toBeCloseTo(2);
    expect(pinchFactor(2, Number.NaN)).toBeCloseTo(2);
  });

  it('zooms in fixed steps for a mouse wheel', () => {
    const interpret = createWheelInterpreter();
    expect(interpret(wheel(100, { wheelDeltaY: -120 }))).toEqual({ kind: 'wheel', direction: 1 });
  });
});
