import { describe, it, expect } from 'vitest';
import { cssPixelsPerInch, scaleDenominator, zoomForScale, roundScale, formatScale, NOMINAL_CSS_PPI } from '$lib/utils/screenScale';

describe('screen scale', () => {
  it('knows the iPad Air 11" in both orientations', () => {
    expect(cssPixelsPerInch(820, 1180, 2)).toEqual({ ppi: 132, exact: true });
    expect(cssPixelsPerInch(1180, 820, 2)).toEqual({ ppi: 132, exact: true });
  });

  it('knows the iPad mini and the 13" iPads', () => {
    expect(cssPixelsPerInch(744, 1133, 2)).toEqual({ ppi: 163, exact: true });
    expect(cssPixelsPerInch(1366, 1024, 2)).toEqual({ ppi: 132, exact: true });
  });

  it('needs the pixel ratio to match as well as the size', () => {
    expect(cssPixelsPerInch(820, 1180, 1)).toEqual({ ppi: NOMINAL_CSS_PPI, exact: false });
  });

  it('falls back to 96 px per inch for unknown screens', () => {
    expect(cssPixelsPerInch(1920, 1080, 1)).toEqual({ ppi: 96, exact: false });
  });

  it('turns zoom into 1:N and back', () => {
    // 132 css px per inch; 1:50 means 1 cm on screen shows 50 cm, i.e. 132 / (2.54 × 50) px per cm.
    const zoom = zoomForScale(50, 132);
    expect(zoom).toBeCloseTo(1.0394, 4);
    expect(scaleDenominator(zoom, 132)).toBeCloseTo(50, 10);
    expect(scaleDenominator(1, 96)).toBeCloseTo(37.795, 3);
    for (const n of [20, 50, 100, 200]) expect(scaleDenominator(zoomForScale(n, 163), 163)).toBeCloseTo(n, 10);
  });

  it('rounds the readout to whole numbers, and to two digits from 1000', () => {
    expect(roundScale(47.4)).toBe(47);
    expect(roundScale(72.6)).toBe(73);
    expect(roundScale(999.4)).toBe(999);
    expect(roundScale(1234)).toBe(1200);
    expect(roundScale(1250)).toBe(1300);
    expect(roundScale(15678)).toBe(16000);
    expect(roundScale(0.4)).toBe(1);
    expect(roundScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('marks a guessed density with ≈', () => {
    expect(formatScale(50.2, true)).toBe('1:50');
    expect(formatScale(50.2, false)).toBe('≈1:50');
  });
});
