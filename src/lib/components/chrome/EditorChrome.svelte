<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import { modalDialog, hasOpenModal } from '$lib/utils/modalDialog';
  import { currentProject, activeFloor, viewMode, sideViewOpen, layerVisibility } from '$lib/stores/project';
  import { saveState, autoSave, initAutoSave } from '$lib/stores/saveStatus';
  import { initVersionHistory, stopVersionHistory } from '$lib/stores/versionHistory';
  import { hasPlanContent } from '$lib/utils/planContentBounds';
  import { planInsetBottom } from '$lib/stores/planView';
  import { getFloorBelow } from '$lib/utils/floors';
  import { popover, closePopover, dialog, catalogOpen, elementsListOpen, drawerOpen, floorView, assistantOpen } from '$lib/stores/chrome';
  import SettingsDialog from '$lib/components/toolbar/SettingsDialog.svelte';
  import VersionHistoryPanel from '$lib/components/toolbar/VersionHistoryPanel.svelte';
  import AreaSummaryPanel from '$lib/components/sidebar/AreaSummaryPanel.svelte';
  import LayersPanel from '$lib/components/sidebar/LayersPanel.svelte';
  import PrintLayout from '$lib/components/editor/PrintLayout.svelte';
  import AssistantShareDialog from '$lib/components/AssistantShareDialog.svelte';
  import ImportError from '$lib/components/ImportError.svelte';
  import ExportNotice from '$lib/components/ExportNotice.svelte';
  import ProjectCluster from './ProjectCluster.svelte';
  import FixedToolBar from './FixedToolBar.svelte';
  import TradeToolBar from './TradeToolBar.svelte';
  import ViewCluster from './ViewCluster.svelte';
  import FloorRail from './FloorRail.svelte';
  import BottomBar from './BottomBar.svelte';
  import ActionSlot from './ActionSlot.svelte';
  import ScaleControl from './ScaleControl.svelte';
  import SettingsPopover from './SettingsPopover.svelte';
  import Inspector from './Inspector.svelte';
  import MenuDrawer from './MenuDrawer.svelte';
  import ExportDialog from './ExportDialog.svelte';
  import CatalogSheet from './CatalogSheet.svelte';
  import StartCard from './StartCard.svelte';
  import SaveBanner from './SaveBanner.svelte';
  import AssistantButton from './AssistantButton.svelte';
  import AssistantPanel from './AssistantPanel.svelte';
  import SketchLayer from './SketchLayer.svelte';
  import CheckBar from './CheckBar.svelte';
  import { discardProposal } from '$lib/assistant/session';
  import { toolGroup, chooseGroup, startingGroup } from './tools';
  import Icon from './Icon.svelte';

  let errorMessage = $state<string | null>(null);
  const onerror = (message: string) => { errorMessage = message; };

  let plan = $derived($viewMode === '2d' && !$sideViewOpen);
  let floorBelow = $derived(getFloorBelow($currentProject));
  let emptyPlan = $derived(plan && !!$floorView && !hasPlanContent($floorView)
    && !($layerVisibility.floorBelow && floorBelow && hasPlanContent(floorBelow))
    && ($toolGroup === 'select' || $toolGroup === 'view') && !$catalogOpen && !$popover && !$assistantOpen);
  let historyOpen = $derived($popover === 'history');

  // Panels outside the chrome (Assistant, elements list) stop above the bottom bar, which is taller in portrait.
  let bottomHeight = $state(0);
  $effect(() => {
    const root = document.documentElement;
    if (bottomHeight > 0) root.style.setProperty('--op-bottom-bar-h', `${bottomHeight}px`);
    return () => root.style.removeProperty('--op-bottom-bar-h');
  });

  // The corner groups pin to the top corners; the two tool bars are centred on the window as a pair,
  // with the Assistant button hanging off the pair's right side. When the pair would run into a corner
  // group, the bars get their own row under the corners. Measured, so it holds for any width and language.
  let topRow: HTMLDivElement | undefined = $state();
  let toolPair: HTMLDivElement | undefined = $state();
  let stacked = $state(false);
  $effect(() => {
    if (!topRow || !toolPair) { stacked = false; return; }
    const row = topRow, pair = toolPair;
    const fit = () => {
      const [left, right] = [...row.children] as HTMLElement[];
      const natural = (el: HTMLElement) => Math.max(0, ...[...el.children].map(child => (child as HTMLElement).scrollWidth));
      const assistant = pair.querySelector<HTMLElement>('.op-assistant-slot');
      const bars = pair.offsetWidth;
      const extra = assistant && getComputedStyle(assistant).position === 'absolute' ? assistant.offsetWidth + 8 : 0;
      const room = row.clientWidth / 2 - bars / 2 - 12;
      stacked = natural(left) > room || natural(right) + extra > room;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    observer.observe(pair);
    for (const child of row.children) for (const inner of child.children) observer.observe(inner);
    for (const child of pair.children) observer.observe(child);
    fit();
    return () => observer.disconnect();
  });

  // Dialogs bind `open`; mirror them onto the single dialog store.
  let settingsOpen = $state(false);
  let versionsOpen = $state(false);
  let printOpen = $state(false);
  $effect(() => {
    settingsOpen = $dialog === 'settings';
    versionsOpen = $dialog === 'versions';
    printOpen = $dialog === 'print';
  });
  $effect(() => { if (!settingsOpen && $dialog === 'settings') dialog.set(null); });
  $effect(() => { if (!versionsOpen && $dialog === 'versions') dialog.set(null); });
  $effect(() => { if (!printOpen && $dialog === 'print') dialog.set(null); });

  let assistantProject = $derived($dialog === 'assistant' && $currentProject ? structuredClone($currentProject) : null);

  onMount(() => {
    const stopAutoSave = initAutoSave();
    if (get(toolGroup) === 'select') chooseGroup(startingGroup());
    initVersionHistory();
    const openSettings = () => { if (!hasOpenModal()) dialog.set('settings'); };
    window.addEventListener('open-settings', openSettings);
    return () => {
      window.removeEventListener('open-settings', openSettings);
      discardProposal();
      assistantOpen.set(false);
      if (get(saveState) === 'unsaved') void autoSave();
      stopAutoSave();
      stopVersionHistory();
      closePopover();
      catalogOpen.set(false);
      drawerOpen.set(false);
      elementsListOpen.set(false);
      dialog.set(null);
    };
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || hasOpenModal()) return;
    if ($popover) { closePopover(); e.stopPropagation(); }
    else if ($elementsListOpen) { elementsListOpen.set(false); e.stopPropagation(); }
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<div class="op-chrome {$assistantOpen && plan ? 'has-assistant' : ''} {stacked ? 'is-stacked' : ''}" data-editor-chrome>
  {#if emptyPlan}<StartCard />{/if}

  <div class="op-top" bind:this={topRow}>
    <div class="op-left"><ProjectCluster /></div>
    <div class="op-right"><ViewCluster /></div>
  </div>
  <!-- Centred on the window, not between the corners; drops to a second row when it would touch them. -->
  <div class="op-center" class:is-below={stacked || !plan}>
    {#if plan}
      <div class="op-tool-pair" bind:this={toolPair} data-tool-pair>
        <FixedToolBar />
        <TradeToolBar />
        <div class="op-assistant-slot"><AssistantButton /></div>
      </div>
    {/if}
    <SaveBanner />
    {#if plan && !$assistantOpen}<CheckBar />{/if}
  </div>

  <!-- In 2D the rail always shows (it holds the storey's ceiling / floor); in 3D only when there are storeys to switch. -->
  {#if $viewMode === '2d' || ($currentProject?.floors.length ?? 0) > 1}
    <!-- Above the bottom sheet when one is open, instead of on top of its header. -->
    <div class="op-left-rail" class:above-sheet={$planInsetBottom > 0} style:--sheet-inset="{$planInsetBottom}px"><FloorRail /></div>
  {/if}

  <!-- Bottom: time on the left, what's happening now in the centre (action slot), precision on the right.
       It rises above the inspector's bottom sheet when that is open. -->
  <div class="op-bottom {historyOpen ? 'is-history' : ''}" class:above-sheet={$planInsetBottom > 0} style:--sheet-inset="{$planInsetBottom}px" bind:offsetHeight={bottomHeight}>
    <div class="op-bottom-left"><BottomBar /></div>
    {#if !historyOpen}
      <div class="op-bottom-center"><ActionSlot /></div>
      <div class="op-bottom-right">
        {#if plan}
          <div class="op-float op-cluster" role="group" aria-label={$t('chrome.precision')} data-precision>
            <ScaleControl />
            <div class="op-divider-v !mx-0.5"></div>
            <SettingsPopover />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<Inspector />
<AssistantPanel visible={$assistantOpen && plan} />
{#if plan}<SketchLayer />{/if}
<CatalogSheet />
<MenuDrawer {onerror} />

{#if $elementsListOpen}
  <aside class="op-float op-enter op-elements-panel fixed z-[25] right-[var(--chrome-inset)] bottom-[84px] w-[320px] max-w-[calc(100vw-1rem)] flex flex-col overflow-hidden" aria-label={$t('chrome.view.elements')}>
    <div class="flex items-center gap-3 pl-4 pr-2 py-2 shrink-0" style="border-bottom:1px solid var(--color-border-subtle)">
      <div class="flex-1 text-base font-semibold" style="color:var(--color-text-strong)">{$t('chrome.view.elements')}</div>
      <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={() => elementsListOpen.set(false)}><Icon name="close" /></button>
    </div>
    <div class="op-elements flex-1 min-h-0"><LayersPanel /></div>
  </aside>
{/if}

{#if $dialog === 'export'}<ExportDialog {onerror} />{/if}
<SettingsDialog bind:open={settingsOpen} />
<VersionHistoryPanel bind:open={versionsOpen} />
<PrintLayout bind:open={printOpen} />
{#if assistantProject}<AssistantShareDialog project={assistantProject} onclose={() => dialog.set(null)} />{/if}

{#if $dialog === 'area'}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-[70] flex items-center justify-center" style="background:var(--color-scrim)" aria-label={$t('areaSummary.title')}
    onclick={(e) => { if (e.target === e.currentTarget) dialog.set(null); }} oncancel={(e) => { e.preventDefault(); dialog.set(null); }}>
    <div class="op-popover op-enter w-[440px] max-w-[calc(100vw-2rem)] max-h-[80dvh] flex flex-col overflow-hidden">
      <div class="flex items-center justify-between pl-5 pr-2 py-2" style="border-bottom:1px solid var(--color-border-subtle)">
        <h2 class="text-base font-semibold" style="color:var(--color-text-strong)">{$t('areaSummary.title')}</h2>
        <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={() => dialog.set(null)}><Icon name="close" /></button>
      </div>
      <div class="op-scroll p-1"><AreaSummaryPanel /></div>
    </div>
  </dialog>
{/if}

{#if errorMessage}
  <ImportError title={$t('projectToolbar.openError')} message={errorMessage} onDismiss={() => errorMessage = null} />
{/if}
<ExportNotice />
