/** List prices per million tokens (October 2026). The one place the eval reads prices from. */
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export function addUsage(total: Usage, part: Usage): Usage {
  total.input += part.input; total.output += part.output; total.cacheRead += part.cacheRead; total.cacheWrite += part.cacheWrite;
  return total;
}

/** A model id as the API reports it may carry a suffix; match on the known prefix. */
export function priceFor(model: string): Price | undefined {
  const key = Object.keys(PRICES).find(id => model === id || model.startsWith(`${id}-`) || model.startsWith(`${id}@`));
  return key ? PRICES[key] : undefined;
}

/** Cost in USD; unknown models cost 0 and are flagged by the caller. Cache writes are priced at the 5-minute rate. */
export function costOf(model: string, usage: Usage): number {
  const price = priceFor(model);
  if (!price) return 0;
  return (usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite) / 1e6;
}

/** The API's usage object as our counts. Streaming sends it in message_start and (cumulative) in message_delta. */
export function readUsage(raw: unknown, into: Usage = emptyUsage()): Usage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  into.input = n(u.input_tokens) ?? into.input;
  into.output = n(u.output_tokens) ?? into.output;
  into.cacheRead = n(u.cache_read_input_tokens) ?? into.cacheRead;
  into.cacheWrite = n(u.cache_creation_input_tokens) ?? into.cacheWrite;
  return into;
}
