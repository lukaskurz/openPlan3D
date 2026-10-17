<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '$lib/i18n';
  import Icon from './Icon.svelte';

  type Unit = 'm' | 'cm' | 'ft' | 'in';
  let {
    title,
    subtitle = '',
    valueCm,
    units,
    applyLabel,
    onapply,
    onclose,
    children,
    allowZero = false,
    smallUnit = false,
  }: {
    title: string;
    subtitle?: string;
    valueCm: number;
    units: 'metric' | 'imperial';
    applyLabel: string;
    onapply: (cm: number) => void;
    onclose?: () => void;
    children?: Snippet;
    /** Accept 0 (e.g. a light flush with the ceiling, an outlet at the floor). */
    allowZero?: boolean;
    /** Start in cm / in instead of m / ft, for short heights such as a mounting height. */
    smallUnit?: boolean;
  } = $props();

  const UNITS: Record<'metric' | 'imperial', Unit[]> = { metric: ['m', 'cm'], imperial: ['ft', 'in'] };
  const PER_CM: Record<Unit, number> = { m: 0.01, cm: 1, ft: 1 / 30.48, in: 1 / 2.54 };

  // svelte-ignore state_referenced_locally
  const startUnit: Unit = units === 'imperial' ? (smallUnit ? 'in' : 'ft') : (smallUnit ? 'cm' : 'm');
  let unit = $state<Unit>(startUnit);
  // svelte-ignore state_referenced_locally
  let text = $state(format(valueCm, startUnit));
  /** The first key replaces the shown value, like a selected field. */
  let fresh = $state(true);

  function format(cm: number, u: Unit) {
    const v = cm * PER_CM[u];
    return u === 'cm' || u === 'in' ? String(Math.round(v * 10) / 10) : v.toFixed(2);
  }

  let cm = $derived.by(() => {
    const v = parseFloat(text);
    return Number.isFinite(v) && (v > 0 || (allowZero && v === 0)) ? v / PER_CM[unit] : null;
  });

  function setUnit(next: Unit) {
    if (next === unit) return;
    if (cm !== null) text = format(cm, next);
    unit = next;
    fresh = true;
  }

  function press(key: string) {
    if (key === 'back') {
      text = fresh ? '' : text.slice(0, -1);
      fresh = false;
      return;
    }
    if (fresh) { text = ''; fresh = false; }
    if (key === '.' && text.includes('.')) return;
    if (text.length >= 8) return;
    text = text === '0' && key !== '.' ? key : text + key;
  }

  function apply() {
    if (cm !== null) onapply(cm);
  }

  // Hardware keyboards type straight into the keypad.
  function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (/^[0-9.]$/.test(e.key)) { press(e.key); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Backspace') { press('back'); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Enter') { apply(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'Escape') { onclose?.(); e.preventDefault(); e.stopPropagation(); }
  }
</script>

<svelte:window onkeydowncapture={onKeydown} />

<div class="op-popover op-enter w-[300px] max-w-[calc(100vw-1rem)] flex flex-col gap-2.5 p-3.5" role="dialog" aria-label={title} data-keypad>
  <div class="flex items-center justify-between gap-2">
    <span class="text-sm font-semibold" style="color:var(--color-text-strong)">{title}</span>
    {#if subtitle}<span class="text-xs" style="color:var(--color-text-muted)">{subtitle}</span>{/if}
  </div>
  <div class="flex items-center gap-2.5 h-[56px] pl-3.5 pr-1.5 rounded-lg" style="border:2px solid var(--color-accent)">
    <output class="flex-1 min-w-0 text-[32px] font-semibold tabular-nums truncate" style="color:var(--color-text-strong)" aria-live="polite">
      {text || '0'}{#if !fresh}<span class="inline-block w-0.5 h-7 ml-0.5 align-middle animate-pulse" style="background:var(--color-accent)"></span>{/if}
    </output>
    <div class="op-seg is-small">
      {#each UNITS[units] as u}
        <button aria-pressed={unit === u} onclick={() => setUnit(u)}>{u}</button>
      {/each}
    </div>
  </div>
  {@render children?.()}
  <div class="grid grid-cols-3 gap-1.5">
    {#each ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0'] as key}
      <button class="h-[46px] rounded-lg text-[22px] font-medium" style="background:var(--color-surface-muted);color:var(--color-text-strong)" onclick={() => press(key)}>{key}</button>
    {/each}
    <button class="h-[46px] rounded-lg flex items-center justify-center" style="background:var(--color-surface-muted);color:var(--color-text-secondary)" aria-label={$t('chrome.keypad.delete')} onclick={() => press('back')}>
      <Icon name="backspace" size={22} />
    </button>
  </div>
  <button class="op-btn is-primary is-big w-full text-base" disabled={cm === null} onclick={apply}>{applyLabel}</button>
</div>
