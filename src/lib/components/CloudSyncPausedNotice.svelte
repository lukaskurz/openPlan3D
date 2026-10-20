<script lang="ts">
  import { t } from '$lib/i18n';
  import { base } from '$app/paths';
  import { cloudSync, connectGoogle } from '$lib/stores/cloudSync';

  /** `onresumed` syncs the open plan once Google access is back. */
  let { onresumed }: { onresumed: () => void } = $props();

  let dismissed = $state(false);
  let error = $state<string | null>(null);

  const paused = $derived($cloudSync.state === 'signed-out');
  $effect(() => { if (!paused) { dismissed = false; error = null; } });

  /** Must stay the first thing the tap does, so Google's popup is allowed to open. */
  async function resume() {
    error = await connectGoogle();
    if (!error) onresumed();
  }
</script>

{#if paused && !dismissed && $cloudSync.state === 'signed-out'}
  <aside role="status" class="fixed left-1/2 top-16 z-[80] flex max-w-[95vw] -translate-x-1/2 items-center gap-3 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 shadow-lg print-hide">
    <span class="min-w-0">{error ?? $t('cloud.pausedShort', { provider: $t($cloudSync.provider === 'google' ? 'cloud.google' : 'cloud.icloud') })}</span>
    {#if $cloudSync.provider === 'google'}
      <button type="button" onclick={resume} class="shrink-0 rounded-full bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-700">{$t('cloud.continue')}</button>
    {:else}
      <a href={`${base}/`} class="shrink-0 font-semibold text-blue-600 underline">{$t('cloud.openLibrary')}</a>
    {/if}
    <button type="button" aria-label={$t('cloud.dismiss')} onclick={() => dismissed = true} class="shrink-0 rounded px-1 text-gray-400 hover:text-gray-600">✕</button>
  </aside>
{/if}
