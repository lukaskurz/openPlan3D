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
  <!-- The project and its alternatives are one card; below xl only the alternatives button stays. -->
  <div class="op-float op-cluster relative min-w-0 shrink-0 h-[52px]" data-project-card>
    <div class="flex items-center h-full min-w-0 max-xl:hidden">
      <button class="op-btn h-full min-w-0 !px-3 flex-col !items-start !gap-0 text-left" onclick={() => drawerOpen.set(true)} aria-label={$t('chrome.openProjectMenu', { name: $currentProject?.name ?? '' })}>
        <span class="text-sm font-semibold truncate max-w-[14rem]" style="color:var(--color-text-strong)">{$currentProject?.name}</span>
        <span class="flex items-center gap-1.5 text-xs font-normal whitespace-nowrap" style="color:var(--color-text-muted)" data-save-status={status}>
          {#if alternativeName}
            <span class="truncate max-w-[9rem]">{alternativeName}</span>
            <span class="w-[3px] h-[3px] rounded-full" style="background:var(--color-text-subtle)"></span>
          {/if}
          <span class="w-1.5 h-1.5 rounded-full {status === 'saving' ? 'animate-pulse' : ''}" style="background:{status === 'saved' ? 'var(--color-success)' : status === 'failed' ? 'var(--color-danger)' : 'var(--color-warning)'}"></span>
          <span style={status === 'failed' ? 'color:var(--color-danger-text);font-weight:600' : ''}>{$t(`chrome.save.${status}`)}</span>
        </span>
      </button>
      <div class="op-divider-v !mx-0.5"></div>
    </div>
    <AlternativesMenu bare />
    {#if status === 'failed'}
      <span class="xl:hidden absolute top-1.5 right-1.5 w-2 h-2 rounded-full pointer-events-none" style="background:var(--color-danger)" title={$t('chrome.save.failed')}></span>
    {/if}
  </div>
</div>
