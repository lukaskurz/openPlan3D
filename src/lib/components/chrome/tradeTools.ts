import type { TranslationKey } from '$lib/i18n';
import type { Trade, Surface } from '$lib/stores/workContext';
import type { ToolGroup } from './tools';
import type { IconName } from './Icon.svelte';

/**
 * Which tools the top bars offer. The fixed bar is the same for every trade; the
 * trade bar shows the tools of the current trade on the current surface (spec §3.2, §3.3).
 * Data only (no store imports), so tools.ts can use it without an import cycle.
 */
export interface BarTool {
  id: ToolGroup;
  icon: IconName;
  label: TranslationKey;
  /** Longer text for the tooltip. */
  title?: TranslationKey;
}

/** Pan, Select, Measure, Section (spec §3.2). */
export const FIXED_TOOLS: readonly BarTool[] = [
  { id: 'view', icon: 'pan', label: 'chrome.tool.view', title: 'chrome.tool.viewHint' },
  { id: 'select', icon: 'select', label: 'chrome.tool.select' },
  { id: 'annotate', icon: 'ruler', label: 'chrome.tool.annotate' },
  { id: 'section', icon: 'section', label: 'chrome.tool.section', title: 'chrome.tool.sectionHint' },
];

/** The tools each trade offers on each surface (spec §3.3). */
export const TRADE_TOOLS: Readonly<Record<Trade, Readonly<Record<Surface, readonly BarTool[]>>>> = {
  furnishing: {
    floor: [
      { id: 'wall', icon: 'wall', label: 'chrome.tool.wall' },
      { id: 'openings', icon: 'door', label: 'chrome.tool.openings' },
      { id: 'structure', icon: 'stairs', label: 'chrome.tool.structure' },
      { id: 'furniture', icon: 'sofa', label: 'chrome.tool.furniture' },
    ],
    ceiling: [
      { id: 'ceilingHeight', icon: 'ceilingHeight', label: 'chrome.tool.ceilingHeight', title: 'chrome.hint.ceilingHeight' },
      { id: 'light', icon: 'bulb', label: 'chrome.tool.light' },
      { id: 'fan', icon: 'fan', label: 'chrome.tool.fan' },
      { id: 'smoke', icon: 'smoke', label: 'chrome.tool.smoke' },
    ],
  },
  electrical: {
    floor: [
      { id: 'outlet', icon: 'outlet', label: 'chrome.tool.outlet' },
      { id: 'switch', icon: 'switch', label: 'chrome.tool.switch' },
      { id: 'wallLight', icon: 'sconce', label: 'chrome.tool.light', title: 'chrome.tool.wallLightHint' },
      { id: 'link', icon: 'link', label: 'chrome.tool.link', title: 'chrome.hint.linkPickSwitch' },
    ],
    ceiling: [
      { id: 'light', icon: 'bulb', label: 'chrome.tool.light' },
      { id: 'fan', icon: 'fan', label: 'chrome.tool.fan' },
      { id: 'link', icon: 'link', label: 'chrome.tool.link', title: 'chrome.hint.linkPickSwitch' },
    ],
  },
  plumbing: {
    floor: [
      { id: 'pipe', icon: 'pipeRun', label: 'chrome.tool.pipe', title: 'chrome.tool.pipeHint' },
      { id: 'fixture', icon: 'fixture', label: 'chrome.tool.fixture', title: 'chrome.tool.fixtureHint' },
      { id: 'drain', icon: 'drain', label: 'chrome.tool.drain' },
    ],
    ceiling: [
      { id: 'pipe', icon: 'pipeRun', label: 'chrome.tool.pipeCeiling', title: 'chrome.tool.pipeHint' },
    ],
  },
};

export interface TradeInfo { icon: IconName; label: TranslationKey; description: TranslationKey }

export const TRADE_INFO: Readonly<Record<Trade, TradeInfo>> = {
  furnishing: { icon: 'sofa', label: 'chrome.trade.furnishing', description: 'chrome.trade.furnishingHint' },
  electrical: { icon: 'bolt', label: 'chrome.trade.electrical', description: 'chrome.trade.electricalHint' },
  plumbing: { icon: 'pipe', label: 'chrome.trade.plumbing', description: 'chrome.trade.plumbingHint' },
};

