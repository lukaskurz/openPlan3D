<script lang="ts">
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import {
    activeFloor, selectedTool, placingDoorType, placingWindowType, placingFurnitureId, placingRotation,
    placingStair, placingColumn, placingColumnShape, removeMeasurement, beginUndoGroup, endUndoGroup,
    activateMeasurementTool,
  } from '$lib/stores/project';
  import type { Door, Window as Win } from '$lib/models/types';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { planViewApi, wallDraft, canvasHint } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, catalogOpen, floorView } from '$lib/stores/chrome';
  import { furnitureName } from '$lib/i18n/furnitureNames';
  import { roomPresetLabels, roomTemplateLabels } from '$lib/i18n/roomLabels';
  import { roomPresets } from '$lib/utils/roomPresets';
  import { roomTemplates } from '$lib/utils/roomTemplates';
  import { toolGroup, finishTool, chooseGroup, placeColumn, placeStairs, placeCeilingVariant, placeWallVariant, linkSwitchId, wallItemHeights, OUTLET_HEIGHTS } from './tools';
  import { CEILING_TOOL_ITEMS, ELECTRICAL_TOOL_ITEMS } from './tradeTools';
  import { defaultMountingHeight } from '$lib/utils/mounting';
  import { getCatalogItem } from '$lib/utils/furnitureCatalog';
  import { hintKey } from './hints';
  import { placeRoomShape, traceImage } from './actions';
  import Keypad from './Keypad.svelte';
  import Icon, { type IconName } from './Icon.svelte';
  import PipeToolTray from './PipeToolTray.svelte';

  const DOOR_TYPES: { type: Door['type']; width: number }[] = [
    { type: 'single', width: 90 }, { type: 'double', width: 150 }, { type: 'sliding', width: 180 }, { type: 'french', width: 150 },
    { type: 'balcony', width: 90 }, { type: 'pocket', width: 90 }, { type: 'bifold', width: 180 }, { type: 'garage', width: 240 },
  ];
  const WINDOW_TYPES: { type: Win['type']; width: number }[] = [
    { type: 'standard', width: 120 }, { type: 'fixed', width: 100 }, { type: 'casement', width: 80 }, { type: 'sliding', width: 180 }, { type: 'bay', width: 200 },
  ];
  const DOOR_LABEL: Record<Door['type'], TranslationKey> = { single: 'openingCatalog.single', double: 'openingCatalog.double', sliding: 'openingCatalog.sliding', french: 'openingCatalog.french', balcony: 'openingCatalog.balcony', pocket: 'openingCatalog.pocket', bifold: 'openingCatalog.bifold', opening: 'openingCatalog.doorway', garage: 'openingCatalog.garage' };
  const WINDOW_LABEL: Record<Win['type'], TranslationKey> = { standard: 'openingCatalog.standard', fixed: 'openingCatalog.fixed', casement: 'openingCatalog.casement', sliding: 'openingCatalog.sliding', bay: 'openingCatalog.bay' };

  /** How each ceiling tool's variants show in its options. */
  const CEILING_VARIANT: Record<string, { icon: IconName; label: TranslationKey }> = {
    ceiling_light: { icon: 'bulb', label: 'chrome.light.ceiling' },
    recessed_light: { icon: 'recessed', label: 'chrome.light.recessed' },
    pendant_light: { icon: 'hang', label: 'chrome.light.pendant' },
    chandelier: { icon: 'sparkles', label: 'chrome.light.chandelier' },
    ceiling_fan: { icon: 'fan', label: 'chrome.ceilingItem.model' },
    sym_ceiling_fan: { icon: 'columnRound', label: 'chrome.ceilingItem.symbol' },
    smoke_detector: { icon: 'smoke', label: 'chrome.ceilingItem.model' },
    sym_smoke: { icon: 'columnRound', label: 'chrome.ceilingItem.symbol' },
  };

  /** How the Electrical wall tools' variants show in their options. */
  const WALL_VARIANT: Record<string, { icon: IconName; label: TranslationKey }> = {
    sym_outlet: { icon: 'outlet', label: 'chrome.outlet.single' },
    sym_outlet_double: { icon: 'outletDouble', label: 'chrome.outlet.double' },
    sym_switch: { icon: 'switch', label: 'chrome.tool.switch' },
    wall_sconce: { icon: 'sconce', label: 'chrome.wallLight.indoor' },
    wall_sconce_outdoor: { icon: 'sun', label: 'chrome.wallLight.outdoor' },
  };
  let isWallTool = $derived($toolGroup === 'outlet' || $toolGroup === 'switch' || $toolGroup === 'wallLight');
  /** The Outlet tool's mounting height: the one picked, else the armed item's catalog height. */
  let outletHeight = $derived($wallItemHeights.outlet ?? ($placingFurnitureId ? defaultMountingHeight(getCatalogItem($placingFurnitureId) ?? {}) : undefined) ?? 30);
  /** The switch the Link tool links from, on the floor shown. */
  let linkSwitch = $derived($linkSwitchId ? $activeFloor?.furniture.find(item => item.id === $linkSwitchId) : undefined);
  let linkCount = $derived(linkSwitch ? $activeFloor?.switchLinks?.find(link => link.switchId === linkSwitch!.id)?.targetIds.length ?? 0 : 0);

  /** Mount of the armed catalog item: wall items are placed on a wall, ceiling items anywhere. */
  let placingMount = $derived($placingFurnitureId ? getCatalogItem($placingFurnitureId)?.mount ?? 'floor' : 'floor');
  let placeHint = $derived<TranslationKey>(placingMount === 'wall' ? 'chrome.hint.placeOnWall' : placingMount === 'ceiling' ? 'chrome.hint.placeCeiling' : 'chrome.hint.placeFurniture');

  interface Variant { id: string; icon: IconName; label: TranslationKey; active: boolean; pick: () => void }

  /** The current tool's kinds, shown first in its tray. */
  let variants = $derived.by((): Variant[] => {
    switch ($toolGroup) {
      case 'wall':
        return [
          { id: 'straight', icon: 'straight', label: 'chrome.wall.straight', active: $popover !== 'room-shapes', pick: () => { if ($popover === 'room-shapes') togglePopover('room-shapes'); } },
          { id: 'shape', icon: 'roomShape', label: 'chrome.wall.shape', active: $popover === 'room-shapes', pick: () => togglePopover('room-shapes') },
          { id: 'trace', icon: 'image', label: 'chrome.wall.trace', active: false, pick: () => traceImage() },
        ];
      case 'openings': {
        const kind = $selectedTool === 'window' ? 'window' : $placingDoorType === 'opening' ? 'opening' : 'door';
        return [
          { id: 'door', icon: 'doorSwing', label: 'chrome.openings.door', active: kind === 'door', pick: () => { if ($placingDoorType === 'opening') placingDoorType.set('single'); selectedTool.set('door'); } },
          { id: 'window', icon: 'windowPane', label: 'chrome.openings.window', active: kind === 'window', pick: () => selectedTool.set('window') },
          { id: 'opening', icon: 'opening', label: 'chrome.openings.opening', active: kind === 'opening', pick: () => { placingDoorType.set('opening'); selectedTool.set('door'); } },
        ];
      }
      case 'structure':
        return [
          { id: 'stairs', icon: 'stairs', label: 'chrome.structure.stairs', active: $placingStair, pick: placeStairs },
          { id: 'round', icon: 'columnRound', label: 'chrome.structure.round', active: $placingColumn && $placingColumnShape === 'round', pick: () => placeColumn('round') },
          { id: 'square', icon: 'columnSquare', label: 'chrome.structure.square', active: $placingColumn && $placingColumnShape === 'square', pick: () => placeColumn('square') },
        ];
      case 'light':
      case 'fan':
      case 'smoke': {
        const group = $toolGroup;
        return CEILING_TOOL_ITEMS[group].map(id => ({
          id, icon: CEILING_VARIANT[id].icon, label: CEILING_VARIANT[id].label,
          active: $placingFurnitureId === id, pick: () => placeCeilingVariant(group, id),
        }));
      }
      case 'outlet':
      case 'switch':
      case 'wallLight': {
        const group = $toolGroup;
        const ids: readonly string[] = ELECTRICAL_TOOL_ITEMS[group];
        return ids.length < 2 ? [] : ids.map(id => ({
          id, icon: WALL_VARIANT[id].icon, label: WALL_VARIANT[id].label,
          active: $placingFurnitureId === id, pick: () => placeWallVariant(group, id),
        }));
      }
      case 'annotate':
        return [
          { id: 'measure', icon: 'measure', label: 'chrome.annotate.measure', active: $selectedTool === 'measure', pick: () => activateMeasurementTool('measure') },
          { id: 'dimension', icon: 'dimension', label: 'chrome.annotate.dimension', active: $selectedTool === 'annotate', pick: () => activateMeasurementTool('annotate') },
          { id: 'text', icon: 'text', label: 'chrome.annotate.text', active: $selectedTool === 'text', pick: () => selectedTool.set('text') },
        ];
      default:
        return [];
    }
  });

  let units = $derived($projectSettings.units);
  const len = (cm: number) => formatLength(cm, units);

  let measurementCount = $derived($floorView?.measurements?.length ?? 0);
  function clearMeasurements() {
    const ids = ($floorView?.measurements ?? []).map(m => m.id);
    if (!ids.length) return;
    beginUndoGroup();
    for (const id of ids) removeMeasurement(id);
    endUndoGroup('Cleared measurements');
  }

  /** Preview outline for a room shape button. */
  function shapePath(presetId: string) {
    const preset = roomPresets.find(p => p.id === presetId);
    if (!preset) return '';
    const walls = preset.getWalls(300, 220);
    return walls.map((w, i) => `${i === 0 ? 'M' : 'L'}${w.start.x} ${w.start.y} L${w.end.x} ${w.end.y}`).join(' ');
  }

  let draft = $derived($wallDraft);
  let canClose = $derived(!!draft && draft.corners >= 2);
  let angleText = $derived(draft ? `${Math.round(draft.angleDeg) % 360}°` : '–');
  let keypadAngle = $state(0);
  $effect(() => { if ($popover === 'wall-length' && draft) keypadAngle = Math.round(draft.angleDeg) % 360; });

  function placeSegment(cm: number) {
    $planViewApi?.placeWallSegment(cm, keypadAngle);
    closePopover();
  }

  /** What the wall tool asks for next: the first corner, then the next one (or what it snapped to). */
  let wallHint = $derived<TranslationKey>(!draft ? 'chrome.hint.firstCorner'
    : draft.nearFirst ? 'chrome.hint.closeRoom'
    : draft.snappedTo ? (draft.snappedTo === 'corner' ? 'chrome.hint.snappedCorner' : 'chrome.hint.snappedWall')
    : 'chrome.hint.nextCorner');

  // The tray's popovers (segment keypad, room shapes) close when the plan is tapped.
  let root: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (($popover === 'wall-length' || $popover === 'room-shapes') && root && !root.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />


{#snippet options()}
  {#if variants.length}
    <div class="op-seg shrink-0" role="group" aria-label={$t('chrome.tools')} data-tool-options>
      {#each variants as variant (variant.id)}
        <button aria-pressed={variant.active} aria-label={$t(variant.label)} title={$t(variant.label)} data-variant={variant.id} onclick={variant.pick}>
          <Icon name={variant.icon} size={18} /><span class="max-md:hidden">{$t(variant.label)}</span>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet done()}
  <button class="op-btn is-primary shrink-0" onclick={finishTool} data-tray-done>{$t('chrome.done')}</button>
{/snippet}

<!-- The hint leads the tray and may wrap to two lines, so it never needs hiding on narrow screens. -->
{#snippet hint(key: TranslationKey | string, vars: Record<string, string | number> = {})}
  <span class="op-slot-hint" role="status" aria-live="polite" data-status-pill>{$t(hintKey(key), vars)}</span>
{/snippet}

<!-- The current tool's hint, options and Done, docked in the action slot. Its popovers open upward. -->
<div class="op-slot-stack" bind:this={root}>
  {#if $toolGroup === 'wall' && $popover === 'wall-length' && draft}
    <div class="op-slot-pop">
      <Keypad title={$t('chrome.wall.nextSegment')} subtitle={$t('chrome.wall.segment', { number: draft.corners })} valueCm={draft.lengthCm || 100} units={units} applyLabel={$t('chrome.wall.placeCorner')} onapply={placeSegment} onclose={closePopover}>
        <div class="flex gap-2">
          <label class="op-field flex-1">
            <span class="text-sm" style="color:var(--color-text-muted)">{$t('chrome.wall.angle')}</span>
            <input type="number" inputmode="numeric" class="text-right font-semibold" bind:value={keypadAngle} min="0" max="359" />
            <span class="op-unit">°</span>
          </label>
          <div class="op-seg">
            {#each [0, 90, 180, 270] as a}
              <button class="!px-2 !min-w-9" aria-pressed={keypadAngle === a} onclick={() => keypadAngle = a}>{a}°</button>
            {/each}
          </div>
        </div>
      </Keypad>
    </div>
  {:else if $toolGroup === 'wall' && $popover === 'room-shapes'}
    <div class="op-slot-pop">
      <div class="op-popover op-enter p-3 w-[min(40rem,calc(100vw-2*var(--chrome-inset)))]" data-room-shapes>
        <div class="op-menu-title !px-1 !pt-0">{$t('chrome.wall.shapesTitle')}</div>
        <div class="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
          {#each roomPresets as preset}
            <button class="flex flex-col items-center gap-1.5 p-2 rounded-lg min-h-[88px] hover:bg-[var(--color-surface-hover)]" style="border:1px solid var(--color-border)" onclick={() => { placeRoomShape(preset.id); closePopover(); chooseGroup('select'); }}>
              <svg viewBox="-20 -20 340 260" class="w-14 h-11" fill="none" stroke="currentColor" stroke-width="16" stroke-linejoin="round" style="color:var(--color-text-secondary)"><path d={shapePath(preset.id)} /></svg>
              <span class="text-xs font-medium text-center" style="color:var(--color-text-secondary)">{roomPresetLabels[preset.id] ? $t(roomPresetLabels[preset.id]) : preset.name}</span>
            </button>
          {/each}
        </div>
        <div class="op-menu-title !px-1">{$t('chrome.wall.furnishedTitle')}</div>
        <div class="grid grid-cols-4 max-sm:grid-cols-3 gap-2">
          {#each roomTemplates as tmpl}
            <button class="flex flex-col items-start gap-0.5 p-2.5 rounded-lg min-h-[56px] text-left hover:bg-[var(--color-surface-hover)]" style="border:1px solid var(--color-border)" onclick={() => { placeRoomShape(tmpl.presetId, tmpl.name); closePopover(); chooseGroup('select'); }}>
              <span class="text-sm font-semibold" style="color:var(--color-text-secondary)">{roomTemplateLabels[tmpl.name] ? $t(roomTemplateLabels[tmpl.name]) : tmpl.name}</span>
              <span class="text-xs" style="color:var(--color-text-muted)">{$t(tmpl.furniture.length === 1 ? 'roomChoices.item' : 'roomChoices.items', { count: tmpl.furniture.length })}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if $toolGroup === 'wall'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(wallHint)}
      {@render options()}
      {#if draft}
        <button class="op-btn is-outline font-normal shrink-0 {$popover === 'wall-length' ? 'is-active' : ''}" aria-expanded={$popover === 'wall-length'} onclick={() => togglePopover('wall-length')} data-wall-length>
          {$t('chrome.wall.length')} <b class="tabular-nums" style="color:var(--color-text-strong)">{len(draft.lengthCm)}</b>
        </button>
        <div class="op-btn is-outline font-normal pointer-events-none shrink-0">{$t('chrome.wall.angle')} <b class="tabular-nums" style="color:var(--color-text-strong)">{angleText}</b></div>
        <button class="op-btn is-outline shrink-0 {draft.nearFirst ? 'is-active' : ''}" disabled={!canClose} onclick={() => $planViewApi?.closeWallLoop()} data-close-loop>{$t('chrome.wall.closeLoop')}</button>
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'openings'}
    {@const isWindow = $selectedTool === 'window'}
    {@const isOpening = !isWindow && $placingDoorType === 'opening'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(isWindow ? 'chrome.hint.placeWindow' : isOpening ? 'chrome.hint.placeOpening' : 'chrome.hint.placeDoor')}
      {@render options()}
      {#if !isOpening}
        <div class="op-seg shrink-0">
          {#if isWindow}
            {#each WINDOW_TYPES as item}
              <button aria-pressed={$placingWindowType === item.type} onclick={() => placingWindowType.set(item.type)}>
                {$t(WINDOW_LABEL[item.type])} <span class="text-xs opacity-70 tabular-nums">{len(item.width)}</span>
              </button>
            {/each}
          {:else}
            {#each DOOR_TYPES as item}
              <button aria-pressed={$placingDoorType === item.type} onclick={() => placingDoorType.set(item.type)}>
                {$t(DOOR_LABEL[item.type])} <span class="text-xs opacity-70 tabular-nums">{len(item.width)}</span>
              </button>
            {/each}
          {/if}
        </div>
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'structure'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint($placingStair ? 'chrome.hint.placeStairs' : 'chrome.hint.placeColumn')}
      {@render options()}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'annotate'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {#if $selectedTool === 'measure'}
        {@render hint('chrome.hint.measure')}
      {:else if $selectedTool === 'annotate'}
        {@render hint($canvasHint ?? 'dimensionHints.start')}
      {:else}
        {@render hint('chrome.hint.text')}
      {/if}
      {@render options()}
      {#if $selectedTool === 'measure'}
        <button class="op-btn is-outline shrink-0" disabled={!measurementCount} onclick={clearMeasurements}>{$t('chrome.annotate.clear', { count: measurementCount })}</button>
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'ceilingHeight'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint('chrome.hint.ceilingHeight')}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if ($toolGroup === 'light' || $toolGroup === 'fan' || $toolGroup === 'smoke') && $placingFurnitureId}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(placeHint, { name: furnitureName($placingFurnitureId, $locale) })}
      {@render options()}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if isWallTool && $placingFurnitureId}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(placeHint, { name: furnitureName($placingFurnitureId, $locale) })}
      {@render options()}
      {#if $toolGroup === 'outlet'}
        <!-- Mounting height for the next outlets: skirting, desk or worktop height. -->
        <div class="op-seg shrink-0" role="group" aria-label={$t('chrome.selection.height')} data-outlet-height>
          {#each OUTLET_HEIGHTS as cm}
            <button aria-pressed={outletHeight === cm} onclick={() => wallItemHeights.update(heights => ({ ...heights, outlet: cm }))}><span class="tabular-nums">{len(cm)}</span></button>
          {/each}
        </div>
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'link'}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {#if linkSwitch}
        {@render hint(linkCount ? 'chrome.hint.linkTargetsCount' : 'chrome.hint.linkTargets', { name: furnitureName(linkSwitch.catalogId, $locale), count: linkCount })}
      {:else}
        {@render hint('chrome.hint.linkPickSwitch')}
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'pipe'}
    <PipeToolTray />
  {:else if ($toolGroup === 'fixture' || $toolGroup === 'drain') && $placingFurnitureId && !$catalogOpen}
    <!-- Plumbing: a fixture from the catalog, or a floor drain, placed like furniture. -->
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(placeHint, { name: furnitureName($placingFurnitureId, $locale) })}
      <button class="op-btn is-outline shrink-0" onclick={() => placingRotation.update(r => (r + 90) % 360)}><Icon name="rotate" size={18} />{$placingRotation}°</button>
      {#if $toolGroup === 'fixture'}
        <button class="op-btn is-outline shrink-0" onclick={() => catalogOpen.set(true)}><Icon name="fixture" size={18} />{$t('chrome.tool.fixture')}</button>
      {/if}
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {:else if $toolGroup === 'furniture' && $placingFurnitureId && !$catalogOpen}
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      {@render hint(placeHint, { name: furnitureName($placingFurnitureId, $locale) })}
      <button class="op-btn is-outline shrink-0" onclick={() => placingRotation.update(r => (r + 90) % 360)}><Icon name="rotate" size={18} />{$placingRotation}°</button>
      <button class="op-btn is-outline shrink-0" onclick={() => catalogOpen.set(true)}><Icon name="sofa" size={18} />{$t('chrome.furniture.catalog')}</button>
      <div class="op-divider-v"></div>
      {@render done()}
    </div>
  {/if}
</div>
