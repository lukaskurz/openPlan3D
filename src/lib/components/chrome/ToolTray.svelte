<script lang="ts">
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import {
    activeFloor, selectedTool, placingDoorType, placingWindowType, placingFurnitureId, placingRotation,
    placingStair, placingColumn, placingColumnShape, constraintPickMode, removeMeasurement, beginUndoGroup, endUndoGroup,
    activateMeasurementTool,
  } from '$lib/stores/project';
  import type { Door, Window as Win } from '$lib/models/types';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { planViewApi, wallDraft, selectMode, canvasHint } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, catalogOpen, floorView } from '$lib/stores/chrome';
  import { furnitureName } from '$lib/i18n/furnitureNames';
  import { roomPresetLabels, roomTemplateLabels } from '$lib/i18n/roomLabels';
  import { roomPresets } from '$lib/utils/roomPresets';
  import { roomTemplates } from '$lib/utils/roomTemplates';
  import { toolGroup, finishTool, chooseGroup, placeColumn, placeStairs } from './tools';
  import { placeRoomShape, traceImage } from './actions';
  import Keypad from './Keypad.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  const DOOR_TYPES: { type: Door['type']; width: number }[] = [
    { type: 'single', width: 90 }, { type: 'double', width: 150 }, { type: 'sliding', width: 180 }, { type: 'french', width: 150 },
    { type: 'balcony', width: 90 }, { type: 'pocket', width: 90 }, { type: 'bifold', width: 180 }, { type: 'garage', width: 240 },
  ];
  const WINDOW_TYPES: { type: Win['type']; width: number }[] = [
    { type: 'standard', width: 120 }, { type: 'fixed', width: 100 }, { type: 'casement', width: 80 }, { type: 'sliding', width: 180 }, { type: 'bay', width: 200 },
  ];
  const DOOR_LABEL: Record<Door['type'], TranslationKey> = { single: 'openingCatalog.single', double: 'openingCatalog.double', sliding: 'openingCatalog.sliding', french: 'openingCatalog.french', balcony: 'openingCatalog.balcony', pocket: 'openingCatalog.pocket', bifold: 'openingCatalog.bifold', opening: 'openingCatalog.doorway', garage: 'openingCatalog.garage' };
  const WINDOW_LABEL: Record<Win['type'], TranslationKey> = { standard: 'openingCatalog.standard', fixed: 'openingCatalog.fixed', casement: 'openingCatalog.casement', sliding: 'openingCatalog.sliding', bay: 'openingCatalog.bay' };

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

  let pickHint = $derived<TranslationKey | null>($constraintPickMode
    ? ($constraintPickMode === 'fix' ? 'chrome.hint.pickFix' : $constraintPickMode === 'parallel' || $constraintPickMode === 'perpendicular' ? 'chrome.hint.pickPair' : 'chrome.hint.pickWall')
    : null);
</script>

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

