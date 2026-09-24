<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { t } from '$lib/i18n';
  import { activeFloor, currentProject, detectedRoomsStore, measuredConstraintValue, removeConstraint, setConstraintDriven, updateConstraint, updateConstraintValue } from '$lib/stores/project';
  import { formatLengthPrecise, parseLengthInput, projectSettings } from '$lib/stores/settings';
  import { dimensionOptions, type DimensionOption } from '$lib/utils/constraints/options';
  import type { Constraint } from '$lib/models/types';

  let { id, x, y, onclose }: { id: string; x: number; y: number; onclose: () => void } = $props();

  // The store mutates floors in place; a project version makes derived values follow every edit.
  let version = $state(0);
  onDestroy(currentProject.subscribe(() => { version++; }));
  const floor = $derived($activeFloor);
  const constraint = $derived((void version, floor?.constraints?.find(c => c.id === id) && { ...floor.constraints.find(c => c.id === id)! }));
  const units = $derived($projectSettings.units);
  let text = $state('');
  let error = $state('');
  let card: HTMLDivElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();

  function currentValue(c: Constraint): number {
    const measured = measuredConstraintValue(c, floor?.walls ?? []);
    return measured ?? ('value' in c ? c.value : 0);
  }

  function formatted(c: Constraint): string {
    const value = Math.abs(currentValue(c));
    if (c.kind === 'angle') return `${+value.toFixed(2)}`;
    return units === 'imperial' ? formatLengthPrecise(value, 'imperial') : `${+value.toFixed(1)}`;
  }

  $effect(() => {
    id;
    untrack(() => {
      const c = constraint;
      text = c ? formatted(c) : '';
      error = '';
      requestAnimationFrame(() => { input?.focus({ preventScroll: true }); input?.select(); });
    });
  });

  function apply(): boolean {
    const c = constraint;
    if (!c || !('value' in c)) return true;
    if (c.driven) return true;
    const parsed = c.kind === 'angle' ? Number(text.replace('°', '').trim()) : parseLengthInput(text, units);
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || (c.kind === 'angle' && parsed > 180)) {
      error = $t(c.kind === 'angle' ? 'dimensionEditor.angleInvalid' : 'dimensionEditor.lengthInvalid');
      return false;
    }
    const sign = c.value < 0 ? -1 : 1;
    const result = updateConstraintValue(c.id, sign * parsed);
    if (result) { error = result; return false; }
    return true;
  }

  const options = $derived(constraint ? dimensionOptions(constraint, floor?.walls ?? [], $detectedRoomsStore.length ? $detectedRoomsStore : floor?.rooms ?? []) : []);

  function choose(option: DimensionOption) {
    updateConstraint(id, option.patch);
    const c = constraint;
    if (c) text = formatted(c);
    input?.focus();
  }

  function setDriven(driven: boolean) {
    const result = setConstraintDriven(id, driven);
    error = result ?? '';
    const c = constraint;
    if (c) text = formatted(c);
  }

  function onkeydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Enter') { event.preventDefault(); if (apply()) onclose(); }
    if (event.key === 'Escape') { event.preventDefault(); onclose(); }
  }

  function onfocusout(event: FocusEvent) {
    if (card && event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return;
    const c = constraint;
    if (c && !c.driven && text !== formatted(c)) apply();
    onclose();
  }
</script>

{#if constraint}
  <div
    bind:this={card}
    class="absolute z-30 w-64 rounded-lg border border-indigo-300 bg-white p-2 shadow-lg"
    style="left: {x}px; top: {y}px; transform: translate(-50%, 14px);"
    role="dialog"
    aria-label={$t('dimensionEditor.label')}
    data-dimension-editor
    tabindex="-1"
    {onfocusout}
  >
    <div class="flex items-center gap-1.5">
      <input
        bind:this={input}
        bind:value={text}
        class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm tabular-nums outline-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
        aria-label={$t('dimensionEditor.value')}
        disabled={constraint.driven}
        data-dimension-value
        {onkeydown}
      />
      <span class="text-xs text-gray-500">{constraint.kind === 'angle' ? '°' : units === 'imperial' ? '' : 'cm'}</span>
      <button
        class="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
        title={$t('dimensionEditor.delete')}
        aria-label={$t('dimensionEditor.delete')}
        onclick={() => { removeConstraint(id); onclose(); }}
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 7h12M9 7V5h6v2m-7 4v6m4-6v6m4-10v12a1 1 0 01-1 1H8a1 1 0 01-1-1V7"/></svg>
      </button>
    </div>
    {#if options.length}
      <div class="mt-1.5 flex flex-wrap gap-1" role="group" aria-label={$t('dimensionEditor.measureFrom')}>
        {#each options as option}
          <button
            class="rounded-full border px-2 py-0.5 text-xs {option.active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
            aria-pressed={option.active}
            data-dimension-option
            onclick={() => choose(option)}
          >{$t(option.key, option.vars)}</button>
        {/each}
      </div>
    {/if}
    <div class="mt-1.5">
      <div class="flex overflow-hidden rounded border border-gray-200 text-xs" role="group">
        <button class="flex-1 px-2 py-0.5 {constraint.driven ? 'text-gray-600' : 'bg-indigo-600 text-white'}" aria-pressed={!constraint.driven} data-dimension-driving onclick={() => setDriven(false)}>{$t('dimensionEditor.driving')}</button>
        <button class="flex-1 px-2 py-0.5 {constraint.driven ? 'bg-gray-600 text-white' : 'text-gray-600'}" aria-pressed={!!constraint.driven} data-dimension-reference onclick={() => setDriven(true)}>{$t('dimensionEditor.reference')}</button>
      </div>
    </div>
    <p class="mt-1 text-[10px] text-gray-400">{$t('dimensionEditor.hint')}</p>
    {#if constraint.driven}
      <p class="mt-1 text-xs text-gray-500">{$t('dimensionEditor.drivenHint')}</p>
    {/if}
    {#if error}
      <p class="mt-1 text-xs text-red-600" role="alert">{error}</p>
    {/if}
  </div>
{/if}
