<script lang="ts">
  import { t } from '$lib/i18n';
  import { togglePopover } from '$lib/stores/chrome';
  import { chooseGroup } from './tools';
  import { traceImage } from './actions';
  import Icon from './Icon.svelte';
</script>

<div class="op-float op-enter absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] max-w-[calc(100vw-2rem)] flex flex-col items-center gap-4 p-7 text-center" style="border-radius:var(--radius-2xl)" data-start-card>
  <div class="flex flex-col gap-1.5">
    <span class="text-lg font-semibold" style="color:var(--color-text-strong)">{$t('chrome.start.title')}</span>
    <span class="text-sm leading-normal" style="color:var(--color-text-muted)">{$t('chrome.start.body')}</span>
  </div>
  <div class="w-full flex flex-col gap-2">
    <button class="op-btn is-primary is-big w-full text-base" onclick={() => chooseGroup('wall')}><Icon name="wall" />{$t('chrome.start.draw')}</button>
    <button class="op-btn is-outline is-big w-full text-base" onclick={() => { chooseGroup('wall'); togglePopover('room-shapes'); }}><Icon name="projects" />{$t('chrome.start.shape')}</button>
    <button class="op-btn is-outline is-big w-full text-base" onclick={() => traceImage()}><Icon name="image" />{$t('chrome.start.trace')}</button>
  </div>
  <span class="text-xs" style="color:var(--color-text-muted)">{$t('chrome.start.gestures')}</span>
</div>
