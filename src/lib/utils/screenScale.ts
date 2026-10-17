/**
 * On-screen drawing scale (1 : N) for the plan.
 *
 * World units are cm and the plan's zoom (`canvasZoom`) is CSS pixels per cm: FloorPlanCanvas maps
 * a world point to `(world − camera) × zoom + size / 2`, where size is the canvas's CSS size and the
 * device pixel ratio is applied separately as a context transform. So one cm of the plan covers
 * `zoom` CSS pixels, and with `ppi` CSS pixels per physical inch:
 *
 *   N = ppi / (2.54 × zoom)          zoom = ppi / (2.54 × N)
 *
 * Browsers don't report the physical pixel density, so known screens come from a small table keyed
 * by the screen's CSS size and device pixel ratio. Anything else falls back to CSS's nominal 96 px
 * per inch, and the readout says the scale is approximate.
 */

const CM_PER_INCH = 2.54;

/** CSS pixels per inch that CSS itself assumes; right for few real screens. */
export const NOMINAL_CSS_PPI = 96;

interface KnownScreen {
  /** Short side and long side in CSS pixels, as `screen.width` / `screen.height` report them. */
  short: number;
  long: number;
  dpr: number;
  /** Physical pixels per inch divided by the device pixel ratio. */
  ppi: number;
}

/**
 * Screens whose CSS size and pixel ratio name one panel density. Sizes that two devices share with
 * different densities (768 × 1024 at 2×: iPad mini 5 and 9.7" iPad) are left out on purpose.
 */
const KNOWN_SCREENS: readonly KnownScreen[] = [
  // iPads at 264 ppi, 2×
  { short: 820, long: 1180, dpr: 2, ppi: 132 },   // iPad Air 11" (4th–6th gen), iPad 10.9" (10th gen, A16)
  { short: 834, long: 1194, dpr: 2, ppi: 132 },   // iPad Pro 11" (1st–4th gen)
  { short: 834, long: 1210, dpr: 2, ppi: 132 },   // iPad Pro 11" (M4)
  { short: 834, long: 1112, dpr: 2, ppi: 132 },   // iPad Pro 10.5", iPad Air 3
  { short: 810, long: 1080, dpr: 2, ppi: 132 },   // iPad 10.2" (7th–9th gen)
  { short: 1024, long: 1366, dpr: 2, ppi: 132 },  // iPad Pro 12.9", iPad Air 13"
  { short: 1032, long: 1376, dpr: 2, ppi: 132 },  // iPad Pro 13" (M4)
  // iPad mini at 326 ppi, 2×
  { short: 744, long: 1133, dpr: 2, ppi: 163 },   // iPad mini (6th, 7th gen)
  // iPhones
  { short: 375, long: 667, dpr: 2, ppi: 163 },    // iPhone SE (2nd, 3rd gen), 326 ppi
  { short: 390, long: 844, dpr: 3, ppi: 460 / 3 },  // iPhone 12–14
  { short: 393, long: 852, dpr: 3, ppi: 460 / 3 },  // iPhone 15, 16, 15 Pro
  { short: 402, long: 874, dpr: 3, ppi: 460 / 3 },  // iPhone 16 Pro
  { short: 430, long: 932, dpr: 3, ppi: 460 / 3 },  // iPhone 14 Pro Max, 15 Plus / Pro Max
  { short: 440, long: 956, dpr: 3, ppi: 460 / 3 },  // iPhone 16 Pro Max
];

/**
 * CSS pixels per physical inch for a screen of this CSS size (either orientation) and pixel ratio.
 * `exact` is false when the screen isn't in the table and the 96 px fallback is used.
 */
export function cssPixelsPerInch(screenWidth: number, screenHeight: number, dpr: number): { ppi: number; exact: boolean } {
  const short = Math.round(Math.min(screenWidth, screenHeight));
  const long = Math.round(Math.max(screenWidth, screenHeight));
  const known = KNOWN_SCREENS.find(s => s.short === short && s.long === long && Math.abs(s.dpr - dpr) < 0.01);
  return known ? { ppi: known.ppi, exact: true } : { ppi: NOMINAL_CSS_PPI, exact: false };
}

/** N in 1 : N for a plan zoom given in CSS pixels per cm. */
export function scaleDenominator(zoomPxPerCm: number, ppi: number): number {
  return ppi / (CM_PER_INCH * zoomPxPerCm);
}

/** The plan zoom (CSS pixels per cm) that shows the plan at 1 : N. */
export function zoomForScale(denominator: number, ppi: number): number {
  return ppi / (CM_PER_INCH * denominator);
}

/**
 * N rounded for the readout: the nearest whole number, never below 1; from 1000 up, two
 * significant digits (1:1234 reads 1:1200), so the label doesn't flicker while pinching out.
 */
export function roundScale(denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 1) return 1;
  if (denominator >= 1000) {
    const step = 10 ** (Math.floor(Math.log10(denominator)) - 1);
    return Math.round(denominator / step) * step;
  }
  return Math.round(denominator);
}

/** The readout text, e.g. `1:50`, or `≈1:50` when the screen's density is a guess. */
export function formatScale(denominator: number, exact: boolean): string {
  return `${exact ? '' : '≈'}1:${roundScale(denominator)}`;
}
