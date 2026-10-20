import { createHash } from 'node:crypto';
import { HandoffStorage } from './handoffStorage';

/**
 * Dollar budgets for each signed-in person: what their model calls cost today
 * (UTC) and this calendar month (UTC). A request is refused once a budget is
 * used up; each call is charged after its stream ends, so one call may overrun
 * a little. Spend is kept in integer micro-dollars.
 */

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

/** List prices in dollars per million tokens, which is micro-dollars per token. `input` excludes cached tokens. */
export const MODEL_PRICES: Record<string, Usage> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
};
/** A model we don't know (e.g. a server-side fallback) is charged at the highest price of each kind. */
const UNKNOWN_PRICE: Usage = (['input', 'output', 'cacheRead', 'cacheWrite'] as const).reduce(
  (price, kind) => ({ ...price, [kind]: Math.max(...Object.values(MODEL_PRICES).map(p => p[kind])) }),
  { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
);

export function priceOf(model: string): Usage {
  const known = Object.keys(MODEL_PRICES).find(id => model === id || model.startsWith(`${id}-`));
  return known ? MODEL_PRICES[known] : UNKNOWN_PRICE;
}

/** Cost of one call in micro-dollars, rounded up. */
export function costMicros(model: string, usage: Usage): number {
  const price = priceOf(model);
  return Math.ceil(usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite);
}

// ── State ─────────────────────────────────────────────────────────────

export interface BudgetState { version: 1; day: string; daySpent: number; month: string; monthSpent: number }
/** `version` is the store's compare-and-swap token (the object's metageneration). */
export interface BudgetSnapshot { state: BudgetState; version: string }
export interface BudgetStore {
  read(key: string): Promise<BudgetSnapshot | null>;
  /** Compare-and-swap (create when `previous` is null); false means another instance wrote first. */
  write(key: string, previous: BudgetSnapshot | null, state: BudgetState): Promise<boolean>;
}
export interface BudgetLimits { dailyMicros: number; monthlyMicros: number }
export interface AssistantBudget { store: BudgetStore; limits: BudgetLimits }

export function parseBudgetState(value: unknown): BudgetState {
  const state = value as BudgetState;
  if (!state || state.version !== 1 || typeof state.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) ||
    typeof state.month !== 'string' || !/^\d{4}-\d{2}$/.test(state.month) ||
    ![state.daySpent, state.monthSpent].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid assistant budget');
  return state;
}

/** Never the email itself in an object name. */
export function budgetKey(email: string): string {
  return `_system/assistant-budget-${createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 40)}`;
}

const periods = (now: number) => { const iso = new Date(now).toISOString(); return { day: iso.slice(0, 10), month: iso.slice(0, 7) }; };

/** Spend in the current periods. An instance whose clock lags keeps the newer period instead of resetting it. */
function current(state: BudgetState | undefined, now: number): BudgetState {
  const { day, month } = periods(now);
  if (!state) return { version: 1, day, daySpent: 0, month, monthSpent: 0 };
  return {
    version: 1,
    day: state.day >= day ? state.day : day, daySpent: state.day >= day ? state.daySpent : 0,
    month: state.month >= month ? state.month : month, monthSpent: state.month >= month ? state.monthSpent : 0,
  };
}

export interface BudgetStatus { day: { spent: number; limit: number }; month: { spent: number; limit: number } }

export async function budgetStatus({ store, limits }: AssistantBudget, email: string, now = Date.now()): Promise<BudgetStatus> {
  const snapshot = await store.read(budgetKey(email));
  const state = current(snapshot ? parseBudgetState(snapshot.state) : undefined, now);
  return { day: { spent: state.daySpent, limit: limits.dailyMicros }, month: { spent: state.monthSpent, limit: limits.monthlyMicros } };
}

/** Why a new request is refused, or null. The month wins when both are used up: it is the later reset. */
export function budgetBlock(status: BudgetStatus, now = Date.now()): { message: string; retryAfter: number } | null {
  const date = new Date(now);
  if (status.month.spent >= status.month.limit) {
    const reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return { message: 'You have used this month’s assistant budget. It resets on the 1st.', retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) };
  }
  if (status.day.spent >= status.day.limit) {
    const reset = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return { message: 'You have used today’s assistant budget. It resets at midnight UTC.', retryAfter: Math.max(1, Math.ceil((reset - now) / 1000)) };
  }
  return null;
}

