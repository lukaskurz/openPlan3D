<script lang="ts">
  import { t } from '$lib/i18n';
  import { snapEnabled } from '$lib/stores/project';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { snapOptions } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';

  const GRID_SIZES = [1, 10, 25, 50];
  const ANGLES = [15, 45, 90] as const;

  let gridOn = $derived($snapEnabled && $projectSettings.snapToGrid);
  let angleOn = $derived($snapEnabled && $snapOptions.angleStep > 0);
  let objectsOn = $derived($snapOptions.objects);
  let gridLabel = $derived(formatLength($projectSettings.gridSize, $projectSettings.units));

  function toggleGrid() {
    if (!$snapEnabled) { snapEnabled.set(true); projectSettings.update(s => ({ ...s, snapToGrid: true })); return; }
    projectSettings.update(s => ({ ...s, snapToGrid: !s.snapToGrid }));
  }
  let lastAngle = $state<15 | 45 | 90>(45);
  function toggleAngle() {
    if (!$snapEnabled) snapEnabled.set(true);
    if ($snapOptions.angleStep) { lastAngle = $snapOptions.angleStep; snapOptions.update(o => ({ ...o, angleStep: 0 })); }
    else snapOptions.update(o => ({ ...o, angleStep: lastAngle }));
  }
  function setGrid(size: number | 0) {
    if (!size) projectSettings.update(s => ({ ...s, snapToGrid: false }));
    else { snapEnabled.set(true); projectSettings.update(s => ({ ...s, snapToGrid: true, gridSize: size })); }
  }

  let ref: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if ($popover === 'snap-settings' && ref && !ref.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative" bind:this={ref}>
  {#if $popover === 'snap-settings'}
    <div class="op-popover op-enter absolute right-0 bottom-full mb-3 w-[22rem] max-w-[calc(100vw-1rem)] p-4 flex flex-col gap-4 z-50" role="dialog" aria-label={$t('chrome.snap.title')}>
      <div>
        <div class="text-sm font-semibold" style="color:var(--color-text-strong)">{$t('chrome.snap.title')}</div>
        <div class="text-xs" style="color:var(--color-text-muted)">{$t('chrome.snap.subtitle')}</div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 text-sm font-semibold" style="color:var(--color-text-secondary)"><Icon name="grid" size={18} /><span class="flex-1">{$t('chrome.snap.grid')}</span><span class="text-xs font-normal" style="color:var(--color-text-muted)">{$t('chrome.snap.gridHint')}</span></div>
        <div class="op-seg">
          <button aria-pressed={!$projectSettings.snapToGrid} onclick={() => setGrid(0)}>{$t('toolbarView.off')}</button>
          {#each GRID_SIZES as size}
            <button aria-pressed={$projectSettings.snapToGrid && $projectSettings.gridSize === size} onclick={() => setGrid(size)}>{formatLength(size, $projectSettings.units)}</button>
          {/each}
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 text-sm font-semibold" style="color:var(--color-text-secondary)"><Icon name="angle" size={18} /><span class="flex-1">{$t('chrome.snap.angles')}</span><span class="text-xs font-normal" style="color:var(--color-text-muted)">{$t('chrome.snap.anglesHint')}</span></div>
        <div class="op-seg">
          <button aria-pressed={$snapOptions.angleStep === 0} onclick={() => snapOptions.update(o => ({ ...o, angleStep: 0 }))}>{$t('toolbarView.off')}</button>
          {#each ANGLES as angle}
            <button aria-pressed={$snapOptions.angleStep === angle} onclick={() => snapOptions.update(o => ({ ...o, angleStep: angle }))}>{angle}°</button>
          {/each}
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2 text-sm font-semibold" style="color:var(--color-text-secondary)"><Icon name="magnet" size={18} /><span class="flex-1">{$t('chrome.snap.objects')}</span></div>
        <div class="flex items-center gap-3 text-sm" style="color:var(--color-text-secondary)">
          <span class="flex-1">{$t('chrome.snap.corners')}</span>
          <button class="op-switch" role="switch" aria-checked={$snapOptions.objects} aria-label={$t('chrome.snap.corners')} onclick={() => snapOptions.update(o => ({ ...o, objects: !o.objects }))}></button>
        </div>
        <div class="flex items-center gap-3 text-sm" style="color:var(--color-text-secondary)">
          <span class="flex-1">{$t('chrome.snap.furniture')}</span>
          <button class="op-switch" role="switch" aria-checked={$projectSettings.snapToWalls} aria-label={$t('chrome.snap.furniture')} onclick={() => projectSettings.update(s => ({ ...s, snapToWalls: !s.snapToWalls }))}></button>
        </div>
      </div>
      <div class="flex items-start gap-2.5 p-3 rounded-lg text-xs leading-snug" style="background:var(--color-surface-subtle);color:var(--color-text-tertiary)">
        <Icon name="pan" size={18} class="shrink-0" />
        <span>{$t('chrome.snap.bypass')}</span>
      </div>
    </div>
  {/if}

  <div class="op-float op-cluster" role="group" aria-label={$t('chrome.snap.title')} data-snap-control>
    <span class="text-xs font-medium px-2 max-sm:hidden" style="color:var(--color-text-muted)">{$t('chrome.snap.label')}</span>
    <button class="op-btn {gridOn ? 'is-active' : ''}" aria-pressed={gridOn} title={$t('chrome.snap.grid')} onclick={toggleGrid}>
      <Icon name="grid" size={18} /><span class="max-md:hidden tabular-nums">{gridLabel}</span>
    </button>
    <button class="op-btn {angleOn ? 'is-active' : ''}" aria-pressed={angleOn} title={$t('chrome.snap.angles')} onclick={toggleAngle}>
      <Icon name="angle" size={18} /><span class="max-md:hidden">{$snapOptions.angleStep || lastAngle}°</span>
    </button>
    <button class="op-btn {objectsOn ? 'is-active' : ''}" aria-pressed={objectsOn} title={$t('chrome.snap.objects')} onclick={() => snapOptions.update(o => ({ ...o, objects: !o.objects }))}>
      <Icon name="magnet" size={18} /><span class="max-lg:hidden">{$t('chrome.snap.objectsShort')}</span>
    </button>
    <div class="op-divider-v !mx-0.5"></div>
    <button class="op-btn is-square" aria-label={$t('chrome.snap.settings')} aria-expanded={$popover === 'snap-settings'} onclick={() => togglePopover('snap-settings')}>
      <Icon name="sliders" size={20} />
    </button>
  </div>
</div>
