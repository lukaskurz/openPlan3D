<script lang="ts">
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import {
    activeFloor, currentProject, selectedElementId, selectedElementIds, selectedRoomId, selectedTool, detectedRoomsStore,
    constraintPickMode, elevationWallId, elevationPickMode, sideViewOpen, openSectionId, flipSection, removeElement, duplicateSelection, beginUndoGroup, endUndoGroup,
    resizeWallLength, reverseWall, updateDoor, updateWindow, updateFurniture, rotateFurniture, toggleFurnitureLock,
    toggleSelectionLock, addGeometricConstraint, removeConstraint, wallConstraint, showPlanNotice, findGroupForElement,
    setRoomCeilingHeight,
  } from '$lib/stores/project';
  import { activeSurface, activeTrade } from '$lib/stores/workContext';
  import { furnitureTrade } from '$lib/utils/furnitureCatalog';
  import { isSwitch, linksControlling } from '$lib/utils/switchLinks';
  import { startLinkTool } from './tools';
  import { switchSurface } from './surface';
  import { furnitureMount, furnitureDrop, effectiveElevation } from '$lib/utils/mounting';
  import { effectiveRoomCeiling, roomCeilingOverride } from '$lib/utils/ceilingHeights';
  import { formatCeilingHeight } from '$lib/utils/ceilingLabels';
  import type { Door, Window as Win } from '$lib/models/types';
  import { projectSettings, formatLength, formatArea } from '$lib/stores/settings';
  import { planViewApi, selectMode } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, inspectorOpen, floorView } from '$lib/stores/chrome';
  import { furnitureName, customModelName } from '$lib/i18n/furnitureNames';
  import { getFurnitureSize, getCatalogItem } from '$lib/utils/furnitureCatalog';
  import { alignElements, alignmentItems, type AlignmentOp } from '$lib/utils/alignment';
  import { wallLength } from '$lib/utils/wallEditing';
  import Keypad from './Keypad.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import PipeSelectionBar from './PipeSelectionBar.svelte';

  let floor = $derived($floorView);
  let id = $derived($selectedElementId);
  let multi = $derived($selectedElementIds.size >= 2);

  let wall = $derived(!multi && id ? floor?.walls.find(w => w.id === id) : undefined);
  let door = $derived(!multi && id ? floor?.doors.find(d => d.id === id) : undefined);
  let win = $derived(!multi && id ? floor?.windows.find(w => w.id === id) : undefined);
  let furniture = $derived(!multi && id ? floor?.furniture.find(f => f.id === id) : undefined);
  let pipe = $derived(!multi && id ? floor?.pipes?.find(p => p.id === id) : undefined);
  let room = $derived(!multi && !id && $selectedRoomId ? $detectedRoomsStore.find(r => r.id === $selectedRoomId) : undefined);
  let link = $derived(!multi && id ? floor?.switchLinks?.find(l => l.id === id) : undefined);
  /** A section cut (project-level, so not on the floor): resolved before 'other'. */
  let section = $derived(!multi && id ? $currentProject?.sections?.find(s => s.id === id) : undefined);
  let other = $derived(!multi && id && !wall && !door && !win && !furniture && !pipe && !link && !section);

  let kind = $derived(multi ? 'multi' : wall ? 'wall' : door ? 'door' : win ? 'window' : furniture ? 'furniture' : pipe ? 'pipe' : link ? 'link' : section ? 'section' : room ? 'room' : other ? 'other' : null);
  // Docked in the action slot, so it no longer follows the selection around the plan (selectionAnchor
  // stays for the canvas) and stays put while the plan is panned.
  let visible = $derived(!!kind && $selectedTool === 'select' && !$constraintPickMode && !$sideViewOpen);

  let units = $derived($projectSettings.units);
  const len = (cm: number) => formatLength(cm, units);

  // ── Ceiling surface (spec §3.8): rooms carry their ceiling height ──
  /** The selected room while the ceiling is shown, as saved on the floor when it is (that copy has the newest details). */
  let ceilingRoom = $derived($activeSurface === 'ceiling' && room && floor ? floor.rooms.find(r => r.id === room.id) ?? room : undefined);
  let roomCeiling = $derived(ceilingRoom && floor && $currentProject ? effectiveRoomCeiling($currentProject, floor, ceilingRoom) : 0);
  let roomOverride = $derived(ceilingRoom && floor ? roomCeilingOverride(floor, ceilingRoom.id) : undefined);
  /** What the room's ceiling falls back to without its own height (walls, storey). */
  let roomDefault = $derived(ceilingRoom && floor && $currentProject
    ? effectiveRoomCeiling($currentProject, { ...floor, roomCeilingHeights: undefined }, { ...ceilingRoom, details: undefined }) : 0);
  function applyCeiling(cm: number) {
    if (ceilingRoom) setRoomCeilingHeight(ceilingRoom.id, cm);
    closePopover();
  }

  // ── Mounted items: a ceiling item's drop, a wall item's mounting height ──
  let mount = $derived(furniture ? furnitureMount(furniture) : 'floor');
  let itemDrop = $derived(furniture && mount === 'ceiling' ? furnitureDrop(furniture) : 0);
  let itemHeight = $derived(furniture && mount === 'wall' ? effectiveElevation(furniture, 0) : 0);
  function openHeight() {
    if (furniture?.locked) { showDetails(); return; }
    togglePopover('sel-height');
  }
  function applyHeight(cm: number) {
    if (!furniture) return;
    updateFurniture(furniture.id, mount === 'ceiling' ? { drop: cm } : { elevation: cm });
    closePopover();
  }

  // ── Electrical: switch links and the Circuit action (spec §3.8, §4.5) ──
  /** Circuit is offered on electrical wall items, and on electrical ceiling items while working on Electrical. */
  let hasCircuit = $derived(!!furniture && furnitureTrade(furniture) === 'electrical' && (mount === 'wall' || (mount === 'ceiling' && $activeTrade === 'electrical')));
  /** A switch links its lights; anything else shows the switch that controls it, if one does. */
  function circuit() {
    if (!furniture || !floor) return;
    closePopover();
    if (isSwitch(furniture)) { startLinkTool(furniture.id); return; }
    const controlling = linksControlling(floor.switchLinks, furniture.id)[0];
    if (!controlling) {
      showPlanNotice($t('chrome.notice.notLinked', { name: furnitureLabel }));
      return;
    }
    // Switches hang on walls, so they are edited on the floor surface.
    switchSurface('floor');
    selectedRoomId.set(null);
    selectedElementIds.set(new Set());
    selectedElementId.set(controlling.switchId);
  }
  let linkTargets = $derived(link && floor ? link.targetIds.map(target => floor.furniture.find(item => item.id === target)).filter(item => !!item) : []);
  let linkLabel = $derived.by(() => {
    const count = linkTargets.length;
    const lights = linkTargets.every(item => getCatalogItem(item!.catalogId)?.category.includes('Lighting') || /light|lamp|sconce|chandelier|pendant/.test(item!.catalogId));
    return $t(lights ? (count === 1 ? 'chrome.selection.linkLightsOne' : 'chrome.selection.linkLightsMany') : (count === 1 ? 'chrome.selection.linkItemsOne' : 'chrome.selection.linkItemsMany'), { count });
  });

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

  /** Open the wall face-on in the elevation view. */
  function openElevation(wallId: string) {
    closePopover();
    elevationPickMode.set(false);
    elevationWallId.set(wallId);
  }

  // Furniture size: one side at a time on the keypad.
  let sizeAxis = $state<'width' | 'depth'>('width');
  function applyFurnitureSize(cm: number) {
    if (!furniture) return;
    const axis = sizeAxis === 'width' ? 'x' : 'y';
    const scale = furniture.scale;
    updateFurniture(furniture.id, { [sizeAxis]: cm, scale: { ...scale, [axis]: Math.sign(scale[axis]) || 1 } });
    closePopover();
  }
  function openSize() {
    if (furniture?.locked) { showDetails(); return; }
    togglePopover('sel-size');
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

<svelte:window onpointerdown={onWindowPointerDown} />

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

<!-- The dimension chip: what is selected and its main measure; tapping it opens numeric entry. -->
{#snippet chip(icon: IconName, name: string, value: string, onclick: (() => void) | null, opts: { expanded?: boolean; title?: string } = {})}
  {#if onclick}
    <button class="op-value-chip" aria-expanded={opts.expanded} onclick={onclick} title={opts.title ?? name} data-value-chip>
      <Icon name={icon} size={18} />{#if name}<span class="op-chip-name">{name}</span>{/if}{#if name && value}<span aria-hidden="true">·</span>{/if}{#if value}<span class="op-chip-value">{value}</span>{/if}
    </button>
  {:else}
    <span class="op-value-chip pointer-events-none" data-value-chip>
      <Icon name={icon} size={18} /><span class="op-chip-value">{value}</span>
    </span>
  {/if}
{/snippet}

{#if visible && kind === 'pipe' && pipe}
  <PipeSelectionBar {pipe} />
{:else if visible}
  <div class="op-slot-stack" data-selection-bar={kind}>
    <!-- Popovers open upward from the docked bar. -->
    {#if $popover?.startsWith('sel-')}
      <div class="op-slot-pop">
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
        {:else if $popover === 'sel-size' && furniture && furnitureSize}
          {#key sizeAxis}
            <Keypad title={$t('chrome.selection.size')} subtitle={furnitureLabel} valueCm={furnitureSize[sizeAxis]} units={units} applyLabel={$t('chrome.apply')} onapply={applyFurnitureSize} onclose={closePopover}>
              <div class="op-seg">
                <button aria-pressed={sizeAxis === 'width'} onclick={() => sizeAxis = 'width'}>{$t('chrome.selection.width')} <span class="text-xs opacity-70 tabular-nums">{len(furnitureSize.width)}</span></button>
                <button aria-pressed={sizeAxis === 'depth'} onclick={() => sizeAxis = 'depth'}>{$t('furnitureProperties.depth')} <span class="text-xs opacity-70 tabular-nums">{len(furnitureSize.depth)}</span></button>
              </div>
            </Keypad>
          {/key}
        {:else if $popover === 'sel-ceiling' && ceilingRoom}
          {#key ceilingRoom.id}
            <Keypad title={$t('chrome.selection.ceilingHeight')} subtitle={$t('chrome.selection.ceilingDefault', { length: formatCeilingHeight(roomDefault, units) })} valueCm={roomCeiling} units={units} applyLabel={$t('chrome.apply')} onapply={applyCeiling} onclose={closePopover} />
          {/key}
        {:else if $popover === 'sel-height' && furniture && mount !== 'floor'}
          {#key furniture.id}
            <Keypad title={$t(mount === 'ceiling' ? 'furnitureProperties.drop' : 'furnitureProperties.mountingHeight')} subtitle={furnitureLabel} valueCm={mount === 'ceiling' ? itemDrop : itemHeight} units={units} allowZero smallUnit applyLabel={$t('chrome.apply')} onapply={applyHeight} onclose={closePopover} />
          {/key}
        {:else if $popover === 'sel-constrain' && wall}
          <div class="op-popover op-enter op-menu w-72 max-w-full" role="menu">
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
          <div class="op-popover op-enter op-menu w-64 max-w-full" role="menu">
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
          <div class="op-popover op-enter p-2 grid grid-cols-4 gap-1 w-[17rem] max-w-full" role="menu">
            {#each ALIGN as item}
              <button class="op-btn is-square !w-auto !h-14 flex-col !gap-1 text-[11px] font-medium" title={$t(item.label)} aria-label={$t(item.label)}
                disabled={item.op.startsWith('distribute') ? alignable.length < 3 : alignable.length < 2}
                onclick={() => { alignElements($selectedElementIds, item.op); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={item.icon} /></svg>
              </button>
            {/each}
          </div>
        {:else if $popover === 'sel-more'}
          <div class="op-popover op-enter op-menu w-72 max-w-full" role="menu">
            {#if wall}
              {@render menuItem('curved', $t('chrome.selection.curve'), () => run('toggle-curve'), { check: !!wall.curvePoint })}
              {@render menuItem('constrain', $t('chrome.selection.constrain'), () => togglePopover('sel-constrain'), { trailing: wallRules.length ? String(wallRules.length) : undefined })}
              {@render menuItem('duplicate', $t('chrome.selection.duplicate'), () => { duplicate(); closePopover(); })}
              {@render menuItem('flip', $t('chrome.selection.reverse'), () => { reverseWall(wall.id); closePopover(); })}
              {@render menuItem('copy', $t('chrome.selection.copy'), () => { $planViewApi?.copySelection(); closePopover(); })}
            {:else if door || win}
              {@render menuItem('floors', $t('chrome.selection.elevation'), () => openElevation((door ?? win)!.wallId))}
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
    {/if}

    <div class="op-float op-enter op-slot-bar op-sel-bar" role="toolbar" aria-label={$t('chrome.selection.label')}>
      {#if $selectMode !== 'tap'}
        <!-- Box / Add select stay on until turned off here. -->
        {@render action($selectMode === 'box' ? 'box' : 'plus', $selectMode === 'box' ? 'chrome.select.box' : 'chrome.select.add', () => selectMode.set('tap'), { active: true, data: 'select-mode' })}
        <div class="op-divider-v"></div>
      {/if}
      {#if kind === 'wall' && wall}
        {@render chip('ruler', $t('chrome.inspector.wall'), len(wallLength(wall)), () => togglePopover('sel-length'), { expanded: $popover === 'sel-length' })}
        <div class="op-divider-v"></div>
        {@render action('scissors', 'chrome.selection.split', () => run('split-wall'), { disabled: !!wall.curvePoint })}
        {@render action('floors', 'chrome.selection.elevationShort', () => openElevation(wall.id), { data: 'elevation' })}
        {@render action('palette', 'chrome.selection.look', showDetails, { active: $inspectorOpen })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' || $popover === 'sel-constrain', badge: wallRules.length })}
      {:else if (kind === 'door' && door) || (kind === 'window' && win)}
        {@const opening = (door ?? win)!}
        {@render chip('ruler', $t(door ? 'chrome.inspector.door' : 'chrome.inspector.window'), len(opening.width), () => togglePopover('sel-length'), { expanded: $popover === 'sel-length' })}
        <div class="op-divider-v"></div>
        {@render action(door ? 'doorSwing' : 'windowPane', 'chrome.selection.type', () => togglePopover('sel-type'), { expanded: $popover === 'sel-type' })}
        {#if door && door.type !== 'opening'}
          {@render action('flip', 'chrome.selection.otherEnd', () => updateDoor(door.id, { swingDirection: door.swingDirection === 'left' ? 'right' : 'left' }))}
          {@render action('rotate', 'chrome.selection.otherSide', () => updateDoor(door.id, { flipSide: !door.flipSide }))}
        {/if}
        {@render action('duplicate', 'chrome.selection.duplicate', duplicate)}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'furniture' && furniture && mount === 'ceiling'}
        <!-- A ceiling item: its drop from the ceiling (a pendant's cord). -->
        {@render chip('hang', furnitureLabel, $t('chrome.selection.dropValue', { length: len(itemDrop) }), openHeight, { expanded: $popover === 'sel-height' })}
        <div class="op-divider-v"></div>
        {@render action('hang', 'chrome.selection.hang', openHeight, { expanded: $popover === 'sel-height', disabled: furniture.locked, data: 'height' })}
        {#if hasCircuit}{@render action('link', 'chrome.selection.circuit', circuit, { data: 'circuit' })}{/if}
        {@render action('palette', 'chrome.selection.look', showDetails, { active: $inspectorOpen })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'furniture' && furniture && mount === 'wall'}
        <!-- A wall item: its mounting height, and for electrical items the switch circuit. -->
        {@render chip('ceilingHeight', furnitureLabel, len(itemHeight), openHeight, { expanded: $popover === 'sel-height' })}
        <div class="op-divider-v"></div>
        {@render action('ceilingHeight', 'chrome.selection.height', openHeight, { expanded: $popover === 'sel-height', disabled: furniture.locked, data: 'height' })}
        {#if hasCircuit}{@render action('link', 'chrome.selection.circuit', circuit, { data: 'circuit' })}{/if}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'furniture' && furniture}
        {@render chip('ruler', furnitureLabel, furnitureSize ? `${Math.round(furnitureSize.width)} × ${Math.round(furnitureSize.depth)}` : '', openSize, { expanded: $popover === 'sel-size' })}
        <div class="op-divider-v"></div>
        {@render action('rotate', 'chrome.selection.rotate', () => rotateFurniture(furniture.id, 90), { disabled: furniture.locked })}
        {@render action('flip', 'chrome.selection.flip', () => run('flip-horizontal'), { disabled: furniture.locked })}
        {@render action('palette', 'chrome.selection.look', showDetails, { active: $inspectorOpen })}
        {@render action(furniture.locked ? 'lock' : 'unlock', furniture.locked ? 'chrome.selection.locked' : 'chrome.selection.lock', () => toggleFurnitureLock(furniture.id), { active: furniture.locked })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'link' && link}
        <!-- A switch link: `Link · 3 lights`; tapping it goes back to linking from its switch. -->
        {@render chip('link', $t('chrome.selection.link'), linkLabel, () => startLinkTool(link.switchId))}
        <div class="op-divider-v"></div>
        {@render action('link', 'chrome.tool.link', () => startLinkTool(link.switchId), { data: 'edit-link' })}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
      {:else if kind === 'section' && section}
        <!-- A section marker (spec §3.8): `Section A–A`; Open shows it in the section viewer. -->
        {@const openSection = () => { closePopover(); elevationPickMode.set(false); openSectionId.set(section.id); }}
        {@render chip('section', '', $t('chrome.selection.sectionName', { code: section.code }), openSection, { title: $t('chrome.selection.openSection') })}
        <div class="op-divider-v"></div>
        {@render action('eye', 'chrome.selection.openSection', openSection, { data: 'open-section' })}
        {@render action('lookFlip', 'chrome.selection.lookOtherWay', () => flipSection(section.id), { data: 'flip-section' })}
        {@render action('trash', 'chrome.delete', deleteSelection, { danger: true })}
      {:else if kind === 'room' && ceilingRoom}
        <!-- The ceiling: a room is selected to set its ceiling height. -->
        {@render chip('ceilingHeight', ceilingRoom.name || $t('layers.unnamed'), $t('chrome.selection.ceilingValue', { length: formatCeilingHeight(roomCeiling, units) }), () => togglePopover('sel-ceiling'), { expanded: $popover === 'sel-ceiling' })}
        <div class="op-divider-v"></div>
        {@render action('ceilingHeight', 'chrome.selection.height', () => togglePopover('sel-ceiling'), { expanded: $popover === 'sel-ceiling', data: 'ceiling-height' })}
        {@render action('undo', 'chrome.selection.reset', () => { setRoomCeilingHeight(ceilingRoom.id, undefined); closePopover(); }, { disabled: roomOverride === undefined, data: 'ceiling-reset' })}
        {@render action('sliders', 'chrome.selection.details', showDetails, { active: $inspectorOpen })}
      {:else if kind === 'room' && room}
        {@render chip('tag', room.name || $t('layers.unnamed'), formatArea(room.area, units), () => { $planViewApi?.renameRoom(room.id); }, { title: $t('chrome.selection.rename') })}
        <div class="op-divider-v"></div>
        {@render action('palette', 'chrome.selection.finish', () => run('change-floor-texture', room.id))}
        {@render action('sliders', 'chrome.selection.details', showDetails, { active: $inspectorOpen })}
        {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' })}
      {:else if kind === 'multi'}
        {@render chip('box', '', $t('chrome.selection.count', { count: $selectedElementIds.size }), null)}
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
  </div>
{/if}
