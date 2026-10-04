<script lang="ts">
  import { get } from 'svelte/store';
  import { t, type TranslationKey } from '$lib/i18n';
  import { viewMode, activeFloor, selectedElementId, elevationWallId, elevationPickMode, layerVisibility } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { planDisplay, planViewApi } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, elementsListOpen } from '$lib/stores/chrome';
  import { themePreference, type ThemePreference } from '$lib/stores/theme';
  import Icon from './Icon.svelte';

  const themes: { value: ThemePreference; label: TranslationKey }[] = [
    { value: 'light', label: 'settings.themeLight' },
    { value: 'dark', label: 'settings.themeDark' },
    { value: 'system', label: 'settings.themeSystem' },
  ];

  let mode = $derived($viewMode === '3d' ? '3d' : $elevationWallId ? 'elevation' : 'plan');

  function showPlan() {
    viewMode.set('2d');
    elevationWallId.set(null);
    elevationPickMode.set(false);
    closePopover();
  }

  /** With a wall selected, open it face-on; otherwise ask for a wall on the plan. */
  function showElevation() {
    closePopover();
    if (get(viewMode) === '3d') viewMode.set('2d');
    if (get(elevationWallId)) return;
    const selected = get(selectedElementId);
    const wall = selected ? get(activeFloor)?.walls.find(w => w.id === selected) : undefined;
    if (wall) {
      elevationPickMode.set(false);
      elevationWallId.set(wall.id);
    } else {
      elevationPickMode.update(v => !v);
    }
  }

  function show3D() {
    elevationPickMode.set(false);
    viewMode.set('3d');
    closePopover();
  }

  type Row = { label: TranslationKey; on: boolean; toggle: () => void; disabled?: boolean };
  let rows = $derived<Row[]>([
    { label: 'chrome.view.furniture', on: $layerVisibility.furniture, toggle: () => layerVisibility.update(v => ({ ...v, furniture: !v.furniture })) },
    { label: 'chrome.view.roomNames', on: $planDisplay.roomLabels, toggle: () => planDisplay.update(d => ({ ...d, roomLabels: !d.roomLabels })) },
    { label: 'chrome.view.dimensions', on: $projectSettings.showDimensions, toggle: () => projectSettings.update(s => ({ ...s, showDimensions: !s.showDimensions })) },
    { label: 'chrome.view.measurements', on: $layerVisibility.measurements && $layerVisibility.annotations, toggle: () => layerVisibility.update(v => { const on = !(v.measurements && v.annotations); return { ...v, measurements: on, annotations: on }; }) },
    { label: 'chrome.view.rules', on: $layerVisibility.constraints, toggle: () => layerVisibility.update(v => ({ ...v, constraints: !v.constraints })) },
    { label: 'chrome.view.grid', on: $planDisplay.grid, toggle: () => planDisplay.update(d => ({ ...d, grid: !d.grid })) },
    { label: 'chrome.view.rulers', on: $planDisplay.rulers, toggle: () => planDisplay.update(d => ({ ...d, rulers: !d.rulers })) },
    { label: 'chrome.view.floorBelow', on: $layerVisibility.floorBelow, toggle: () => layerVisibility.update(v => ({ ...v, floorBelow: !v.floorBelow })) },
    { label: 'chrome.view.minimap', on: $planDisplay.minimap, toggle: () => planDisplay.update(d => ({ ...d, minimap: !d.minimap })) },
  ]);

  let menuRef: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if ($popover === 'view' && menuRef && !menuRef.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="flex items-center gap-2.5 relative" bind:this={menuRef}>
  <div class="op-float op-cluster op-mode" role="group" aria-label={$t('chrome.view.mode')}>
    <button aria-pressed={mode === 'plan'} onclick={showPlan} data-mode="plan">{$t('toolbarView.plan')}</button>
    <button aria-pressed={mode === 'elevation'} class={$elevationPickMode ? 'is-picking' : ''} onclick={showElevation} data-mode="elevation">{$t('toolbarView.elevation')}</button>
    <button aria-pressed={mode === '3d'} onclick={show3D} data-mode="3d">3D</button>
  </div>
  <button class="op-float op-btn is-square is-big shrink-0" style="width:54px;height:54px" aria-label={$t('chrome.view.options')} aria-expanded={$popover === 'view'} onclick={() => togglePopover('view')} data-view-menu>
    <Icon name="layers" />
  </button>

  {#if $popover === 'view'}
    <div class="op-popover op-enter op-menu absolute right-0 top-full mt-3 w-[19rem] max-w-[calc(100vw-1rem)] z-50 op-scroll max-h-[calc(100dvh-7rem)]" role="menu">
      <div class="op-menu-title">{$t('settings.theme')}</div>
      <div class="op-seg is-small mx-3 mb-1" role="group" aria-label={$t('settings.theme')} data-theme-toggle>
        {#each themes as th}
          <button aria-pressed={$themePreference === th.value} onclick={() => themePreference.set(th.value)}>{$t(th.label)}</button>
        {/each}
      </div>
      <div class="op-divider"></div>
      {#if $viewMode === '2d' && !$elevationWallId}
        <button class="op-menu-item" onclick={() => { $planViewApi?.zoomToFit(); closePopover(); }}><Icon name="fit" size={18} />{$t('chrome.view.fit')}</button>
      {/if}
      <button class="op-menu-item" onclick={() => { elementsListOpen.set(true); closePopover(); }}><Icon name="list" size={18} /><span class="flex-1">{$t('chrome.view.elements')}</span><Icon name="chevronRight" size={18} /></button>
      <div class="op-divider"></div>
      <div class="op-menu-title">{$t('chrome.view.showOnPlan')}</div>
      {#each rows as row}
        <div class="op-menu-row">
          <span class="flex-1">{$t(row.label)}</span>
          <button class="op-switch" role="switch" aria-checked={row.on} aria-label={$t(row.label)} onclick={row.toggle}></button>
        </div>
      {/each}
    </div>
  {/if}
</div>