const TRADE_ORDER: readonly Trade[] = ['furnishing', 'electrical', 'plumbing'];
const SURFACE_ORDER: readonly Surface[] = ['floor', 'ceiling'];

/**
 * Catalog items the ceiling tools place. The first of each is what the tool arms;
 * the others are its variants in the tool's options (spec §3.8: "light hang height…").
 */
export const CEILING_TOOL_ITEMS = {
  light: ['ceiling_light', 'recessed_light', 'pendant_light', 'chandelier'],
  fan: ['ceiling_fan', 'sym_ceiling_fan'],
  smoke: ['smoke_detector', 'sym_smoke'],
} as const satisfies Partial<Record<ToolGroup, readonly string[]>>;

/** Catalog items the Plumbing tools arm directly (Floor drain); Fixture opens the catalog instead. */
export const PLUMBING_TOOL_ITEMS = {
  drain: ['sym_drain'],
} as const satisfies Partial<Record<ToolGroup, readonly string[]>>;

/**
 * Catalog items the Electrical floor tools place on walls; the first of each is what the
 * tool arms, the others are its variants (single / double outlet, indoor / outdoor sconce).
 * The Electrical ceiling tools (Light, Fan) are the ceiling tools above.
 */
export const ELECTRICAL_TOOL_ITEMS = {
  outlet: ['sym_outlet', 'sym_outlet_double'],
  switch: ['sym_switch'],
  wallLight: ['wall_sconce', 'wall_sconce_outdoor'],
} as const satisfies Partial<Record<ToolGroup, readonly string[]>>;

export type PlacingGroup = 'furniture' | keyof typeof CEILING_TOOL_ITEMS | keyof typeof PLUMBING_TOOL_ITEMS | keyof typeof ELECTRICAL_TOOL_ITEMS;

/** The tool group an armed catalog item belongs to: a ceiling tool for its items, else Furniture. */
export function groupForItem(catalogId: string | null): PlacingGroup {
  for (const [group, ids] of Object.entries(CEILING_TOOL_ITEMS) as [keyof typeof CEILING_TOOL_ITEMS, readonly string[]][]) {
    if (catalogId && ids.includes(catalogId)) return group;
  }
  if (catalogId && (PLUMBING_TOOL_ITEMS.drain as readonly string[]).includes(catalogId)) return 'drain';
  for (const [group, ids] of Object.entries(ELECTRICAL_TOOL_ITEMS) as [keyof typeof ELECTRICAL_TOOL_ITEMS, readonly string[]][]) {
    if (catalogId && ids.includes(catalogId)) return group;
  }
  return 'furniture';
}

export function tradeTools(trade: Trade, surface: Surface): readonly BarTool[] {
  return TRADE_TOOLS[trade][surface];
}

export function isFixedTool(group: ToolGroup): boolean {
  return FIXED_TOOLS.some(tool => tool.id === group);
}

/**
 * Where a tool lives when it is not a fixed one: the first trade and surface
 * whose bar offers it. Null for the fixed tools and for tools no bar offers.
 */
export function homeOfTool(group: ToolGroup): { trade: Trade; surface: Surface } | null {
  if (isFixedTool(group)) return null;
  for (const trade of TRADE_ORDER) {
    for (const surface of SURFACE_ORDER) {
      if (TRADE_TOOLS[trade][surface].some(tool => tool.id === group)) return { trade, surface };
    }
  }
  return null;
}

/**
 * The trade and surface to show for a tool chosen some other way (keyboard,
 * command palette, catalog): the current ones when they offer it, else its home.
 * Null means nothing needs to change.
 */
export function contextForTool(group: ToolGroup, trade: Trade, surface: Surface): { trade: Trade; surface: Surface } | null {
  if (isFixedTool(group) || tradeTools(trade, surface).some(tool => tool.id === group)) return null;
  const home = homeOfTool(group);
  return home && (home.trade !== trade || home.surface !== surface) ? home : null;
}
