<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { projectServiceMessage } from '$lib/i18n/projectServiceMessages';
  import { saveError, saveConflict, savingCopy, saveCurrentAsCopy, manualSave } from '$lib/stores/saveStatus';
  import { exportAs } from './actions';
  import Icon from './Icon.svelte';
</script>

{#if $saveError}
  <div role="alert" class="op-float op-enter flex items-center gap-3 py-2 pl-4 pr-2 max-w-[min(44rem,calc(100vw-2rem))]" style="background:var(--color-danger-subtle);border-color:var(--color-danger-border)" data-save-banner>
    <Icon name="alert" class="shrink-0" />
    <div class="flex-1 min-w-0 text-sm" style="color:var(--color-danger-text)">
      <div class="font-semibold">{$t('chrome.save.failedTitle')}</div>
      <div class="text-xs opacity-90 truncate">{projectServiceMessage($saveError, $locale)}</div>
    </div>
    {#if $saveConflict}
      <button class="op-btn" disabled={$savingCopy} onclick={saveCurrentAsCopy}>{$savingCopy ? $t('saveControls.savingCopy') : $t('saveControls.copy')}</button>
    {:else}
      <button class="op-btn" style="color:var(--color-danger-text)" onclick={() => manualSave()}>{$t('chrome.save.retry')}</button>
    {/if}
    <button class="op-btn is-primary" onclick={() => exportAs('json')}>{$t('chrome.save.download')}</button>
  </div>
{/if}
