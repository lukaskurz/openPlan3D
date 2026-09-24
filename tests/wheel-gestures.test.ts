import { describe, expect, it } from 'vitest';
import { createWheelInterpreter, looksLikeMouseWheel, pinchFactor, wheelStep } from '$lib/utils/wheelGestures';

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
    expect(small.kind === 'zoom' && small.factor).toBeCloseTo(pinchFactor(Math.exp(0.02)), 12);
    expect(large.kind === 'zoom' && large.factor).toBeGreaterThan(small.kind === 'zoom' ? small.factor : 0);
    expect(interpret(wheel(4, { ctrlKey: true }))).toMatchObject({ kind: 'zoom' });
    expect((interpret(wheel(4, { ctrlKey: true })) as { factor: number }).factor).toBeLessThan(1);
  });

  it('never mistakes pinch events for wheel notches, whatever their wheelDelta', () => {
    const interpret = createWheelInterpreter();
    for (const wheelDeltaY of [undefined, 0, -3, 9, 10]) {
      const action = interpret(wheel(-3.2, { ctrlKey: true, ...(wheelDeltaY === undefined ? {} : { wheelDeltaY }) })) as { factor: number };
      expect(action.factor).toBeCloseTo(pinchFactor(Math.exp(0.032)), 12);
    }
    expect(interpret(wheel(-4.000244140625, { ctrlKey: true, wheelDeltaY: 120 }))).toEqual({ kind: 'zoom', factor: wheelStep(3) });
    expect(interpret(wheel(100, { ctrlKey: true, wheelDeltaY: -120 }))).toEqual({ kind: 'zoom', factor: 1 / wheelStep(3) });
  });

  it('follows the zoom speed setting', () => {
    let speed = 3;
    const interpret = createWheelInterpreter(() => speed);
    const at = (s: number) => { speed = s; return (interpret(wheel(-5, { ctrlKey: true })) as { factor: number }).factor; };
    expect(at(1)).toBeLessThan(at(3));
    expect(at(1)).toBeCloseTo(Math.exp(0.05 * 0.02), 12);  // slowest: 2% of the fingers
    expect(at(10)).toBeCloseTo(Math.exp(0.05 * 0.5), 12);  // fastest: 50%
    expect(wheelStep(3)).toBeCloseTo(1.1);
    expect(wheelStep(10)).toBeGreaterThan(wheelStep(1));
    expect(pinchFactor(2, 10)).toBeCloseTo(Math.SQRT2);
    expect(pinchFactor(2, Number.NaN)).toBeCloseTo(pinchFactor(2, 3));
  });

  it('zooms in fixed steps for a mouse wheel, with or without Ctrl/Cmd', () => {
    const interpret = createWheelInterpreter();
    expect(interpret(wheel(100, { wheelDeltaY: -120 }))).toEqual({ kind: 'wheel', direction: 1 });
    expect(interpret(wheel(-100, { wheelDeltaY: 120, metaKey: true }))).toEqual({ kind: 'zoom', factor: wheelStep(3) });
  });
});
