import { writable, get } from 'svelte/store';
import { currentProject } from './project';

/**
 * What the person is working on: a trade (which tools and items are editable)
 * and a surface of the current storey (floor or ceiling). UI state only, never
 * saved in the project; kept per project in sessionStorage so a reload returns
 * to the same place.
 */
export type Trade = 'furnishing' | 'electrical' | 'plumbing';
export type Surface = 'floor' | 'ceiling';

export const TRADES: readonly Trade[] = ['furnishing', 'electrical', 'plumbing'];

export const activeTrade = writable<Trade>('furnishing');
export const activeSurface = writable<Surface>('floor');

const KEY = 'o3d_work_context:';

function read(projectId: string): { trade: Trade; surface: Surface } {
  try {
    const raw = sessionStorage.getItem(KEY + projectId);
    if (raw) {
      const parsed = JSON.parse(raw);
      const trade = TRADES.includes(parsed?.trade) ? parsed.trade : 'furnishing';
      const surface = parsed?.surface === 'ceiling' ? 'ceiling' : 'floor';
      return { trade, surface };
    }
  } catch { /* storage unavailable or malformed */ }
  return { trade: 'furnishing', surface: 'floor' };
}

function write(projectId: string) {
  try {
    sessionStorage.setItem(KEY + projectId, JSON.stringify({ trade: get(activeTrade), surface: get(activeSurface) }));
  } catch { /* storage unavailable */ }
}

if (typeof window !== 'undefined') {
  let projectId: string | null = null;
  currentProject.subscribe(project => {
    const id = project?.id ?? null;
    if (id === projectId) return;
    projectId = id;
    const saved = id ? read(id) : { trade: 'furnishing' as Trade, surface: 'floor' as Surface };
    activeTrade.set(saved.trade);
    activeSurface.set(saved.surface);
  });
  activeTrade.subscribe(() => { if (projectId) write(projectId); });
  activeSurface.subscribe(() => { if (projectId) write(projectId); });
}
