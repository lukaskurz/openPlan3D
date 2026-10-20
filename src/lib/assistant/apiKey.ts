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

/**
 * Whether openPlan3D's server can run the Assistant: null until asked, false on
 * static hosting (no server) or a server without a key. Without a server, the
 * panel asks for the person's own key before anything else.
 */
export const assistantServer = writable<boolean | null>(null);

let probing: Promise<void> | null = null;
export function checkAssistantServer(fetchImpl: typeof fetch = fetch): Promise<void> {
  probing ??= fetchImpl('/api/assistant/chat', { headers: { Accept: 'application/json' } })
    .then(async response => { assistantServer.set(response.ok && (await response.json())?.available === true); })
    .catch(() => { assistantServer.set(false); })
    .finally(() => { probing = null; });
  return probing;
}
