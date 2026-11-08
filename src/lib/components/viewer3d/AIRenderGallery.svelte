<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t, locale } from '$lib/i18n';
  import { currentProject, deleteAIRender } from '$lib/stores/project';
  import { modalDialog, reconcileNativeClose } from '$lib/utils/modalDialog';
  import { listAIRenders, renderAlternativeLabel } from '$lib/utils/aiRenders';
  import type { AIRenderRecord } from '$lib/models/types';

  let scope = $state<'current' | 'all'>('current');
  let shown = $state(12);
  let openRenderId = $state<string | null>(null);
  let compare = $state<'render' | 'split' | 'input'>('render');
  let split = $state(50);
  let confirmingDelete = $state(false);

  let hasAlternatives = $derived(($currentProject?.alternatives?.length ?? 0) > 1);
  let effectiveScope = $derived(hasAlternatives ? scope : 'all');
  let renders = $derived($currentProject ? listAIRenders($currentProject, effectiveScope) : []);
  let total = $derived($currentProject?.renders?.length ?? 0);
  let openIndex = $derived(renders.findIndex(render => render.id === openRenderId));
  let opened = $derived<AIRenderRecord | undefined>(openIndex >= 0 ? renders[openIndex]
    : $currentProject?.renders?.find(render => render.id === openRenderId));

  // Blob URLs for stored attachments: cheaper to paint than data: URLs and freed on close.
  const urls = new Map<string, { data: string; url: string }>();
  function imageURL(name: string | undefined): string | undefined {
    if (!name) return;
    const data = $currentProject?.projectPackage?.assets?.[`assets/${name}`];
    if (typeof data !== 'string' || !data) return;
    const cached = urls.get(name);
    if (cached?.data === data) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    try {
      const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' }));
      urls.set(name, { data, url });
      return url;
    } catch { return; }
  }
  onDestroy(() => { for (const { url } of urls.values()) URL.revokeObjectURL(url); urls.clear(); });

  function formatDate(value: string, long = false): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return date.toLocaleString($locale === 'pt' ? 'pt-BR' : 'en', long
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function show(id: string) {
    openRenderId = id; compare = 'render'; split = 50; confirmingDelete = false;
  }
  function close() { openRenderId = null; confirmingDelete = false; }
  function step(delta: number) {
    if (openIndex < 0 || !renders.length) return;
    show(renders[(openIndex + delta + renders.length) % renders.length].id);
  }

  function download(render: AIRenderRecord) {
    const url = imageURL(render.assetName);
    if (!url) return;
    const stamp = render.createdAt.slice(0, 16).replace(/[:T]/g, '-');
    const code = render.alternativeCode ? `-${render.alternativeCode}` : '';
    const name = `${($currentProject?.name || 'floorplan').replace(/[\\/:*?"<>|]+/g, '-')}-render${code}-${stamp}.${/\.png$/i.test(render.assetName) ? 'png' : 'jpg'}`;
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
  }

  function remove(render: AIRenderRecord) {
    const next = renders[openIndex + 1] ?? renders[openIndex - 1];
    deleteAIRender(render.id);
    confirmingDelete = false;
    if (next && next.id !== render.id) show(next.id); else close();
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
  }
</script>

<div class="space-y-2 border-t border-gray-700 pt-3" data-testid="ai-render-gallery">
  <div class="flex items-center justify-between gap-2">
    <div class="text-xs font-medium text-white">{$t('aiRenders.title', { count: total })}</div>
    {#if hasAlternatives}
      <div class="flex rounded-md overflow-hidden border border-gray-700 text-[10px]" role="group" aria-label={$t('aiRenders.filter')}>
        <button class="px-2 py-1 {scope === 'current' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}" aria-pressed={scope === 'current'} onclick={() => { scope = 'current'; }}>{$t('aiRenders.current')}</button>
        <button class="px-2 py-1 {scope === 'all' ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}" aria-pressed={scope === 'all'} onclick={() => { scope = 'all'; }}>{$t('aiRenders.all')}</button>
      </div>
    {/if}
  </div>

  {#if !renders.length}
    <p class="text-[10px] text-gray-500">{total && effectiveScope === 'current' ? $t('aiRenders.noneHere') : $t('aiRenders.none')}</p>
  {:else}
    <div class="grid grid-cols-3 gap-1.5">
      {#each renders.slice(0, shown) as render (render.id)}
        {@const url = imageURL(render.assetName)}
        <button class="group relative block overflow-hidden rounded-md bg-gray-800 aspect-video focus:outline-none focus:ring-2 focus:ring-blue-400"
          onclick={() => show(render.id)} aria-label={$t('aiRenders.open', { date: formatDate(render.createdAt, true) })}>
          {#if url}<img src={url} alt="" loading="lazy" class="h-full w-full object-cover transition-opacity group-hover:opacity-90" />
          {:else}<span class="text-[10px] text-gray-500">{$t('aiRenders.missing')}</span>{/if}
          <span class="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-black/60 px-1 py-0.5 text-[9px] text-gray-200">
            <span class="truncate">{formatDate(render.createdAt)}</span>
            {#if effectiveScope === 'all' && render.alternativeCode}<span class="shrink-0 rounded bg-gray-700 px-1 font-semibold">{render.alternativeCode}</span>{/if}
          </span>
        </button>
      {/each}
    </div>
    {#if renders.length > shown}
      <button class="w-full text-[10px] text-blue-400 hover:text-blue-300" onclick={() => { shown += 12; }}>{$t('aiRenders.more', { count: renders.length - shown })}</button>
    {/if}
  {/if}
</div>

{#if opened}
  {@const resultUrl = imageURL(opened.assetName)}
  {@const inputUrl = imageURL(opened.inputAssetName)}
  {@const alternative = renderAlternativeLabel(opened)}
  <dialog use:modalDialog aria-labelledby="ai-render-viewer-title" onkeydown={onKeydown}
    oncancel={close} onclose={(event) => reconcileNativeClose(event, false, close)}
    class="m-auto w-[64rem] max-w-[calc(100vw-2rem)] max-h-[92vh] rounded-xl bg-gray-900 p-0 text-gray-200 shadow-2xl backdrop:bg-black/70">
    <div class="flex max-h-[92vh] flex-col">
      <div class="flex items-center justify-between gap-3 border-b border-gray-700 px-4 py-2">
        <h2 id="ai-render-viewer-title" class="text-sm font-medium text-white">{$t('aiRenders.viewer')}{#if openIndex >= 0}<span class="ml-2 text-gray-500 font-normal">{openIndex + 1} / {renders.length}</span>{/if}</h2>
        <div class="flex items-center gap-1">
          {#if renders.length > 1 && openIndex >= 0}
            <button class="w-8 h-8 rounded bg-gray-800 hover:bg-gray-700 text-gray-300" onclick={() => step(-1)} aria-label={$t('aiRenders.previous')}>←</button>
            <button class="w-8 h-8 rounded bg-gray-800 hover:bg-gray-700 text-gray-300" onclick={() => step(1)} aria-label={$t('aiRenders.next')}>→</button>
          {/if}
          <button class="w-8 h-8 text-gray-400 hover:text-white text-lg leading-none" onclick={close} aria-label={$t('aiRenders.close')}>✕</button>
        </div>
      </div>

      <div class="overflow-y-auto px-4 py-3 space-y-3">
        <!-- Sized by the image, so the compare overlay covers exactly the render. -->
        <div class="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg bg-black select-none">
          {#if compare === 'input' && inputUrl}
            <img src={inputUrl} alt={$t('aiRenders.inputAlt')} class="block max-h-[62vh] max-w-full" />
          {:else if resultUrl}
            <img src={resultUrl} alt={$t('aiRenders.renderAlt')} class="block max-h-[62vh] max-w-full" />
            {#if compare === 'split' && inputUrl}
              <!-- The 3D input covers the left part up to the divider, so both line up pixel for pixel. -->
              <img src={inputUrl} alt={$t('aiRenders.inputAlt')} class="absolute inset-0 h-full w-full object-fill" style="clip-path: inset(0 {100 - split}% 0 0);" />
              <div class="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style="left: {split}%;"></div>
              <span class="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px]">{$t('aiRenders.input')}</span>
              <span class="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px]">{$t('aiRenders.render')}</span>
            {/if}
          {:else}
            <p class="p-6 text-center text-xs text-gray-500">{$t('aiRenders.missing')}</p>
          {/if}
        </div>

        {#if inputUrl}
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex rounded-md overflow-hidden border border-gray-700 text-xs" role="group" aria-label={$t('aiRenders.compare')}>
              {#each [['render', 'aiRenders.render'], ['split', 'aiRenders.split'], ['input', 'aiRenders.input']] as const as [mode, label]}
                <button class="px-3 py-1.5 {compare === mode ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}" aria-pressed={compare === mode} onclick={() => { compare = mode; }}>{$t(label)}</button>
              {/each}
            </div>
            {#if compare === 'split'}
              <input type="range" min="0" max="100" bind:value={split} aria-label={$t('aiRenders.divider')} class="flex-1 min-w-32 h-1 accent-blue-400" />
            {/if}
          </div>
        {/if}

        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt class="text-gray-500">{$t('aiRenders.date')}</dt><dd>{formatDate(opened.createdAt, true)}</dd>
          <dt class="text-gray-500">{$t('aiRenders.model')}</dt><dd class="break-all">{opened.model} <span class="text-gray-500">({opened.provider})</span></dd>
          {#if alternative}<dt class="text-gray-500">{$t('aiRenders.alternative')}</dt><dd>{alternative}</dd>{/if}
          {#if opened.note}<dt class="text-gray-500">{$t('aiRenders.note')}</dt><dd class="whitespace-pre-wrap">{opened.note}</dd>{/if}
        </dl>
        {#if opened.prompt}
          <details class="text-[10px] text-gray-500">
            <summary class="cursor-pointer hover:text-gray-400">{$t('viewerAI.prompt')}</summary>
            <p class="mt-1 p-2 bg-gray-800 rounded text-gray-400 leading-relaxed whitespace-pre-wrap">{opened.prompt}</p>
          </details>
        {/if}
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
        {#if confirmingDelete}
          <p role="alert" class="mr-auto text-xs text-red-300">{$t('aiRenders.deleteConfirm')}</p>
          <button class="px-3 py-1.5 bg-gray-700 text-gray-200 text-sm rounded-lg hover:bg-gray-600" onclick={() => { confirmingDelete = false; }}>{$t('aiRenders.keep')}</button>
          <button class="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-500" onclick={() => remove(opened)}>{$t('aiRenders.deleteYes')}</button>
        {:else}
          <button class="mr-auto px-3 py-1.5 text-red-400 hover:text-red-300 text-sm" onclick={() => { confirmingDelete = true; }}>{$t('aiRenders.delete')}</button>
          <button class="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-500 disabled:opacity-50" disabled={!resultUrl} onclick={() => download(opened)}>{$t('viewerAI.download')}</button>
        {/if}
      </div>
    </div>
  </dialog>
{/if}
