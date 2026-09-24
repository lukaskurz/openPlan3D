<script lang="ts">
  import { t } from '$lib/i18n';
  import { onDestroy } from 'svelte';
  import { activeFloor, currentProject, detectedRoomsStore, removeConstraint, selectedElementId, setConstraintDriven, updateConstraint, updateConstraintValue } from '$lib/stores/project';
  import { formatLengthPrecise, parseLengthInput, projectSettings } from '$lib/stores/settings';
  import { analyzeConstraints, isDimension } from '$lib/utils/constraints';
  import { dimensionOptions } from '$lib/utils/constraints/options';
  import type { Constraint } from '$lib/models/types';

  let { constraint: selected }: { constraint: Constraint } = $props();

  // The store mutates floors in place; a project version makes derived values follow every edit.
  let version = $state(0);
  onDestroy(currentProject.subscribe(() => { version++; }));
  const floor = $derived((void version, $activeFloor));
  const constraint = $derived((void version, floor?.constraints?.find(c => c.id === selected.id) ?? selected));
  const units = $derived($projectSettings.units);
  const analysis = $derived(floor ? analyzeConstraints(floor.walls, floor.constraints ?? []) : null);
  const measured = $derived(analysis?.measures.get(constraint.id) ?? null);
  const conflict = $derived(!!analysis?.conflicts.has(constraint.id));
  const options = $derived(dimensionOptions(constraint, floor?.walls ?? [], $detectedRoomsStore.length ? $detectedRoomsStore : floor?.rooms ?? []));
  let error = $state('');
  $effect(() => { void constraint.id; error = ''; });

  function display(value: number | null): string {
    if (value === null) return '';
    const v = Math.abs(value);
    if (constraint.kind === 'angle') return `${+v.toFixed(2)}`;
    return units === 'imperial' ? formatLengthPrecise(v, 'imperial') : `${+v.toFixed(1)}`;
  }

  function apply(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!isDimension(constraint) || constraint.driven) return;
    const parsed = constraint.kind === 'angle' ? Number(input.value.replace('°', '').trim()) : parseLengthInput(input.value, units);
    if (parsed === null || !Number.isFinite(parsed) || parsed < 0 || (constraint.kind === 'angle' && parsed > 180)) {
      error = $t(constraint.kind === 'angle' ? 'dimensionEditor.angleInvalid' : 'dimensionEditor.lengthInvalid');
      input.value = display(measured);
      return;
    }
    if (Math.abs(parsed - Math.abs(measured ?? constraint.value)) < 1e-9) return;
    error = updateConstraintValue(constraint.id, (constraint.value < 0 ? -1 : 1) * parsed) ?? '';
    if (error) input.value = display(measured);
  }
</script>

<div class="space-y-3" data-constraint-properties>
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-gray-800">{$t(`constraintKinds.${constraint.kind}`)}</h3>
    {#if conflict}<span class="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700">{$t('constraintProperties.conflict')}</span>{/if}
  </div>
  {#if isDimension(constraint)}
    <div>
      <label class="mb-1 block text-xs text-gray-500" for="constraint-value">{$t('dimensionEditor.value')}</label>
      <div class="flex items-center gap-1.5">
        <input
          id="constraint-value"
          class="w-full rounded border border-gray-200 px-2 py-1 text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-500"
          value={display(measured)}
          disabled={constraint.driven}
          data-constraint-value
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(e); } }}
          onblur={apply}
        />
        <span class="text-xs text-gray-500">{constraint.kind === 'angle' ? '°' : units === 'imperial' ? '' : 'cm'}</span>
      </div>
    </div>
    {#if options.length}
      <div>
        <div class="mb-1 text-xs text-gray-500">{$t('dimensionEditor.measureFrom')}</div>
        <div class="flex flex-wrap gap-1">
          {#each options as option}
            <button
              class="rounded-full border px-2 py-0.5 text-xs {option.active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}"
              aria-pressed={option.active}
              onclick={() => updateConstraint(constraint.id, option.patch)}
            >{$t(option.key, option.vars)}</button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="flex overflow-hidden rounded border border-gray-200 text-xs" role="group">
      <button class="flex-1 px-2 py-1 {constraint.driven ? 'text-gray-600' : 'bg-indigo-600 text-white'}" aria-pressed={!constraint.driven} data-constraint-driving onclick={() => { error = setConstraintDriven(constraint.id, false) ?? ''; }}>{$t('dimensionEditor.driving')}</button>
      <button class="flex-1 px-2 py-1 {constraint.driven ? 'bg-gray-600 text-white' : 'text-gray-600'}" aria-pressed={!!constraint.driven} data-constraint-reference onclick={() => { error = setConstraintDriven(constraint.id, true) ?? ''; }}>{$t('dimensionEditor.reference')}</button>
    </div>
    <p class="text-xs text-gray-500">{$t(constraint.driven ? 'dimensionEditor.drivenHint' : 'constraintProperties.drivingHint')}</p>
  {:else}
    <p class="text-xs text-gray-500">{$t(`constraintProperties.hint.${constraint.kind}`)}</p>
  {/if}
  {#if error}<p class="text-xs text-red-700" role="alert">{error}</p>{/if}
  <button
    class="w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
    data-constraint-delete
    onclick={() => { removeConstraint(constraint.id); selectedElementId.set(null); }}
  >{$t('constraintProperties.delete')}</button>
</div>
