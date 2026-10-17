import { writable } from 'svelte/store';

/**
 * The person's own Anthropic API key, kept only in this browser. With a key the
 * Assistant calls Anthropic directly, billed to that key, and never through
 * openPlan3D's server.
 */
const KEY = 'o3d_anthropic_key';

function read(): string {
  try { return typeof localStorage === 'undefined' ? '' : localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export const assistantApiKey = writable(read());
assistantApiKey.subscribe(value => {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
});

/** Anthropic keys start with sk-ant-; anything else is a typo or another provider's key. */
export const plausibleKey = (value: string) => /^sk-ant-[\w-]{20,}$/.test(value.trim());
