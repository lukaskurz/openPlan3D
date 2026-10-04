<script lang="ts">
  import { t } from '$lib/i18n';
  import { currentProject } from '$lib/stores/project';
  import { saveState, saveError } from '$lib/stores/saveStatus';
  import { drawerOpen } from '$lib/stores/chrome';
  import AlternativesMenu from '$lib/components/toolbar/AlternativesMenu.svelte';
  import Icon from './Icon.svelte';

  let alternativeName = $derived(($currentProject?.alternatives ?? []).find(alt => alt.id === $currentProject?.activeAlternativeId)?.name);
  let status = $derived<'failed' | 'saved' | 'saving' | 'unsaved'>($saveError ? 'failed' : $saveState);
</script>

<div class="flex items-center gap-2 min-w-0">
  <button class="op-float op-btn is-square is-big shrink-0" style="width:52px" aria-label={$t('chrome.menu')} aria-expanded={$drawerOpen} onclick={() => drawerOpen.set(true)}>
    <Icon name="menu" />
  </button>
  <button class="op-float h-[52px] min-w-0 flex flex-col justify-center items-start px-4 text-left max-sm:hidden" onclick={() => drawerOpen.set(true)} aria-label={$t('chrome.openProjectMenu', { name: $currentProject?.name ?? '' })}>
    <span class="text-sm font-semibold truncate max-w-[16rem]" style="color:var(--color-text-strong)">{$currentProject?.name}</span>
    <span class="flex items-center gap-1.5 text-xs whitespace-nowrap" style="color:var(--color-text-muted)" data-save-status={status}>
      {#if alternativeName}
        <span class="truncate max-w-[9rem]">{alternativeName}</span>
        <span class="w-[3px] h-[3px] rounded-full" style="background:var(--color-text-subtle)"></span>
      {/if}
      <span class="w-1.5 h-1.5 rounded-full {status === 'saving' ? 'animate-pulse' : ''}" style="background:{status === 'saved' ? 'var(--color-success)' : status === 'failed' ? 'var(--color-danger)' : 'var(--color-warning)'}"></span>
      <span style={status === 'failed' ? 'color:var(--color-danger-text);font-weight:600' : ''}>{$t(`chrome.save.${status}`)}</span>
    </span>
  </button>
  <AlternativesMenu />
</div>
