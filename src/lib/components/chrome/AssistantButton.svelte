<script lang="ts">
  import { t } from '$lib/i18n';
  import { previewActive } from '$lib/stores/project';
  import { assistantOpen } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';
</script>

<button
  class="op-float op-btn is-big op-assistant-btn {$assistantOpen ? 'is-open' : ''}"
  aria-label={$t('chrome.assistant.title')}
  aria-pressed={$assistantOpen}
  title={$previewActive && !$assistantOpen ? $t('chrome.assistant.pending') : $t('chrome.assistant.open')}
  onclick={() => assistantOpen.update(open => !open)}
  data-assistant-button
>
  <Icon name="sparkles" size={22} />
  <span class="max-[1439px]:hidden">{$t('chrome.assistant.title')}</span>
  {#if $previewActive && !$assistantOpen}<span class="op-dot"></span>{/if}
</button>
