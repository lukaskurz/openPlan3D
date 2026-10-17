<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { removeElement, updatePipe, duplicateSelection, selectedElementId, selectedElementIds } from '$lib/stores/project';
  import type { Pipe, PipeKind } from '$lib/models/types';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { planViewApi } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import { PIPE_COLORS, PIPE_DIAMETERS, PIPE_KINDS, PIPE_RUN_ELEVATION, MAX_PIPE_DIAMETER, diameterForKind, pipeLength } from '$lib/utils/pipes';
  import Keypad from './Keypad.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  /**
   * The action slot for a selected pipe (spec §3.8): `Cold pipe · 20 mm · 4.20 m`, then
   * Kind, Diameter, Delete and More (riser, height, run, duplicate, copy).
   */
  let { pipe }: { pipe: Pipe } = $props();

  let units = $derived($projectSettings.units);
  const KIND_LABEL: Record<PipeKind, TranslationKey> = { cold: 'pipes.kind.cold', hot: 'pipes.kind.hot', waste: 'pipes.kind.waste' };
  const NAME: Record<PipeKind, TranslationKey> = { cold: 'pipes.name.cold', hot: 'pipes.name.hot', waste: 'pipes.name.waste' };
  const RISER_NAME: Record<PipeKind, TranslationKey> = { cold: 'pipes.riserName.cold', hot: 'pipes.riserName.hot', waste: 'pipes.riserName.waste' };

  let name = $derived($t(pipe.riser ? RISER_NAME[pipe.kind] : NAME[pipe.kind]));
  let value = $derived(pipe.riser ? `${pipe.diameter} mm` : `${pipe.diameter} mm · ${formatLength(pipeLength(pipe), units)}`);
  /** The height shown and edited: the pipe's own, or its run's default (ceiling runs hang under the ceiling). */
  let defaultElevation = $derived(pipe.run === 'ceiling' ? null : PIPE_RUN_ELEVATION[pipe.run]);

  let customDiameter = $state('');
  $effect(() => { customDiameter = String(pipe.diameter); });

  function setKind(kind: PipeKind) {
    updatePipe(pipe.id, { kind, diameter: diameterForKind(kind, pipe.diameter) });
  }
  function setDiameter(mm: number) {
    if (Number.isFinite(mm) && mm > 0 && mm <= MAX_PIPE_DIAMETER) updatePipe(pipe.id, { diameter: Math.round(mm * 10) / 10 });
  }
  function applyElevation(cm: number) {
    updatePipe(pipe.id, { elevation: cm });
    closePopover();
  }
  function resetElevation() {
    updatePipe(pipe.id, { elevation: undefined });
    closePopover();
  }
  function remove() {
    closePopover();
    removeElement(pipe.id);
    selectedElementId.set(null);
  }
  function duplicate() {
    closePopover();
    const ids = duplicateSelection(new Set([pipe.id]));
    if (ids.length) { selectedElementIds.set(new Set()); selectedElementId.set(ids[0]); }
  }
</script>

