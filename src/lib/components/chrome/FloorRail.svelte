<script lang="ts">
  import { t } from '$lib/i18n';
  import { currentProject, addFloor, removeFloor, setActiveFloor, updateFloorElevation, updateFloorSlabThickness, layerVisibility, type FloorSeed } from '$lib/stores/project';
  import { floorElevations } from '$lib/utils/floors';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';

  // Highest floor at the top, like the building.
  let entries = $derived(floorElevations($currentProject?.floors ?? []).slice().reverse());
  let activeId = $derived($currentProject?.activeFloorId);
  let active = $derived(entries.find(entry => entry.floor.id === activeId));
  let confirmingRemove = $state(false);

  /** Short label for the rail: G for the ground floor, otherwise the floor's number. */
  function short(name: string, level: number) {
    const digits = name.match(/-?\d+/)?.[0];
    if (digits) return digits;
    if (level === 0) return 'G';
    return name.trim().charAt(0).toUpperCase() || String(level);
  }

  function pick(id: string) {
    confirmingRemove = false;
    if (id === activeId) togglePopover('floor-settings');
    else { closePopover(); setActiveFloor(id); }
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
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative" bind:this={railRef}>
  <div class="op-float flex flex-col items-center gap-0.5 p-1" role="group" aria-label={$t('floorControls.floors')} data-floor-rail>
    <button class="op-btn is-square" aria-label={$t('floorControls.add')} title={$t('floorControls.add')} aria-expanded={$popover === 'floors-add'} onclick={() => togglePopover('floors-add')}>
      <Icon name="plus" />
    </button>
    {#each entries as { floor, level } (floor.id)}
      {@const current = floor.id === activeId}
      <button class="op-btn is-square {current ? 'is-active font-bold' : ''}" aria-pressed={current} title={floor.name} aria-label={floor.name} onclick={() => pick(floor.id)}>
        {short(floor.name, level)}
      </button>
    {/each}
  </div>

  {#if $popover === 'floors-add'}
    <div class="op-popover op-enter op-menu absolute left-full ml-3 top-0 w-80 z-50" role="menu">
      <div class="op-menu-title">{$t('chrome.floors.addTitle')}</div>
      <button class="op-menu-item" onclick={() => add('outer')}><Icon name="roomShape" size={18} /><span>{$t('floorControls.exterior')}<span class="op-sub">{$t('chrome.floors.outerHint')}</span></span></button>
      <button class="op-menu-item" onclick={() => add('copy')}><Icon name="wall" size={18} /><span>{$t('floorControls.all')}<span class="op-sub">{$t('chrome.floors.allHint')}</span></span></button>
      <button class="op-menu-item" onclick={() => add('empty')}><Icon name="plus" size={18} /><span>{$t('floorControls.empty')}<span class="op-sub">{$t('chrome.floors.emptyHint')}</span></span></button>
    </div>
  {:else if $popover === 'floor-settings' && active}
    <div class="op-popover op-enter absolute left-full ml-3 top-0 w-80 z-50 p-4 flex flex-col gap-4" role="dialog" aria-label={active.floor.name}>
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