{#snippet done(label: TranslationKey = 'chrome.done')}
  <button class="op-btn is-primary" onclick={finishTool} data-tray-done>{$t(label)}</button>
{/snippet}

{#snippet hint(key: TranslationKey | string, vars: Record<string, string | number> = {})}
  <span class="text-sm px-2 whitespace-nowrap {variants.length ? 'max-xl:hidden' : 'max-md:hidden'}" style="color:var(--color-text-muted)">{$t(key as TranslationKey, vars)}</span>
{/snippet}

{#if pickHint}
  <div class="op-float op-enter flex items-center gap-2 p-1.5 pl-2 max-w-full" data-tool-tray>
    <span class="w-2 h-2 rounded-full ml-2" style="background:var(--color-constraint)"></span>
    <span class="text-sm px-1" style="color:var(--color-text-secondary)">{$t(pickHint)}</span>
    <button class="op-btn is-outline" onclick={() => constraintPickMode.set(null)}>{$t('chrome.cancel')}</button>
  </div>
{:else if $toolGroup === 'wall'}
  <div class="flex flex-col items-center gap-2 max-w-full">
    <div class="op-float op-enter flex items-center gap-2 p-1.5 max-w-full overflow-x-auto" data-tool-tray>
      {@render options()}
      {#if !draft}
        {@render hint('chrome.hint.firstCorner')}
      {:else}
        <div class="relative">
          <button class="op-btn is-outline font-normal {$popover === 'wall-length' ? 'is-active' : ''}" aria-expanded={$popover === 'wall-length'} onclick={() => togglePopover('wall-length')} data-wall-length>
            {$t('chrome.wall.length')} <b class="tabular-nums" style="color:var(--color-text-strong)">{len(draft.lengthCm)}</b>
          </button>
          {#if $popover === 'wall-length'}
            <div class="absolute left-0 top-full mt-2 z-50">
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
          {/if}
        </div>
        <div class="op-btn is-outline font-normal pointer-events-none">{$t('chrome.wall.angle')} <b class="tabular-nums" style="color:var(--color-text-strong)">{angleText}</b></div>
        <div class="op-divider-v"></div>
        <button class="op-btn is-outline {draft.nearFirst ? 'is-active' : ''}" disabled={!canClose} onclick={() => $planViewApi?.closeWallLoop()} data-close-loop>{$t('chrome.wall.closeLoop')}</button>
      {/if}
      {@render done()}
    </div>
    {#if $popover === 'room-shapes'}
      <div class="op-popover op-enter p-3 w-[min(40rem,calc(100vw-2rem))]" data-room-shapes>
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
    {/if}
  </div>
{:else if $toolGroup === 'openings'}
  {@const isWindow = $selectedTool === 'window'}
  {@const isOpening = !isWindow && $placingDoorType === 'opening'}
  <div class="op-float op-enter flex items-center gap-2 p-1.5 max-w-full" data-tool-tray>
    {@render options()}
    {@render hint(isWindow ? 'chrome.hint.placeWindow' : isOpening ? 'chrome.hint.placeOpening' : 'chrome.hint.placeDoor')}
    {#if !isOpening}
      <div class="op-divider-v !mx-0"></div>
      <div class="op-seg overflow-x-auto min-w-0">
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
    {@render done()}
  </div>
{:else if $toolGroup === 'structure'}
  <div class="op-float op-enter flex items-center gap-2 p-1.5 max-w-full" data-tool-tray>
    {@render options()}
    {@render hint($placingStair ? 'chrome.hint.placeStairs' : 'chrome.hint.placeColumn')}
    {@render done()}
  </div>
{:else if $toolGroup === 'annotate'}
  <div class="op-float op-enter flex items-center gap-2 p-1.5 max-w-full" data-tool-tray>
    {@render options()}
    {#if $selectedTool === 'measure'}
      {@render hint('chrome.hint.measure')}
      <button class="op-btn is-outline" disabled={!measurementCount} onclick={clearMeasurements}>{$t('chrome.annotate.clear', { count: measurementCount })}</button>
    {:else if $selectedTool === 'annotate'}
      {@render hint($canvasHint ?? 'dimensionHints.start')}
    {:else}
      {@render hint('chrome.hint.text')}
    {/if}
    {@render done()}
  </div>
{:else if $toolGroup === 'furniture' && $placingFurnitureId && !$catalogOpen}
  <div class="op-float op-enter flex items-center gap-2 p-1.5 pl-2 max-w-full" data-tool-tray>
    {@render hint('chrome.hint.placeFurniture', { name: furnitureName($placingFurnitureId, $locale) })}
    <button class="op-btn is-outline" onclick={() => placingRotation.update(r => (r + 90) % 360)}><Icon name="rotate" size={18} />{$placingRotation}°</button>
    <button class="op-btn is-outline" onclick={() => catalogOpen.set(true)}><Icon name="sofa" size={18} />{$t('chrome.furniture.catalog')}</button>
    {@render done()}
  </div>
{:else if $toolGroup === 'select'}
  <!-- Plain tapping is Select itself; Box and Add switch on for a while and off again. -->
  <div class="op-float op-enter flex items-center gap-1.5 p-1.5 max-w-full" data-tool-tray>
    {#each [{ mode: 'box', icon: 'box' }, { mode: 'add', icon: 'plus' }] as const as option (option.mode)}
      {@const on = $selectMode === option.mode}
      <button class="op-btn" aria-pressed={on} title={$t(`chrome.hint.${option.mode}`)} data-variant={option.mode} onclick={() => selectMode.set(on ? 'tap' : option.mode)}>
        <Icon name={option.icon} size={18} />{$t(`chrome.select.${option.mode}`)}
      </button>
    {/each}
    {#if $selectMode !== 'tap'}{@render hint($selectMode === 'box' ? 'chrome.hint.box' : 'chrome.hint.add')}{/if}
  </div>
{/if}
