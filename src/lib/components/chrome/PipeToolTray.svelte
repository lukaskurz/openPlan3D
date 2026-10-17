<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import type { PipeKind } from '$lib/models/types';
  import { activeSurface } from '$lib/stores/workContext';
  import { pipeToolOptions, pipeDraft, setPipeKind, setPipeOptions, finishPipeDraft, removeLastDraftPoint } from '$lib/stores/pipeTool';
  import { PIPE_COLORS, PIPE_DIAMETERS, PIPE_KINDS } from '$lib/utils/pipes';
  import { finishTool } from './tools';
  import { hintKey } from './hints';
  import Icon from './Icon.svelte';

  /**
   * The Pipe tool's options in the action slot (spec §3.8): kind, diameter, run
   * (floor or wall; the ceiling surface always draws ceiling runs) and Riser, then
   * Finish for the run being drawn and Done. The options stay for the next pipe.
   */
  const KIND_LABEL: Record<PipeKind, TranslationKey> = { cold: 'pipes.kind.cold', hot: 'pipes.kind.hot', waste: 'pipes.kind.waste' };

  let options = $derived($pipeToolOptions);
  let points = $derived($pipeDraft.length);
  let onCeiling = $derived($activeSurface === 'ceiling');
  let hint = $derived<TranslationKey>(options.riser ? 'pipes.hint.riser'
    : points === 0 ? 'pipes.hint.start'
    : points === 1 ? 'pipes.hint.next'
    : 'pipes.hint.finish');
</script>

<div class="op-float op-enter op-slot-bar" data-tool-tray data-pipe-tray>
  <span class="op-slot-hint" role="status" aria-live="polite" data-status-pill>{$t(hintKey(hint))}</span>
  <div class="op-seg shrink-0" role="group" aria-label={$t('pipes.kindLabel')}>
    {#each PIPE_KINDS as kind}
      <button aria-pressed={options.kind === kind} aria-label={$t(KIND_LABEL[kind])} title={$t(KIND_LABEL[kind])} onclick={() => setPipeKind(kind)} data-pipe-kind={kind}>
        <span class="pipe-swatch" style="background:{PIPE_COLORS[kind]}"></span><span class="max-md:hidden">{$t(KIND_LABEL[kind])}</span>
      </button>
    {/each}
  </div>
  <div class="op-seg shrink-0" role="group" aria-label={$t('pipes.diameter')}>
    {#each PIPE_DIAMETERS[options.kind] as mm}
      <button class="tabular-nums" aria-pressed={options.diameter === mm} onclick={() => setPipeOptions({ diameter: mm })} data-pipe-diameter={mm}>{mm}<span class="text-xs opacity-70"> mm</span></button>
    {/each}
  </div>
  {#if onCeiling}
    <span class="op-btn is-outline font-normal pointer-events-none shrink-0" data-pipe-run="ceiling"><Icon name="ceiling" size={18} />{$t('pipes.run.ceiling')}</span>
  {:else}
    <div class="op-seg shrink-0" role="group" aria-label={$t('pipes.runLabel')}>
      <button aria-pressed={options.floorRun === 'floor'} onclick={() => setPipeOptions({ floorRun: 'floor' })} data-pipe-run="floor"><Icon name="floor" size={18} /><span class="max-md:hidden">{$t('pipes.run.floor')}</span></button>
      <button aria-pressed={options.floorRun === 'wall'} onclick={() => setPipeOptions({ floorRun: 'wall' })} data-pipe-run="wall"><Icon name="wall" size={18} /><span class="max-md:hidden">{$t('pipes.run.wall')}</span></button>
    </div>
  {/if}
  <button class="op-btn is-outline shrink-0 {options.riser ? 'is-active' : ''}" aria-pressed={options.riser} onclick={() => { finishPipeDraft(); setPipeOptions({ riser: !options.riser }); }} data-pipe-riser>
    <Icon name="riser" size={18} />{$t('pipes.riser')}
  </button>
  {#if points}
    <button class="op-btn is-outline shrink-0" aria-label={$t('pipes.undoPoint')} title={$t('pipes.undoPoint')} onclick={removeLastDraftPoint} data-pipe-undo-point><Icon name="backspace" size={18} /></button>
  {/if}
  {#if points >= 2}
    <button class="op-btn is-outline shrink-0" onclick={() => finishPipeDraft()} data-pipe-finish>{$t('pipes.finish')}</button>
  {/if}
  <div class="op-divider-v"></div>
  <button class="op-btn is-primary shrink-0" onclick={finishTool} data-tray-done>{$t('chrome.done')}</button>
</div>

<style>
  .pipe-swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 999px;
    flex-shrink: 0;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.15);
  }
</style>
