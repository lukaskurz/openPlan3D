<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n';
  import { canvasZoom } from '$lib/stores/project';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { planViewApi } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import { cssPixelsPerInch, scaleDenominator, zoomForScale, roundScale, formatScale, NOMINAL_CSS_PPI } from '$lib/utils/screenScale';
  import Icon from './Icon.svelte';

  /** The plan's on-screen scale, 1 : N. `canvasZoom` is CSS px per cm (see utils/screenScale). */
  const PRESETS = [20, 50, 100, 200];

  let screenInfo = $state<{ ppi: number; exact: boolean }>({ ppi: NOMINAL_CSS_PPI, exact: false });
  onMount(() => {
    const measure = () => { screenInfo = cssPixelsPerInch(screen.width, screen.height, window.devicePixelRatio || 1); };
    measure();
    // A window dragged to another display changes the pixel ratio.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  let denominator = $derived(scaleDenominator($canvasZoom, screenInfo.ppi));
  let label = $derived(formatScale(denominator, screenInfo.exact));
  let open = $derived($popover === 'scale');

  /** Zoom about the view's centre so the plan shows at 1 : N. */
  function setScale(n: number) {
    const current = $canvasZoom;
    if (current > 0) $planViewApi?.zoomBy(zoomForScale(n, screenInfo.ppi) / current);
    closePopover();
  }
  function fit() {
    $planViewApi?.zoomToFit();
    closePopover();
  }

  let ref: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (open && ref && !ref.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative flex" bind:this={ref}>
  <button class="op-btn op-scale-btn" aria-expanded={open} aria-label={$t('chrome.scale.label', { scale: label })} title={$t('chrome.scale.label', { scale: label })}
    onclick={() => togglePopover('scale')} data-scale-control>
    <Icon name="ruler" size={18} /><span class="tabular-nums">{label}</span>
  </button>

  {#if open}
    <div class="op-popover op-enter op-menu op-corner-pop w-[17rem]" role="menu" aria-label={$t('chrome.scale.title')} data-scale-menu>
      <div class="op-menu-title">{$t('chrome.scale.title')}</div>
      <div class="px-3 pb-2 text-xs" style="color:var(--color-text-muted)">
        {#if $projectSettings.units === 'imperial'}
          {$t('chrome.scale.meaningImperial', { length: formatLength(roundScale(denominator) * 2.54, 'imperial') })}
        {:else}
          {$t('chrome.scale.meaning', { length: formatLength(roundScale(denominator), 'metric') })}
        {/if}
        {#if !screenInfo.exact}<br />{$t('chrome.scale.approximate')}{/if}
      </div>
      <div class="op-seg is-tall mx-1.5 mb-1" role="group" aria-label={$t('chrome.scale.presets')}>
        {#each PRESETS as n}
          <button class="tabular-nums" aria-pressed={roundScale(denominator) === n} onclick={() => setScale(n)} data-scale-preset={n}>1:{n}</button>
        {/each}
      </div>
      <div class="op-divider"></div>
      <button class="op-menu-item" role="menuitem" onclick={fit} data-scale-fit><Icon name="fit" size={18} />{$t('chrome.scale.fit')}</button>
    </div>
  {/if}
</div>