/** Add one call's cost; retries on write conflicts between instances, then gives up with an error. */
export async function chargeBudget(store: BudgetStore, email: string, micros: number, now = Date.now()): Promise<BudgetState> {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new Error('Invalid assistant charge');
  const key = budgetKey(email);
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await store.read(key);
    const state = current(previous ? parseBudgetState(previous.state) : undefined, now);
    const next: BudgetState = { ...state, daySpent: state.daySpent + micros, monthSpent: state.monthSpent + micros };
    if (await store.write(key, previous, next)) return next;
  }
  throw new Error('Assistant budget busy');
}

// ── Stores ────────────────────────────────────────────────────────────

/** One zero-byte object per person in the handoff bucket, state in custom metadata, CAS on metageneration. */
export class BucketBudgetStore implements BudgetStore {
  constructor(private storage: Pick<HandoffStorage, 'create' | 'metadata' | 'patchMetadata'>) {}

  async read(key: string): Promise<BudgetSnapshot | null> {
    const object = await this.storage.metadata(key);
    if (!object) return null;
    return { state: parseBudgetState(JSON.parse(object.metadata.budget ?? 'null')), version: object.metageneration };
  }

  write(key: string, previous: BudgetSnapshot | null, state: BudgetState): Promise<boolean> {
    const metadata = { budget: JSON.stringify(state) };
    return previous ? this.storage.patchMetadata(key, metadata, previous.version) : this.storage.create(key, new Uint8Array(), metadata, 'application/octet-stream');
  }
}

/** Local development and tests: one process, nothing kept across restarts. */
export class MemoryBudgetStore implements BudgetStore {
  readonly entries = new Map<string, { state: BudgetState; version: number }>();

  async read(key: string): Promise<BudgetSnapshot | null> {
    const entry = this.entries.get(key);
    return entry ? { state: { ...entry.state }, version: String(entry.version) } : null;
  }

  async write(key: string, previous: BudgetSnapshot | null, state: BudgetState): Promise<boolean> {
    const entry = this.entries.get(key);
    if (previous ? entry?.version !== Number(previous.version) : entry) return false;
    this.entries.set(key, { state: { ...state }, version: (entry?.version ?? 0) + 1 });
    return true;
  }
}

function dollars(value: string | undefined, fallback: number): number {
  const n = Number(value?.trim() || NaN);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6) : Math.round(fallback * 1e6);
}

export function budgetLimits(env: Record<string, string | undefined>): BudgetLimits {
  return { dailyMicros: dollars(env.ASSISTANT_DAILY_USD, 5), monthlyMicros: dollars(env.ASSISTANT_MONTHLY_USD, 50) };
}

let bucketStore: { bucket: string; store: BudgetStore } | undefined;
const memoryStore = new MemoryBudgetStore();

/** The bucket when one is configured (shared by all App Hosting instances), memory otherwise. */
export function assistantBudget(env: Record<string, string | undefined>): AssistantBudget {
  let store: BudgetStore = memoryStore;
  if (env.HANDOFF_BUCKET) {
    if (bucketStore?.bucket !== env.HANDOFF_BUCKET) bucketStore = { bucket: env.HANDOFF_BUCKET, store: new BucketBudgetStore(new HandoffStorage(env.HANDOFF_BUCKET)) };
    store = bucketStore.store;
  }
  return { store, limits: budgetLimits(env) };
}
