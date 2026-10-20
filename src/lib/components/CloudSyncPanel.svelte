<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import {
    availableProviders, cloudSync, connectGoogle, connectICloud, disconnectCloud,
    dismissCloudConflicts, initCloudSync, prepareGoogleSignIn, syncCloudLibrary,
  } from '$lib/stores/cloudSync';
  import { SIGN_IN_BUTTON_ID } from '$lib/services/cloudSync/cloudKit';
  import type { SyncOutcome } from '$lib/services/cloudSync/engine';

  /** `onsynced` runs after a sync that changed the local library, so the list can be reloaded. */
  let { onsynced, when }: { onsynced: () => void; when: (date: Date) => string } = $props();

  const providers = availableProviders();
  let notice = $state<string | null>(null);
  let lastRun = 0;

  const providerName = (id: 'google' | 'icloud') => $t(id === 'google' ? 'cloud.google' : 'cloud.icloud');
  const changed = (outcome: SyncOutcome | null) => !!outcome && (outcome.downloaded > 0 || outcome.deleted > 0 || outcome.conflicts.length > 0);

  async function sync() {
    lastRun = Date.now();
    if (changed(await syncCloudLibrary())) onsynced();
  }

  /** Coming back to the library (e.g. from the other device) pulls what changed meanwhile. */
  function syncOnReturn() {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > 15_000) void sync();
  }

  /** CloudKit JS draws Apple's button as a plain div; make it reachable and operable from the keyboard. */
  function appleButton(node: HTMLElement) {
    const label = $t('cloud.appleSignIn');
    const enhance = () => {
      const button = node.querySelector<HTMLElement>('.apple-auth-button');
      if (!button || button.hasAttribute('role')) return;
      button.setAttribute('role', 'button');
      button.setAttribute('tabindex', '0');
      button.setAttribute('aria-label', label);
      button.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
      });
    };
    const observer = new MutationObserver(enhance);
    observer.observe(node, { childList: true, subtree: true });
    return { destroy: () => observer.disconnect() };
  }

  // Every new connection syncs once it is ready: a restored one, Connect, Continue, or Apple's sign-in
  // button used later. A failed first sync is not retried in a loop; Sync now and returning still retry.
  let autoSynced = false;
  $effect(() => {
    const status = $cloudSync;
    if (status.state !== 'ready' && status.state !== 'syncing') autoSynced = false;
    else if (status.state === 'ready' && !status.lastSyncedAt && !autoSynced) { autoSynced = true; void sync(); }
  });

  onMount(() => {
    prepareGoogleSignIn();
    void initCloudSync();
    document.addEventListener('visibilitychange', syncOnReturn);
    window.addEventListener('focus', syncOnReturn);
    return () => {
      document.removeEventListener('visibilitychange', syncOnReturn);
      window.removeEventListener('focus', syncOnReturn);
    };
  });

  /** Runs inside the tap so Google's popup is allowed to open; also resumes after the hourly access ran out. */
  async function startGoogle() {
    notice = await connectGoogle();
  }

  async function startICloud() {
    notice = null;
    await connectICloud();
  }
</script>

