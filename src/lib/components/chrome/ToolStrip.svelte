<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { selectedTool, placingDoorType, placingStair, placingColumn, placingColumnShape, activateMeasurementTool } from '$lib/stores/project';
  import { selectMode } from '$lib/stores/planView';
  import { popover, togglePopover } from '$lib/stores/chrome';
  import { toolGroup, chooseGroup, placeColumn, placeStairs, type ToolGroup } from './tools';
  import { traceImage } from './actions';
  import Icon, { type IconName } from './Icon.svelte';

  const TOOLS: { id: ToolGroup; icon: IconName; label: TranslationKey }[] = [
    { id: 'select', icon: 'select', label: 'chrome.tool.select' },
    { id: 'wall', icon: 'wall', label: 'chrome.tool.wall' },
    { id: 'openings', icon: 'door', label: 'chrome.tool.openings' },
    { id: 'structure', icon: 'stairs', label: 'chrome.tool.structure' },
    { id: 'annotate', icon: 'ruler', label: 'chrome.tool.annotate' },
    { id: 'furniture', icon: 'sofa', label: 'chrome.tool.furniture' },
  ];

  interface Variant { id: string; icon: IconName; label: TranslationKey; active: boolean; pick: () => void }

  let variants = $derived.by((): Variant[] => {
    switch ($toolGroup) {
      case 'select':
        return (['tap', 'box', 'add'] as const).map((mode) => ({
          id: mode, icon: mode === 'tap' ? 'select' : mode === 'box' ? 'box' : 'plus',
          label: `chrome.select.${mode}`, active: $selectMode === mode, pick: () => selectMode.set(mode),
        }));
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
</script>

<div class="op-float op-cluster max-w-full overflow-x-auto" role="toolbar" aria-label={$t('chrome.tools')} data-tool-strip>
  {#each TOOLS as tool (tool.id)}
    {@const active = $toolGroup === tool.id}
    <div class="flex items-center gap-0.5 shrink-0">
      <button
        class="op-btn {active ? 'is-active' : ''}"
        aria-label={$t(tool.label)}
        aria-pressed={active}
        title={$t(tool.label)}
        data-tool={tool.id}
        onclick={() => chooseGroup(tool.id)}
      >
        <Icon name={tool.icon} />
        {#if active}<span class="max-md:hidden">{$t(tool.label)}</span>{/if}
      </button>
      {#if active && variants.length}
        <div class="op-seg ml-0.5 mr-1" style="padding:0;gap:2px">
          {#each variants as variant (variant.id)}
            <button
              class="!h-11 !min-w-11"
              aria-pressed={variant.active}
              aria-label={$t(variant.label)}
              title={$t(variant.label)}
              data-variant={variant.id}
              onclick={variant.pick}
            >
              <Icon name={variant.icon} size={18} />
              {#if variant.active}<span class="max-lg:hidden">{$t(variant.label)}</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
