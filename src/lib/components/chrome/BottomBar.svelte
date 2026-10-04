<script lang="ts">
  import { tick } from 'svelte';
  import { t, locale } from '$lib/i18n';
  import { undoMessage } from '$lib/i18n/undoMessages';
  import { undo, redo, undoHistoryStore, jumpToUndoStep, canvasZoom, viewMode, elevationWallId } from '$lib/stores/project';
  import { planViewApi } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';

  let historyOpen = $derived($popover === 'history');
  let showZoom = $derived($viewMode === '2d' && !$elevationWallId);
  let zoomText = $derived(`${$canvasZoom < 0.01 ? ($canvasZoom * 100).toPrecision(2) : Math.round($canvasZoom * 100)}%`);

  let entries = $derived($undoHistoryStore.entries);
  let timeline: HTMLDivElement | undefined = $state();

  // Keep the newest step in view when the timeline opens or grows.
  $effect(() => {
    if (!historyOpen) return;
    void entries.length;
    void tick().then(() => timeline?.scrollTo({ left: timeline.scrollWidth }));
  });

  function time(ts: number) {
    return new Date(ts).toLocaleTimeString($locale === 'pt' ? 'pt-BR' : 'en', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="op-float op-cluster {historyOpen ? 'flex-1 min-w-0' : ''}" data-bottom-bar>
  <button class="op-btn is-square" aria-label={$t('projectToolbar.undo')} title={$t('projectToolbar.undo')} onclick={undo} disabled={!entries.length}><Icon name="undo" /></button>
  <button class="op-btn is-square" aria-label={$t('projectToolbar.redo')} title={$t('projectToolbar.redo')} onclick={redo}><Icon name="redo" /></button>
  <button class="op-btn" aria-expanded={historyOpen} onclick={() => togglePopover('history')} data-history>
    <Icon name="history" /><span class="max-md:hidden">{$t('chrome.history')}</span>
  </button>
  {#if historyOpen}
    <div class="op-divider-v"></div>
    <div class="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto op-scroll" bind:this={timeline} aria-label={$t('undoHistory.title')}>
      {#if !entries.length}
        <span class="px-3 text-sm" style="color:var(--color-text-muted)">{$t('chrome.historyEmpty')}</span>
      {/if}
      {#each entries as entry, i}
        <button class="op-btn shrink-0 font-medium max-w-[12rem]" style="background:var(--color-surface-muted)" title={`${undoMessage(entry.description, $locale)} · ${time(entry.timestamp)}`}
          onclick={() => jumpToUndoStep(i)}>
          <span class="truncate">{undoMessage(entry.description, $locale)}</span>
        </button>
      {/each}
      <span class="op-btn shrink-0 is-active pointer-events-none" aria-current="step">{$t('chrome.historyNow')}</span>
    </div>
    <span class="text-xs px-2 whitespace-nowrap max-lg:hidden" style="color:var(--color-text-muted)">{$t('chrome.historyHint')}</span>
    <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={closePopover}><Icon name="close" /></button>
  {:else if showZoom}
    <div class="op-divider-v op-zoom"></div>
    <button class="op-btn is-square op-zoom" aria-label={$t('canvasZoom.out')} title={$t('canvasZoom.out')} onclick={() => $planViewApi?.zoomBy(0.8)}><Icon name="minus" /></button>
    <button class="op-btn min-w-14 tabular-nums op-zoom" aria-label={$t('canvasZoom.reset')} title={$t('chrome.zoomFitHint')} onclick={() => $planViewApi?.zoomToFit()}>{zoomText}</button>
    <button class="op-btn is-square op-zoom" aria-label={$t('canvasZoom.in')} title={$t('canvasZoom.in')} onclick={() => $planViewApi?.zoomBy(1.25)}><Icon name="plus" /></button>
  {/if}
</div>
