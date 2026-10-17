<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { viewMode, elevationWallId, openSectionId, elevationPickMode, layerVisibility } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { planDisplay } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, elementsListOpen } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';

  /** A wall elevation or a section belongs to the plan side: 2D stays pressed, and tapping it goes back to the plan. */
  let is3d = $derived($viewMode === '3d');
  let open = $derived($popover === 'show');

  function show2D() {
    viewMode.set('2d');
    elevationWallId.set(null);
    openSectionId.set(null);
    elevationPickMode.set(false);
    closePopover();
  }

  function show3D() {
    elevationPickMode.set(false);
    viewMode.set('3d');
    closePopover();
  }

  type Layer = 'roomLabels' | 'constraints' | 'underlay' | 'sections' | 'floorBelow' | 'furniture';
  const layer = (key: Layer) => ({ on: $layerVisibility[key], toggle: () => layerVisibility.update(v => ({ ...v, [key]: !v[key] })) });

  type Row = { label: TranslationKey; on: boolean; toggle: () => void; key: string };
  let rows = $derived<Row[]>([
    { key: 'dimensions', label: 'chrome.view.dimensions', on: $projectSettings.showDimensions, toggle: () => projectSettings.update(s => ({ ...s, showDimensions: !s.showDimensions })) },
    { key: 'roomNames', label: 'chrome.view.roomNames', ...layer('roomLabels') },
    { key: 'measurements', label: 'chrome.view.measurements', on: $layerVisibility.measurements && $layerVisibility.annotations, toggle: () => layerVisibility.update(v => { const on = !(v.measurements && v.annotations); return { ...v, measurements: on, annotations: on }; }) },
    { key: 'rules', label: 'chrome.view.rules', ...layer('constraints') },
    { key: 'drawings', label: 'chrome.view.drawings', ...layer('underlay') },
    { key: 'sections', label: 'chrome.view.sections', ...layer('sections') },
    { key: 'grid', label: 'chrome.view.grid', on: $planDisplay.grid, toggle: () => planDisplay.update(d => ({ ...d, grid: !d.grid })) },
    { key: 'rulers', label: 'chrome.view.rulers', on: $planDisplay.rulers, toggle: () => planDisplay.update(d => ({ ...d, rulers: !d.rulers })) },
    { key: 'minimap', label: 'chrome.view.minimap', on: $planDisplay.minimap, toggle: () => planDisplay.update(d => ({ ...d, minimap: !d.minimap })) },
    { key: 'floorBelow', label: 'chrome.view.floorBelow', ...layer('floorBelow') },
    { key: 'furniture', label: 'chrome.view.furniture', ...layer('furniture') },
  ]);

  let menuRef: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (open && menuRef && !menuRef.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="flex items-center gap-2.5 relative" bind:this={menuRef}>
  <div class="op-float op-cluster op-mode" role="group" aria-label={$t('chrome.view.mode')}>
    <button aria-pressed={!is3d} onclick={show2D} title={$t('chrome.view.plan2d')} data-mode="plan"><Icon name="roomShape" size={18} />2D</button>
    <button aria-pressed={is3d} onclick={show3D} title={$t('chrome.view.view3d')} data-mode="3d"><Icon name="cube" size={18} />3D</button>
  </div>
  <button class="op-float op-btn is-square is-big shrink-0 relative" style="width:52px;height:52px" aria-label={$t('chrome.view.show')} title={$t('chrome.view.show')}
    aria-haspopup="menu" aria-expanded={open} onclick={() => togglePopover('show')} data-show-menu>
    <Icon name="layers" />
    <Icon name="chevronDown" size={10} strokeWidth={3} class="op-corner-chevron" />
  </button>

  {#if open}
    <div class="op-popover op-enter op-menu absolute right-0 top-full mt-3 w-[19rem] max-w-[calc(100vw-1rem)] z-50 op-scroll max-h-[calc(100dvh-7rem)]" role="menu" aria-label={$t('chrome.view.show')} data-show-popover>
      <div class="op-menu-title">{$t('chrome.view.show')}</div>
      {#each rows as row (row.key)}
        <div class="op-menu-row" data-show-row={row.key}>
          <span class="flex-1">{$t(row.label)}</span>
          <button class="op-switch" role="switch" aria-checked={row.on} aria-label={$t(row.label)} onclick={row.toggle}></button>
        </div>
      {/each}
      <div class="op-divider"></div>
      <button class="op-menu-item" onclick={() => { elementsListOpen.set(true); closePopover(); }}><Icon name="list" size={18} /><span class="flex-1">{$t('chrome.view.elements')}</span><Icon name="chevronRight" size={18} /></button>
    </div>
  {/if}
</div>
