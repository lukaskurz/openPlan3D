<script lang="ts">
  import { t } from '$lib/i18n';
  import { assistantOpen } from '$lib/stores/chrome';
  import { activeCheck, checkResult, setCheckMinimum, CHECK_DEFAULTS } from '$lib/assistant/checks';
  import Icon from './Icon.svelte';

  let check = $derived($activeCheck);
  let unit = $derived(check ? CHECK_DEFAULTS[check.kind].unit : 'cm');
  let value = $derived(check ? `${check.minimum} ${unit}` : '');
  let count = $derived($checkResult ? ($checkResult.kind === 'walkway' ? $checkResult.gaps.length : $checkResult.rooms.length) : 0);
  let status = $derived.by(() => {
    if (!check) return '';
    if (check.kind === 'walkway') return count ? $t(count === 1 ? 'chrome.check.gapsOne' : 'chrome.check.gapsMany', { count }) : $t('chrome.check.gapsNone', { value });
    return count ? $t(count === 1 ? 'chrome.check.roomsOne' : 'chrome.check.roomsMany', { count }) : $t('chrome.check.roomsNone', { value });
  });
  const step = (direction: 1 | -1) => check && setCheckMinimum(check.minimum + direction * CHECK_DEFAULTS[check.kind].step);
</script>

{#if check}
  <div class="op-float op-check-bar op-enter" role="toolbar" aria-label={check.name} data-check-bar>
    <div class="flex flex-col min-w-0 pl-1">
      <span class="text-sm font-semibold truncate" style="color:var(--color-text-strong)">{check.name}</span>
      <span class="text-xs max-md:hidden" style="color:var(--color-text-muted)">{$t('chrome.check.madeBy')}</span>
    </div>
    <div class="op-divider-v"></div>
    <span class="text-sm max-md:hidden" style="color:var(--color-text-muted)">{$t('chrome.check.minimum')}</span>
    <div class="op-stepper">
      <button aria-label={$t('chrome.check.less')} onclick={() => step(-1)}><Icon name="minus" size={18} /></button>
      <span class="tabular-nums">{value}</span>
      <button aria-label={$t('chrome.check.more')} onclick={() => step(1)}><Icon name="plus" size={18} /></button>
    </div>
    <span class="text-sm font-semibold whitespace-nowrap" style="color:{count ? 'var(--color-danger-text)' : 'var(--color-success)'}" role="status">{status}</span>
    <button class="op-btn is-outline max-lg:hidden" onclick={() => assistantOpen.set(true)}><Icon name="sparkles" size={16} />{$t('chrome.check.change')}</button>
    <button class="op-btn is-primary" onclick={() => activeCheck.set(null)}>{$t('chrome.check.done')}</button>
  </div>
{/if}
