<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import { modalDialog, hasOpenModal } from '$lib/utils/modalDialog';
  import { currentProject, activeFloor, viewMode, elevationWallId, layerVisibility } from '$lib/stores/project';
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
  import ToolStrip from './ToolStrip.svelte';
  import ToolTray from './ToolTray.svelte';
  import ViewCluster from './ViewCluster.svelte';
  import FloorRail from './FloorRail.svelte';
  import BottomBar from './BottomBar.svelte';
  import StatusPill from './StatusPill.svelte';
  import SnapControl from './SnapControl.svelte';
  import SelectionBar from './SelectionBar.svelte';
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

  let plan = $derived($viewMode === '2d' && !$elevationWallId);
  let floorBelow = $derived(getFloorBelow($currentProject));
  let emptyPlan = $derived(plan && !!$floorView && !hasPlanContent($floorView)
    && !($layerVisibility.floorBelow && floorBelow && hasPlanContent(floorBelow))
    && ($toolGroup === 'select' || $toolGroup === 'view') && !$catalogOpen && !$popover && !$assistantOpen);
  let historyOpen = $derived($popover === 'history');

  // The top row holds the project, the tool strip and the view controls side by side when they fit;
  // otherwise the tool strip gets its own row. Measured, so it holds for any width and any content.
  let topRow: HTMLDivElement | undefined = $state();
  let stacked = $state(false);
  $effect(() => {
    if (!topRow) return;
    const row = topRow;
    const fit = () => {
      const [left, center, right] = [...row.children] as HTMLElement[];
      const natural = (el: HTMLElement) => Math.max(0, ...[...el.children].map(child => (child as HTMLElement).scrollWidth));
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      // The tool strip stays centred, so both corners get the wider corner's room.
      stacked = 2 * Math.max(natural(left), natural(right)) + natural(center) + 2 * gap > row.clientWidth;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    for (const child of row.children) for (const inner of child.children) observer.observe(inner);
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
    <div class="op-center">
      {#if plan}<div class="op-tool-row"><ToolStrip /><AssistantButton /></div>{/if}
      <SaveBanner />
      {#if plan}<ToolTray />{/if}
      {#if plan && !$assistantOpen}<CheckBar />{/if}
    </div>
    <div class="op-right"><ViewCluster /></div>
  </div>

  {#if $viewMode === '2d' || $currentProject?.floors.length !== 1}
    <!-- Above the bottom sheet when one is open, instead of on top of its header. -->
    <div class="op-left-rail" class:above-sheet={$planInsetBottom > 0} style:--sheet-inset="{$planInsetBottom}px"><FloorRail /></div>
  {/if}

  <div class="op-bottom {historyOpen ? 'is-history' : ''}">
    <div><BottomBar /></div>
    {#if !historyOpen}
      <div>{#if plan}<StatusPill />{/if}</div>
      <div>{#if plan}<SnapControl />{/if}</div>
    {/if}
  </div>
</div>

<SelectionBar />
<Inspector />
<AssistantPanel visible={$assistantOpen && plan} />
{#if plan}<SketchLayer />{/if}
<CatalogSheet />
<MenuDrawer {onerror} />

{#if $elementsListOpen}
  <aside class="op-float op-enter fixed z-[25] right-[var(--chrome-inset)] top-[84px] bottom-[84px] w-[320px] max-w-[calc(100vw-1rem)] flex flex-col overflow-hidden" aria-label={$t('chrome.view.elements')}>
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