{#snippet action(icon: IconName, label: TranslationKey, onclick: () => void, opts: { active?: boolean; danger?: boolean; expanded?: boolean; data?: string } = {})}
  <button class="op-action {opts.active ? 'is-active' : ''} {opts.danger ? 'is-danger' : ''}" aria-expanded={opts.expanded} aria-pressed={opts.active} onclick={onclick} data-action={opts.data}>
    <Icon name={icon} size={20} />
    <span>{$t(label)}</span>
  </button>
{/snippet}

{#snippet menuItem(icon: IconName, label: string, onclick: () => void, opts: { danger?: boolean; check?: boolean; trailing?: string; swatch?: string } = {})}
  <button class="op-menu-item {opts.danger ? 'is-danger' : ''}" onclick={onclick} role="menuitem">
    {#if opts.swatch}<span class="pipe-swatch" style="background:{opts.swatch}"></span>{:else}<Icon name={icon} size={18} />{/if}
    <span class="flex-1 min-w-0">{label}</span>
    {#if opts.trailing}<span class="text-xs font-normal" style="color:var(--color-text-muted)">{opts.trailing}</span>{/if}
    {#if opts.check}<Icon name="check" size={18} />{/if}
  </button>
{/snippet}

<div class="op-slot-stack" data-selection-bar="pipe">
  {#if $popover === 'sel-pipe' || $popover === 'sel-pipe-kind' || $popover === 'sel-pipe-elevation' || $popover === 'sel-more'}
    <div class="op-slot-pop">
      {#if $popover === 'sel-pipe'}
        <div class="op-popover op-enter p-3 flex flex-col gap-3 w-[min(22rem,calc(100vw-2*var(--chrome-inset)))]" data-pipe-options>
          <div class="flex flex-col gap-1.5">
            <span class="op-label">{$t('pipes.kindLabel')}</span>
            <div class="op-seg">
              {#each PIPE_KINDS as kind}
                <button aria-pressed={pipe.kind === kind} onclick={() => setKind(kind)} data-pipe-kind={kind}><span class="pipe-swatch" style="background:{PIPE_COLORS[kind]}"></span>{$t(KIND_LABEL[kind])}</button>
              {/each}
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="op-label">{$t('pipes.diameter')}</span>
            <div class="flex gap-2 flex-wrap">
              <div class="op-seg">
                {#each PIPE_DIAMETERS[pipe.kind] as mm}
                  <button class="tabular-nums" aria-pressed={pipe.diameter === mm} onclick={() => setDiameter(mm)} data-pipe-diameter={mm}>{mm} mm</button>
                {/each}
              </div>
              <label class="op-field w-28">
                <input type="number" inputmode="decimal" min="1" max={MAX_PIPE_DIAMETER} class="text-right font-semibold" aria-label={$t('pipes.diameter')}
                  bind:value={customDiameter} onchange={() => setDiameter(Number(customDiameter))} />
                <span class="op-unit">mm</span>
              </label>
            </div>
          </div>
        </div>
      {:else if $popover === 'sel-pipe-kind'}
        <div class="op-popover op-enter op-menu w-64 max-w-full" role="menu">
          {#each PIPE_KINDS as kind}
            {@render menuItem('droplet', $t(KIND_LABEL[kind]), () => { setKind(kind); closePopover(); }, { check: pipe.kind === kind, swatch: PIPE_COLORS[kind] })}
          {/each}
        </div>
      {:else if $popover === 'sel-pipe-elevation'}
        {#key pipe.id}
          <Keypad title={$t('pipes.height')} subtitle={defaultElevation === null ? $t('pipes.heightCeilingDefault') : $t('pipes.heightDefault', { length: formatLength(defaultElevation, units) })}
            valueCm={Math.max(0, pipe.elevation ?? defaultElevation ?? 0)} units={units} allowZero smallUnit applyLabel={$t('chrome.apply')} onapply={applyElevation} onclose={closePopover}>
            <button class="op-btn is-outline" disabled={pipe.elevation === undefined} onclick={resetElevation} data-pipe-elevation-reset>{$t('pipes.heightReset')}</button>
          </Keypad>
        {/key}
      {:else if $popover === 'sel-more'}
        <div class="op-popover op-enter op-menu w-72 max-w-full" role="menu">
          {@render menuItem('riser', $t('pipes.riser'), () => { updatePipe(pipe.id, { riser: !pipe.riser }); closePopover(); }, { check: !!pipe.riser })}
          {@render menuItem('ceilingHeight', $t('pipes.height'), () => togglePopover('sel-pipe-elevation'), { trailing: pipe.elevation === undefined ? $t('pipes.heightAuto') : formatLength(pipe.elevation, units) })}
          {#if pipe.run !== 'ceiling'}
            {@render menuItem('floor', $t('pipes.run.floor'), () => { updatePipe(pipe.id, { run: 'floor' }); closePopover(); }, { check: pipe.run === 'floor' })}
            {@render menuItem('wall', $t('pipes.run.wall'), () => { updatePipe(pipe.id, { run: 'wall' }); closePopover(); }, { check: pipe.run === 'wall' })}
          {/if}
          <div class="op-divider"></div>
          {@render menuItem('duplicate', $t('chrome.selection.duplicate'), duplicate)}
          {@render menuItem('copy', $t('chrome.selection.copy'), () => { $planViewApi?.copySelection(); closePopover(); })}
          <div class="op-divider"></div>
          {@render menuItem('trash', $t('chrome.delete'), remove, { danger: true })}
        </div>
      {/if}
    </div>
  {/if}

  <div class="op-float op-enter op-slot-bar op-sel-bar" role="toolbar" aria-label={$t('chrome.selection.label')}>
    <button class="op-value-chip" aria-expanded={$popover === 'sel-pipe'} onclick={() => togglePopover('sel-pipe')} title={name} data-value-chip>
      <span class="pipe-swatch" style="background:{PIPE_COLORS[pipe.kind]}"></span><span class="op-chip-name">{name}</span><span aria-hidden="true">·</span><span class="op-chip-value">{value}</span>
    </button>
    <div class="op-divider-v"></div>
    {@render action('droplet', 'pipes.kindLabel', () => togglePopover('sel-pipe-kind'), { expanded: $popover === 'sel-pipe-kind', data: 'pipe-kind' })}
    {@render action('pipeRun', 'pipes.diameter', () => togglePopover('sel-pipe'), { expanded: $popover === 'sel-pipe', data: 'pipe-diameter' })}
    {@render action('trash', 'chrome.delete', remove, { danger: true, data: 'pipe-delete' })}
    {@render action('more', 'chrome.more', () => togglePopover('sel-more'), { expanded: $popover === 'sel-more' || $popover === 'sel-pipe-elevation' })}
  </div>
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
