<script lang="ts">
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import {
    activeFloor, currentProject, selectedElementId, selectedElementIds, selectedRoomId, selectedTool, detectedRoomsStore,
    constraintPickMode, elevationWallId, removeElement, duplicateSelection, beginUndoGroup, endUndoGroup,
    resizeWallLength, reverseWall, updateDoor, updateWindow, rotateFurniture, toggleFurnitureLock,
    toggleSelectionLock, addGeometricConstraint, removeConstraint, wallConstraint, showPlanNotice, findGroupForElement,
  } from '$lib/stores/project';
  import type { Door, Window as Win } from '$lib/models/types';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { planViewApi, selectionAnchor } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, inspectorOpen, floorView } from '$lib/stores/chrome';
  import { furnitureName, customModelName } from '$lib/i18n/furnitureNames';
  import { getFurnitureSize } from '$lib/utils/furnitureCatalog';
  import { alignElements, alignmentItems, type AlignmentOp } from '$lib/utils/alignment';
  import { wallLength } from '$lib/utils/wallEditing';
  import Keypad from './Keypad.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  let floor = $derived($floorView);
  let id = $derived($selectedElementId);
  let multi = $derived($selectedElementIds.size >= 2);

  let wall = $derived(!multi && id ? floor?.walls.find(w => w.id === id) : undefined);
  let door = $derived(!multi && id ? floor?.doors.find(d => d.id === id) : undefined);
  let win = $derived(!multi && id ? floor?.windows.find(w => w.id === id) : undefined);
  let furniture = $derived(!multi && id ? floor?.furniture.find(f => f.id === id) : undefined);
  let room = $derived(!multi && !id && $selectedRoomId ? $detectedRoomsStore.find(r => r.id === $selectedRoomId) : undefined);
  let other = $derived(!multi && id && !wall && !door && !win && !furniture);

  let kind = $derived(multi ? 'multi' : wall ? 'wall' : door ? 'door' : win ? 'window' : furniture ? 'furniture' : room ? 'room' : other ? 'other' : null);
  let visible = $derived(!!kind && !!$selectionAnchor && $selectedTool === 'select' && !$constraintPickMode && !$elevationWallId);

  let units = $derived($projectSettings.units);
  const len = (cm: number) => formatLength(cm, units);

  // ── Placement: above the selection, or below it when there's no room ──
  let barWidth = $state(0);
  let barHeight = $state(64);
  let viewport = $state({ w: 1024, h: 768 });
  const TOP_RESERVED = 150;
  let position = $derived.by(() => {
    const a = $selectionAnchor;
    if (!a) return { left: 0, top: 0, below: false };
    const cx = (a.left + a.right) / 2;
    const left = Math.max(12, Math.min(viewport.w - barWidth - 12, cx - barWidth / 2));
    let top = a.top - barHeight - 14;
    let below = false;
    if (top < TOP_RESERVED) { top = a.bottom + 14; below = true; }
    top = Math.max(TOP_RESERVED, Math.min(viewport.h - barHeight - 84, top));
    return { left, top, below };
  });

  // Popovers open on whichever side of the bar has room for them.
  let popHeight = $state(0);
  let popWidth = $state(0);
  let popBelow = $derived.by(() => {
    const above = position.top - 12;
    const below = viewport.h - (position.top + barHeight) - 12;
    const preferBelow = position.below;
    if (preferBelow) return below >= popHeight || below >= above;
    return !(above >= popHeight || above >= below);
  });
  let popMaxHeight = $derived(Math.max(160, popBelow ? viewport.h - (position.top + barHeight) - 20 : position.top - 20));
  let popAlignRight = $derived(position.left + popWidth > viewport.w - 12);

  // ── Actions ──
  function select(ids: string[]) {
    if (!ids.length) return;
    selectedElementIds.set(ids.length > 1 ? new Set(ids) : new Set());
    selectedElementId.set(ids[0]);
  }
  function duplicate() {
    const ids = multi ? $selectedElementIds : id ? new Set([id]) : null;
    if (ids) select(duplicateSelection(ids));
  }
  function deleteSelection() {
    closePopover();
    if (room) { $planViewApi?.runAction('delete-room', room.id); return; }
    if (multi) {
      beginUndoGroup();
      for (const item of $selectedElementIds) removeElement(item);
      endUndoGroup('Deleted selection');
      selectedElementIds.set(new Set());
      selectedElementId.set(null);
    } else if (id) {
      removeElement(id);
      selectedElementId.set(null);
    }
  }
  function showDetails() {
    closePopover();
    inspectorOpen.update(open => !open);
  }
  function run(action: string, target = id) {
    closePopover();
    $planViewApi?.runAction(action, target ?? null);
  }

  // Wall length: which end stays put.
  let fixedEnd = $state<'start' | 'end'>('start');
  function applyWallLength(cm: number) {
    if (!wall) return;
    const error = resizeWallLength(wall.id, cm, fixedEnd);
    if (error) showPlanNotice(error, 'error');
    closePopover();
  }
  function applyOpeningWidth(cm: number) {
    if (door) updateDoor(door.id, { width: cm });
    if (win) updateWindow(win.id, { width: cm });
    closePopover();
  }

  // Wall rules
  let wallRules = $derived(wall && floor ? (['vertical', 'horizontal', 'fix'] as const).filter(k => wallConstraint(floor, wall.id, k)) : []);
  function toggleRule(kindName: 'vertical' | 'horizontal' | 'fix') {
    if (!wall || !floor) return;
    const existing = wallConstraint(floor, wall.id, kindName);
    if (existing) removeConstraint(existing.id);
    else {
      const result = addGeometricConstraint(kindName, [wall.id]);
      if ('error' in result) showPlanNotice(result.error, 'error');
    }
    closePopover();
  }
  function pickSecondWall(kindName: 'parallel' | 'perpendicular') {
    closePopover();
    constraintPickMode.set(kindName);
  }

  const DOOR_TYPES: Door['type'][] = ['single', 'double', 'sliding', 'french', 'balcony', 'pocket', 'bifold', 'opening', 'garage'];
  const WINDOW_TYPES: Win['type'][] = ['standard', 'fixed', 'casement', 'sliding', 'bay'];
  const DOOR_LABEL: Record<Door['type'], TranslationKey> = { single: 'openingCatalog.single', double: 'openingCatalog.double', sliding: 'openingCatalog.sliding', french: 'openingCatalog.french', balcony: 'openingCatalog.balcony', pocket: 'openingCatalog.pocket', bifold: 'openingCatalog.bifold', opening: 'openingCatalog.doorway', garage: 'openingCatalog.garage' };
  const WINDOW_LABEL: Record<Win['type'], TranslationKey> = { standard: 'openingCatalog.standard', fixed: 'openingCatalog.fixed', casement: 'openingCatalog.casement', sliding: 'openingCatalog.sliding', bay: 'openingCatalog.bay' };

  const ALIGN: { op: AlignmentOp; label: TranslationKey; icon: string }[] = [
    { op: 'align-left', label: 'alignment.alignLeft', icon: 'M4 3v18M8 8h12M8 16h8' },
    { op: 'align-center-h', label: 'alignment.centerHorizontal', icon: 'M12 3v18M6 8h12M8 16h8' },
    { op: 'align-right', label: 'alignment.alignRight', icon: 'M20 3v18M4 8h12M8 16h8' },
    { op: 'align-top', label: 'alignment.alignTop', icon: 'M3 4h18M8 8v12M16 8v8' },
    { op: 'align-center-v', label: 'alignment.centerVertical', icon: 'M3 12h18M8 6v12M16 8v8' },
    { op: 'align-bottom', label: 'alignment.alignBottom', icon: 'M3 20h18M8 4v12M16 8v8' },
    { op: 'distribute-h', label: 'alignment.distributeHorizontally', icon: 'M4 3v18M20 3v18M9 8h6M9 16h6' },
    { op: 'distribute-v', label: 'alignment.distributeVertically', icon: 'M3 4h18M3 20h18M8 9v6M16 9v6' },
  ];
  let alignable = $derived(multi && floor ? alignmentItems(floor, $selectedElementIds) : []);
  let grouped = $derived(multi && floor ? [...$selectedElementIds].some(item => findGroupForElement(floor, item)) : false);

  let furnitureSize = $derived(furniture ? getFurnitureSize(furniture) : null);
  let furnitureLabel = $derived(furniture ? (customModelName(furniture, $currentProject) ?? furnitureName(furniture.catalogId, $locale)) : '');

  function onWindowPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if ($popover?.startsWith('sel-') && !target.closest('[data-selection-bar]')) closePopover();
  }