{#if providers.length}
  <section aria-labelledby="cloud-sync-title" class="mb-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h2 id="cloud-sync-title" class="flex items-center gap-2 font-semibold text-gray-800">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.3 12.6 3.5 3.5 0 0 0 6.5 19z"/></svg>
          {$t('cloud.title')}
        </h2>
        <div role="status" class="mt-1">
          {#if $cloudSync.state === 'off'}
            <p>{$t('cloud.intro')}</p>
          {:else if $cloudSync.state === 'connecting'}
            <p>{$t('cloud.connecting', { provider: providerName($cloudSync.provider) })}</p>
          {:else if $cloudSync.state === 'signed-out'}
            <p>{$cloudSync.provider === 'icloud' ? $t('cloud.appleSignIn') : $t('cloud.paused', { provider: providerName($cloudSync.provider) })}</p>
          {:else if $cloudSync.state === 'failed'}
            <p>{$t('cloud.failed', { provider: providerName($cloudSync.provider) })}</p>
          {:else}
            <p class="break-words">{$cloudSync.label ? $t('cloud.syncedWith', { provider: providerName($cloudSync.provider), account: $cloudSync.label }) : $t('cloud.syncedWithProvider', { provider: providerName($cloudSync.provider) })}</p>
            <p class="text-xs text-gray-400">
              {$cloudSync.state === 'syncing' ? $t('cloud.syncing') : $cloudSync.lastSyncedAt ? $t('cloud.lastSynced', { when: when($cloudSync.lastSyncedAt) }) : $t('cloud.notSyncedYet')}
            </p>
          {/if}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if $cloudSync.state === 'off'}
          {#if providers.includes('google')}
            <button type="button" onclick={startGoogle}
              class="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50">{$t('cloud.connectGoogle')}</button>
          {/if}
          {#if providers.includes('icloud')}
            <button type="button" onclick={startICloud}
              class="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50">{$t('cloud.connectICloud')}</button>
          {/if}
        {:else if $cloudSync.state === 'signed-out' && $cloudSync.provider === 'google'}
          <button type="button" onclick={startGoogle}
            class="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white hover:bg-blue-700">{$t('cloud.continue')}</button>
          <button type="button" onclick={disconnectCloud} class="rounded-lg px-3 py-2 font-semibold text-gray-500 hover:bg-gray-50">{$t('cloud.disconnect')}</button>
        {:else if $cloudSync.state === 'failed'}
          <button type="button" onclick={() => $cloudSync.provider === 'icloud' ? startICloud() : startGoogle()}
            class="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50">{$t('cloud.retry')}</button>
          <button type="button" onclick={disconnectCloud} class="rounded-lg px-3 py-2 font-semibold text-gray-500 hover:bg-gray-50">{$t('cloud.disconnect')}</button>
        {:else if $cloudSync.state === 'signed-out' || $cloudSync.state === 'connecting'}
          <button type="button" onclick={disconnectCloud} class="rounded-lg px-3 py-2 font-semibold text-gray-500 hover:bg-gray-50">{$t('cloud.cancel')}</button>
        {:else}
          <button type="button" onclick={sync} disabled={$cloudSync.state === 'syncing'}
            class="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">{$t('cloud.syncNow')}</button>
          <button type="button" onclick={disconnectCloud} class="rounded-lg px-3 py-2 font-semibold text-gray-500 hover:bg-gray-50">{$t('cloud.disconnect')}</button>
        {/if}
      </div>
    </div>
    {#if providers.includes('icloud')}
      <!-- CloudKit JS shows Apple's sign-in button here only while iCloud is waiting for a sign-in. -->
      <div id={SIGN_IN_BUTTON_ID} use:appleButton class="mt-3 empty:hidden"></div>
    {/if}
    {#if notice}<p class="mt-3 rounded-lg bg-gray-50 p-2">{notice}</p>{/if}
    {#if ($cloudSync.state === 'ready' || $cloudSync.state === 'syncing' || $cloudSync.state === 'failed') && $cloudSync.error}
      <p role="alert" class="mt-3 rounded-lg bg-red-50 p-2 text-red-900">{$cloudSync.error}</p>
    {/if}
    {#if ($cloudSync.state === 'ready' || $cloudSync.state === 'syncing') && $cloudSync.conflicts.length}
      <div role="note" class="mt-3 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900">
        <p class="min-w-0">{$t('cloud.conflicts', { names: $cloudSync.conflicts.join(', ') })}</p>
        <button type="button" onclick={dismissCloudConflicts} class="shrink-0 rounded px-2 font-semibold hover:bg-amber-100">{$t('cloud.dismiss')}</button>
      </div>
    {/if}
  </section>
{/if}
