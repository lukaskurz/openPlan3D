<script lang="ts">
  import { t } from '$lib/i18n';
  import { currentProject, addFloor, removeFloor, setActiveFloor, updateFloorElevation, updateFloorSlabThickness, layerVisibility, viewMode, elevationWallId, type FloorSeed } from '$lib/stores/project';
  import { activeSurface, type Surface } from '$lib/stores/workContext';
  import { railStoreys } from '$lib/utils/floorRail';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import { switchSurface } from './surface';
  import Icon from './Icon.svelte';

  // Highest floor at the top, like the building.
  let activeId = $derived($currentProject?.activeFloorId);
  let entries = $derived(railStoreys($currentProject?.floors ?? [], activeId));
  let active = $derived(entries.find(entry => entry.current));
  // Ceiling and floor are surfaces of the plan; 3D and wall elevations have no use for them.
  let showSurfaces = $derived($viewMode === '2d' && !$elevationWallId);
  let confirmingRemove = $state(false);
  let announcement = $state('');

  function pick(id: string) {
    confirmingRemove = false;
    if (id === activeId) togglePopover('floor-settings');
    // Switching storey keeps the surface: the ceiling of one storey leads to the ceiling of the next.
    else { closePopover(); setActiveFloor(id); }
  }

  function chooseSurface(surface: Surface) {
    confirmingRemove = false;
    if (switchSurface(surface)) announcement = $t(surface === 'ceiling' ? 'chrome.floors.lookingAtCeiling' : 'chrome.floors.lookingAtFloor');
  }

  function add(seed: FloorSeed) {
    addFloor(undefined, seed);
    closePopover();
  }

  function numberInput(event: Event, apply: (value: number) => void) {
    const input = event.currentTarget as HTMLInputElement;
    if (input.value.trim() !== '' && Number.isFinite(input.valueAsNumber)) apply(input.valueAsNumber);
  }

  let railRef: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (($popover === 'floors-add' || $popover === 'floor-settings') && railRef && !railRef.contains(e.target as Node)) closePopover();
  }

  // With many storeys the list scrolls; keep the current one in view.
  let currentRef: HTMLDivElement | undefined = $state();
  $effect(() => {
    void activeId;
    currentRef?.scrollIntoView?.({ block: 'nearest' });
  });
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="op-rail-wrap" bind:this={railRef}>
  <div class="op-float op-rail" role="group" aria-label={$t('floorControls.floors')} data-floor-rail>
    <button class="op-btn op-rail-btn" aria-label={$t('floorControls.add')} title={$t('floorControls.add')} aria-haspopup="menu" aria-expanded={$popover === 'floors-add'} onclick={() => { confirmingRemove = false; togglePopover('floors-add'); }}>
      <Icon name="plus" />
    </button>
    <div class="op-rail-divider" aria-hidden="true"></div>
    <div class="op-rail-storeys">
      {#each entries as { floor, label, current } (floor.id)}
        {#if current}
          <div class="op-rail-current" bind:this={currentRef} data-rail-current>
            <button class="op-btn op-rail-btn" aria-current="location" aria-haspopup="dialog" aria-expanded={$popover === 'floor-settings'}
              aria-label={$t('chrome.floors.settingsFor', { name: floor.name })} title={floor.name} onclick={() => pick(floor.id)}>
              {label}
            </button>
            {#if showSurfaces}
              <button class="op-btn op-rail-btn op-rail-surface" aria-pressed={$activeSurface === 'ceiling'} title={$t('chrome.floors.ceiling')}
                aria-label={$t('chrome.floors.ceilingOf', { name: floor.name })} onclick={() => chooseSurface('ceiling')} data-surface="ceiling">
                <Icon name="ceiling" />
              </button>
              <button class="op-btn op-rail-btn op-rail-surface" aria-pressed={$activeSurface === 'floor'} title={$t('chrome.floors.floor')}
                aria-label={$t('chrome.floors.floorOf', { name: floor.name })} onclick={() => chooseSurface('floor')} data-surface="floor">
                <Icon name="floor" />
              </button>
            {/if}
          </div>
        {:else}
          <button class="op-btn op-rail-btn" title={floor.name} aria-label={floor.name} onclick={() => pick(floor.id)}>{label}</button>
        {/if}
      {/each}
    </div>
  </div>
  <span class="sr-only" role="status" aria-live="polite">{announcement}</span>

  {#if $popover === 'floors-add'}
    <div class="op-popover op-enter op-menu op-rail-popover w-80" role="menu">
      <div class="op-menu-title">{$t('chrome.floors.addTitle')}</div>
      <button class="op-menu-item" onclick={() => add('outer')}><Icon name="roomShape" size={18} /><span>{$t('floorControls.exterior')}<span class="op-sub">{$t('chrome.floors.outerHint')}</span></span></button>
      <button class="op-menu-item" onclick={() => add('copy')}><Icon name="wall" size={18} /><span>{$t('floorControls.all')}<span class="op-sub">{$t('chrome.floors.allHint')}</span></span></button>
      <button class="op-menu-item" onclick={() => add('empty')}><Icon name="plus" size={18} /><span>{$t('floorControls.empty')}<span class="op-sub">{$t('chrome.floors.emptyHint')}</span></span></button>
    </div>
  {:else if $popover === 'floor-settings' && active}
    <div class="op-popover op-enter op-rail-popover w-80 p-4 flex flex-col gap-4" role="dialog" aria-label={active.floor.name}>
      <div class="text-base font-semibold" style="color:var(--color-text-strong)">{active.floor.name}</div>
      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="op-label">{$t('chrome.floors.level')}</span>
          <span class="op-field"><input type="number" step="any" inputmode="decimal" value={active.elevation} oninput={(e) => numberInput(e, v => updateFloorElevation(active.floor.id, v))} /><span class="op-unit">cm</span></span>
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="op-label">{$t('chrome.floors.slab')}</span>
          <span class="op-field"><input type="number" step="any" inputmode="decimal" value={active.floor.slabThickness ?? 5} oninput={(e) => numberInput(e, v => { if (v > 0) updateFloorSlabThickness(active.floor.id, v); })} /><span class="op-unit">cm</span></span>
        </label>
      </div>
      <div class="flex items-center gap-3 text-sm" style="color:var(--color-text-secondary)">
        <span class="flex-1">{$t('chrome.view.floorBelow')}</span>
        <button class="op-switch" role="switch" aria-checked={$layerVisibility.floorBelow} aria-label={$t('chrome.view.floorBelow')} onclick={() => layerVisibility.update(v => ({ ...v, floorBelow: !v.floorBelow }))}></button>
      </div>
      <div class="op-divider !mx-0"></div>
      {#if confirmingRemove}
        <div class="flex items-center gap-2">
          <span class="flex-1 text-sm" style="color:var(--color-text-secondary)">{$t('chrome.floors.confirmRemove', { name: active.floor.name })}</span>
          <button class="op-btn" onclick={() => confirmingRemove = false}>{$t('chrome.cancel')}</button>
          <button class="op-btn is-danger" onclick={() => { removeFloor(active.floor.id); confirmingRemove = false; closePopover(); }}>{$t('chrome.delete')}</button>
        </div>
      {:else}
        <button class="op-btn is-danger justify-start -mx-2" disabled={entries.length <= 1} onclick={() => confirmingRemove = true}>
          <Icon name="trash" size={18} />{$t('chrome.floors.remove', { name: active.floor.name })}
        </button>
      {/if}
    </div>
  {/if}
</div>