</script>

<svelte:window bind:innerWidth={viewport.w} bind:innerHeight={viewport.h} onpointerdown={onWindowPointerDown} />

{#snippet action(icon: IconName, label: TranslationKey, onclick: () => void, opts: { active?: boolean; danger?: boolean; expanded?: boolean; badge?: number; disabled?: boolean; data?: string } = {})}
  <button class="op-action {opts.active ? 'is-active' : ''} {opts.danger ? 'is-danger' : ''}" aria-expanded={opts.expanded} aria-pressed={opts.active} disabled={opts.disabled} onclick={onclick} data-action={opts.data}>
    <Icon name={icon} size={20} />
    <span>{$t(label)}</span>
    {#if opts.badge}<span class="op-badge">{opts.badge}</span>{/if}
  </button>
{/snippet}

{#snippet menuItem(icon: IconName, label: string, onclick: () => void, opts: { danger?: boolean; sub?: string; check?: boolean; trailing?: string } = {})}
  <button class="op-menu-item {opts.danger ? 'is-danger' : ''}" onclick={onclick} role="menuitem">
    <Icon name={icon} size={18} />
    <span class="flex-1 min-w-0">{label}{#if opts.sub}<span class="op-sub">{opts.sub}</span>{/if}</span>
    {#if opts.trailing}<span class="text-xs font-normal" style="color:var(--color-text-muted)">{opts.trailing}</span>{/if}
    {#if opts.check}<Icon name="check" size={18} />{/if}
  </button>
{/snippet}

{#if visible}
  <div
    class="fixed z-40"
    style="left:{position.left}px; top:{position.top}px;"
    data-selection-bar={kind}
  >
    <div class="op-float op-enter flex items-center gap-0.5 p-1.5" bind:clientWidth={barWidth} bind:clientHeight={barHeight} role="toolbar" aria-label={$t('chrome.selection.label')}>
      {#if kind === 'wall' && wall}
        <button class="op-value-chip" aria-expanded={$popover === 'sel-length'} onclick={() => togglePopover('sel-length')} data-value-chip>
          <Icon name="ruler" size={18} /><span>{len(wallLength(wall))}</span>
        </button>
        <div class="op-divider-v"></div>
        {@render action('curved', 'chrome.selection.curve', () => run('toggle-curve'), { active: !!wall.curvePoint })}
        {@render action('scissors', 'chrome.selection.split', () => run('split-wall'), { disabled: !!wall.curvePoint })}
        {@render action('constrain', 'chrome.selection.constrain', () => togglePopover('sel-constrain'), { expanded: $popover === 'sel-constrain', badge: wallRules.length })}
        {@render action('duplicate', 'chrome.selection.duplicate', duplicate)}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if (kind === 'door' && door) || (kind === 'window' && win)}
        {@const opening = (door ?? win)!}
        <button class="op-value-chip" aria-expanded={$popover === 'sel-length'} onclick={() => togglePopover('sel-length')} data-value-chip>
          <Icon name="ruler" size={18} /><span>{len(opening.width)}</span>
        </button>
        <div class="op-divider-v"></div>
        {@render action(door ? 'doorSwing' : 'windowPane', 'chrome.selection.type', () => togglePopover('sel-type'), { expanded: $popover === 'sel-type' })}
        {#if door && door.type !== 'opening'}
          {@render action('flip', 'chrome.selection.otherEnd', () => updateDoor(door.id, { swingDirection: door.swingDirection === 'left' ? 'right' : 'left' }))}
          {@render action('rotate', 'chrome.selection.otherSide', () => updateDoor(door.id, { flipSide: !door.flipSide }))}
        {/if}
        {@render action('duplicate', 'chrome.selection.duplicate', duplicate)}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'furniture' && furniture}
        <button class="op-value-chip" aria-expanded={$inspectorOpen} onclick={showDetails} title={furnitureLabel} data-value-chip>
          <Icon name="ruler" size={18} /><span>{furnitureSize ? `${Math.round(furnitureSize.width)} × ${Math.round(furnitureSize.depth)}` : furnitureLabel}</span>
        </button>
        <div class="op-divider-v"></div>
        {@render action('rotate', 'chrome.selection.rotate', () => rotateFurniture(furniture.id, 90), { disabled: furniture.locked })}
        {@render action('flip', 'chrome.selection.flip', () => run('flip-horizontal'), { disabled: furniture.locked })}
        {@render action('palette', 'chrome.selection.look', showDetails)}
        {@render action(furniture.locked ? 'lock' : 'unlock', furniture.locked ? 'chrome.selection.locked' : 'chrome.selection.lock', () => toggleFurnitureLock(furniture.id), { active: furniture.locked })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'room' && room}
        <button class="op-value-chip" onclick={() => { $planViewApi?.renameRoom(room.id); }} title={$t('chrome.selection.rename')} data-value-chip>
          <Icon name="tag" size={18} /><span>{room.name || $t('layers.unnamed')}</span>
        </button>
        <div class="op-divider-v"></div>
        {@render action('palette', 'chrome.selection.finish', () => run('change-floor-texture', room.id))}
        {@render action('sliders', 'chrome.selection.details', showDetails, { active: $inspectorOpen })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'multi'}
        <span class="op-value-chip pointer-events-none"><Icon name="box" size={18} /><span>{$t('chrome.selection.count', { count: $selectedElementIds.size })}</span></span>
        <div class="op-divider-v"></div>
        {@render action('align', 'chrome.selection.align', () => togglePopover('sel-align'), { expanded: $popover === 'sel-align', disabled: alignable.length < 2 })}
        {@render action('group', grouped ? 'chrome.selection.ungroup' : 'chrome.selection.group', () => run(grouped ? 'ungroup' : 'group', null))}
        {@render action('duplicate', 'chrome.selection.duplicate', duplicate)}
        {@render action('lock', 'chrome.selection.lock', () => toggleSelectionLock($selectedElementIds))}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
      {:else}
        {@render action('duplicate', 'chrome.selection.duplicate', duplicate)}
        {@render action('sliders', 'chrome.selection.details', showDetails, { active: $inspectorOpen })}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
      {/if}
    </div>

    <!-- Popovers hang off the bar, on the side away from the selection. -->
    {#if $popover?.startsWith('sel-')}
      <div class="absolute {popAlignRight ? 'right-0' : 'left-0'} {popBelow ? 'top-full mt-2' : 'bottom-full mb-2'} z-50 op-scroll" style="max-height:{popMaxHeight}px">
        <div bind:clientHeight={popHeight} bind:clientWidth={popWidth}>
        {#if $popover === 'sel-length' && wall}
          <Keypad title={$t('chrome.selection.wallLength')} valueCm={wallLength(wall)} units={units} applyLabel={$t('chrome.apply')} onapply={applyWallLength} onclose={closePopover}>
            <div class="flex flex-col gap-1.5">
              <span class="op-label">{$t('chrome.selection.keepFixed')}</span>
              <div class="op-seg">
                <button aria-pressed={fixedEnd === 'start'} onclick={() => fixedEnd = 'start'}>{$t('chrome.selection.endA')}</button>
                <button aria-pressed={fixedEnd === 'end'} onclick={() => fixedEnd = 'end'}>{$t('chrome.selection.endB')}</button>
              </div>
            </div>
          </Keypad>
        {:else if $popover === 'sel-length' && (door || win)}
          <Keypad title={$t('chrome.selection.width')} valueCm={(door ?? win)!.width} units={units} applyLabel={$t('chrome.apply')} onapply={applyOpeningWidth} onclose={closePopover} />
        {:else if $popover === 'sel-constrain' && wall}
          <div class="op-popover op-enter op-menu w-72" role="menu">
            <div class="op-menu-title">{$t('chrome.constrain.thisWall')}</div>
            {@render menuItem('constrain', $t('constraintKinds.vertical'), () => toggleRule('vertical'), { check: wallRules.includes('vertical') })}
            {@render menuItem('constrain', $t('constraintKinds.horizontal'), () => toggleRule('horizontal'), { check: wallRules.includes('horizontal') })}
            {@render menuItem('lock', $t('chrome.constrain.fix'), () => toggleRule('fix'), { check: wallRules.includes('fix') })}
            <div class="op-divider"></div>
            <div class="op-menu-title">{$t('chrome.constrain.otherWall')}</div>
            {@render menuItem('constrain', $t('chrome.constrain.parallel'), () => pickSecondWall('parallel'))}
            {@render menuItem('constrain', $t('chrome.constrain.perpendicular'), () => pickSecondWall('perpendicular'))}
          </div>
        {:else if $popover === 'sel-type' && (door || win)}
          <div class="op-popover op-enter op-menu w-64 op-scroll max-h-[50vh]" role="menu">
            {#if door}
              {#each DOOR_TYPES as type}
                {@render menuItem('doorSwing', $t(DOOR_LABEL[type]), () => { updateDoor(door.id, { type }); closePopover(); }, { check: door.type === type })}
              {/each}
            {:else if win}
              {#each WINDOW_TYPES as type}
                {@render menuItem('windowPane', $t(WINDOW_LABEL[type]), () => { updateWindow(win.id, { type }); closePopover(); }, { check: win.type === type })}
              {/each}
            {/if}
          </div>
        {:else if $popover === 'sel-align'}
          <div class="op-popover op-enter p-2 grid grid-cols-4 gap-1 w-[17rem]" role="menu">
            {#each ALIGN as item}
              <button class="op-btn is-square !w-auto !h-14 flex-col !gap-1 text-[11px] font-medium" title={$t(item.label)} aria-label={$t(item.label)}
                disabled={item.op.startsWith('distribute') ? alignable.length < 3 : alignable.length < 2}
                onclick={() => { alignElements($selectedElementIds, item.op); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={item.icon} /></svg>
              </button>
            {/each}
          </div>
        {:else if $popover === 'sel-more'}
          <div class="op-popover op-enter op-menu w-72" role="menu">
            {#if wall}
              {@render menuItem('floors', $t('chrome.selection.elevation'), () => { closePopover(); elevationWallId.set(wall.id); })}
              {@render menuItem('flip', $t('chrome.selection.reverse'), () => { reverseWall(wall.id); closePopover(); })}
              {@render menuItem('copy', $t('chrome.selection.copy'), () => { $planViewApi?.copySelection(); closePopover(); })}
              {@render menuItem('sliders', $t('chrome.selection.details'), showDetails)}
            {:else if door || win}
              {@render menuItem('floors', $t('chrome.selection.elevation'), () => { closePopover(); elevationWallId.set((door ?? win)!.wallId); })}
              {@render menuItem('copy', $t('chrome.selection.copy'), () => { $planViewApi?.copySelection(); closePopover(); })}
              {@render menuItem('sliders', $t('chrome.selection.details'), showDetails)}
            {:else if furniture}
              {@render menuItem('duplicate', $t('chrome.selection.duplicate'), () => { duplicate(); closePopover(); })}
              {@render menuItem('copy', $t('chrome.selection.copy'), () => { $planViewApi?.copySelection(); closePopover(); })}
              {@render menuItem('upload', $t('contextMenu.bringToFront'), () => run('bring-to-front'))}
              {@render menuItem('download', $t('contextMenu.sendToBack'), () => run('send-to-back'))}
              {@render menuItem('details', $t('chrome.selection.itemDetails'), showDetails, { sub: $t('chrome.selection.itemDetailsHint') })}
            {:else if room}
              {@render menuItem('pencil', $t('chrome.selection.rename'), () => { closePopover(); $planViewApi?.renameRoom(room.id); })}
              {@render menuItem('tag', $t('contextMenu.resetLabel'), () => run('reset-room-label', room.id))}
            {/if}
            <div class="op-divider"></div>
            {@render menuItem('trash', room ? $t('contextMenu.deleteRoom') : $t('chrome.delete'), deleteSelection, { danger: true })}
          </div>
        {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}
