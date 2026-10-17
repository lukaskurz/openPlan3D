<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { snapEnabled } from '$lib/stores/project';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { snapOptions } from '$lib/stores/planView';
  import { popover, togglePopover, closePopover, dialog } from '$lib/stores/chrome';
  import { themePreference, type ThemePreference } from '$lib/stores/theme';
  import { prefersTouch } from '$lib/utils/inputDevice';
  import Icon from './Icon.svelte';

  /** Quick settings next to the scale: snapping, theme, and the way into the full Settings dialog. */
  const GRID_SIZES = [1, 10, 25, 50];
  const ANGLES = [15, 45, 90] as const;
  const THEMES: { value: ThemePreference; label: TranslationKey }[] = [
    { value: 'light', label: 'settings.themeLight' },
    { value: 'dark', label: 'settings.themeDark' },
    { value: 'system', label: 'settings.themeSystem' },
  ];

  let open = $derived($popover === 'settings');
  // Holding ⌘ / Ctrl to place freely needs a keyboard, so touch screens don't mention it.
  let showBypass = $derived(open && !prefersTouch());

  function setGrid(size: number | 0) {
    if (!size) projectSettings.update(s => ({ ...s, snapToGrid: false }));
    else { snapEnabled.set(true); projectSettings.update(s => ({ ...s, snapToGrid: true, gridSize: size })); }
  }
  function setAngle(angle: 0 | 15 | 45 | 90) {
    if (angle) snapEnabled.set(true);
    snapOptions.update(o => ({ ...o, angleStep: angle }));
  }
  function openAllSettings() {
    closePopover();
    dialog.set('settings');
  }

  let ref: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (open && ref && !ref.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="relative flex" bind:this={ref}>
  <button class="op-btn is-square" aria-label={$t('chrome.settings.open')} title={$t('chrome.settings.open')} aria-expanded={open} onclick={() => togglePopover('settings')} data-settings-button>
    <Icon name="sliders" size={20} />
  </button>

  {#if open}
    <div class="op-popover op-enter op-corner-pop w-[22rem] p-4 flex flex-col gap-4" role="dialog" aria-label={$t('chrome.settings.open')} data-settings-popover>
      <div>
        <div class="text-sm font-semibold" style="color:var(--color-text-strong)">{$t('chrome.snap.title')}</div>
        <div class="text-xs" style="color:var(--color-text-muted)">{$t('chrome.snap.subtitle')}</div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-x-2 text-sm font-semibold" style="color:var(--color-text-secondary)"><Icon name="grid" size={18} /><span class="flex-1">{$t('chrome.snap.grid')}</span><span class="text-xs font-normal" style="color:var(--color-text-muted)">{$t('chrome.snap.gridHint')}</span></div>
        <div class="op-seg is-tall">
          <button aria-pressed={!$projectSettings.snapToGrid} onclick={() => setGrid(0)}>{$t('toolbarView.off')}</button>
          {#each GRID_SIZES as size}
            <button aria-pressed={$projectSettings.snapToGrid && $projectSettings.gridSize === size} onclick={() => setGrid(size)}>{formatLength(size, $projectSettings.units)}</button>
          {/each}
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-x-2 text-sm font-semibold" style="color:var(--color-text-secondary)"><Icon name="angle" size={18} /><span class="flex-1">{$t('chrome.snap.angles')}</span><span class="text-xs font-normal" style="color:var(--color-text-muted)">{$t('chrome.snap.anglesHint')}</span></div>
        <div class="op-seg is-tall">
          <button aria-pressed={$snapOptions.angleStep === 0} onclick={() => setAngle(0)}>{$t('toolbarView.off')}</button>
          {#each ANGLES as angle}
            <button aria-pressed={$snapOptions.angleStep === angle} onclick={() => setAngle(angle)}>{angle}°</button>
          {/each}
        </div>
      </div>
      <div class="flex flex-col">
        <div class="flex items-center gap-2 text-sm font-semibold mb-1" style="color:var(--color-text-secondary)"><Icon name="magnet" size={18} /><span class="flex-1">{$t('chrome.snap.objects')}</span></div>
        <div class="op-menu-row !px-0">
          <span class="flex-1">{$t('chrome.snap.corners')}</span>
          <button class="op-switch" role="switch" aria-checked={$snapOptions.objects} aria-label={$t('chrome.snap.corners')} onclick={() => snapOptions.update(o => ({ ...o, objects: !o.objects }))}></button>
        </div>
        <div class="op-menu-row !px-0">
          <span class="flex-1">{$t('chrome.snap.furniture')}</span>
          <button class="op-switch" role="switch" aria-checked={$projectSettings.snapToWalls} aria-label={$t('chrome.snap.furniture')} onclick={() => projectSettings.update(s => ({ ...s, snapToWalls: !s.snapToWalls }))}></button>
        </div>
      </div>
      {#if showBypass}
        <div class="flex items-start gap-2.5 p-3 rounded-lg text-xs leading-snug" style="background:var(--color-surface-subtle);color:var(--color-text-tertiary)">
          <Icon name="pan" size={18} class="shrink-0" />
          <span>{$t('chrome.snap.bypass')}</span>
        </div>
      {/if}

      <div class="op-divider !mx-0 !my-0"></div>
      <div class="flex flex-col gap-2">
        <div class="text-sm font-semibold" style="color:var(--color-text-strong)">{$t('settings.theme')}</div>
        <div class="op-seg is-tall" role="group" aria-label={$t('settings.theme')} data-theme-toggle>
          {#each THEMES as theme}
            <button aria-pressed={$themePreference === theme.value} onclick={() => themePreference.set(theme.value)}>{$t(theme.label)}</button>
          {/each}
        </div>
      </div>

      <div class="op-divider !mx-0 !my-0"></div>
      <button class="op-menu-item !px-1 -my-1" onclick={openAllSettings} data-all-settings>
        <Icon name="settings" size={18} /><span class="flex-1">{$t('chrome.settings.all')}</span><Icon name="chevronRight" size={18} />
      </button>
    </div>
  {/if}
</div>
