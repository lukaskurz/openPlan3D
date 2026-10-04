<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { t, type TranslationKey } from '$lib/i18n';
  import { currentProject, detectedRoomsStore, selectedElementIds, selectedRoomId } from '$lib/stores/project';
  import { planViewApi, planInsetRight } from '$lib/stores/planView';
  import { assistantOpen, floorView, elementsListOpen } from '$lib/stores/chrome';
  import { hasPlanContent } from '$lib/utils/planContentBounds';
  import { assistant, send, stop, retry, applyProposal, discardProposal, newConversation, type Attachment, type ChangeCounts } from '$lib/assistant/session';
  import { richText } from '$lib/assistant/richText';
  import { prepareImage, preparePdf, PDF_MAX_BYTES } from '$lib/assistant/images';
  import { assistantApiKey, plausibleKey } from '$lib/assistant/apiKey';
  import Icon from './Icon.svelte';
  import AssistantToolCard from './AssistantToolCard.svelte';

  let { visible }: { visible: boolean } = $props();

  let draft = $state('');
  let scroller: HTMLDivElement | undefined = $state();
  let input: HTMLTextAreaElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let attachments = $state<Attachment[]>([]);
  let photoError = $state(false);
  let keyOpen = $state(false);
  let keyDraft = $state('');
  let keyError = $state(false);

  let rooms = $derived($detectedRoomsStore.length);
  let alternative = $derived(($currentProject?.alternatives ?? []).find(alt => alt.id === $currentProject?.activeAlternativeId)?.name);
  let subtitle = $derived([
    $t('chrome.assistant.sees', { floor: $floorView?.name ?? '' }),
    alternative,
    $t(rooms === 1 ? 'canvasStatus.roomsOne' : 'canvasStatus.roomsMany', { count: rooms }),
    $assistantApiKey ? $t('chrome.assistant.key.active') : '',
  ].filter(Boolean).join(' · '));

  let suggestions = $derived.by((): TranslationKey[] => {
    if (!$floorView || !hasPlanContent($floorView)) return ['chrome.assistant.suggest.flat', 'chrome.assistant.suggest.room'];
    if ($selectedRoomId) return ['chrome.assistant.suggest.analyse', 'chrome.assistant.suggest.furnishRoom'];
    if ($selectedElementIds.size) return ['chrome.assistant.suggest.space', 'chrome.assistant.suggest.walkways'];
    return ['chrome.assistant.suggest.living', 'chrome.assistant.suggest.walkways', 'chrome.assistant.suggest.area'];
  });

  const SUMMARY: [keyof ChangeCounts, TranslationKey, TranslationKey][] = [
    ['rooms', 'chrome.assistant.sum.roomsOne', 'chrome.assistant.sum.roomsMany'],
    ['walls', 'chrome.assistant.sum.wallsOne', 'chrome.assistant.sum.wallsMany'],
    ['openings', 'chrome.assistant.sum.openingsOne', 'chrome.assistant.sum.openingsMany'],
    ['furniture', 'chrome.assistant.sum.furnitureOne', 'chrome.assistant.sum.furnitureMany'],
    ['floors', 'chrome.assistant.sum.floorsOne', 'chrome.assistant.sum.floorsMany'],
    ['changed', 'chrome.assistant.sum.changedOne', 'chrome.assistant.sum.changedMany'],
    ['removed', 'chrome.assistant.sum.removedOne', 'chrome.assistant.sum.removedMany'],
  ];
  function summary(counts: ChangeCounts) {
    return SUMMARY.filter(([key]) => counts[key] > 0).map(([key, one, many]) => $t(counts[key] === 1 ? one : many, { count: counts[key] })).join(', ');
  }

  // Keep the newest message in view.
  $effect(() => {
    void $assistant.items;
    void $assistant.activity;
    tick().then(() => scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' }));
  });

  // The panel covers the right of the plan: slide the plan left while it is open.
  const PANEL_SPACE = 420;
  let slid = 0;
  $effect(() => {
    const wide = typeof window !== 'undefined' && window.innerWidth > 1000;
    const want = visible && wide ? PANEL_SPACE : 0;
    planInsetRight.set(want);
    if (want !== slid) {
      get(planViewApi)?.panBy(-(want - slid) / 2, 0);
      slid = want;
    }
  });
  $effect(() => () => { planInsetRight.set(0); });

  // A proposal that adds rooms, walls or floors may land outside the view: fit the plan so it is seen.
  let fittedFor = 0;
  $effect(() => {
    const card = $assistant.items.findLast(item => item.kind === 'proposal' && item.status === 'pending');
    if (!card || card.kind !== 'proposal' || card.id === fittedFor || $assistant.busy) return;
    fittedFor = card.id;
    if (card.counts.rooms || card.counts.walls || card.counts.floors) tick().then(() => get(planViewApi)?.zoomToFit());
  });

  $effect(() => {
    if (visible) {
      elementsListOpen.set(false);
      tick().then(() => { if (window.matchMedia('(pointer: fine)').matches) input?.focus(); });
    }
  });

  function resize() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }

  function submit(text = draft) {
    if ((!text.trim() && !attachments.length) || $assistant.busy) return;
    void send(text, attachments);
    draft = '';
    attachments = [];
    photoError = false;
    tick().then(resize);
  }

  async function addPhotos(files: Iterable<File>) {
    photoError = false;
    for (const file of files) {
      if (attachments.length >= 3) continue;
      if (file.type === 'application/pdf') {
        if (file.size > PDF_MAX_BYTES || attachments.some(a => a.mediaType === 'application/pdf')) { photoError = true; continue; }
        try { attachments = [...attachments, await preparePdf(file)]; }
        catch { photoError = true; }
        continue;
      }
      if (!file.type.startsWith('image/')) continue;
      try { attachments = [...attachments, await prepareImage(file)]; }
      catch { photoError = true; }
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/') || file.type === 'application/pdf');
    if (files.length) { e.preventDefault(); void addPhotos(files); }
  }

  function openKey() {
    keyDraft = '';
    keyError = false;
    keyOpen = true;
  }

  function saveKey() {
    if (!plausibleKey(keyDraft)) { keyError = true; return; }
    assistantApiKey.set(keyDraft.trim());
    keyOpen = false;
    keyDraft = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); assistantOpen.set(false); }
  }
</script>

<aside class="op-float op-assistant fixed z-[26] flex flex-col overflow-hidden {visible ? 'op-enter' : 'hidden'}" aria-label={$t('chrome.assistant.title')} data-assistant-panel>
  <div class="flex items-center gap-3 py-3 pl-4 pr-2 shrink-0" style="border-bottom:1px solid var(--color-border-subtle)">
    <div class="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center" style="background:var(--color-accent);color:var(--color-on-accent)"><Icon name="sparkles" size={20} /></div>
    <div class="flex-1 min-w-0">
      <div class="text-base font-semibold" style="color:var(--color-text-strong)">{$t('chrome.assistant.title')}</div>
      <div class="text-xs truncate" style="color:var(--color-text-muted)">{subtitle}</div>
    </div>
    <button class="op-btn is-square" aria-label={$t('chrome.assistant.key.open')} title={$t('chrome.assistant.key.open')} aria-expanded={keyOpen} onclick={() => keyOpen ? keyOpen = false : openKey()}><Icon name="key" size={18} /></button>
    {#if $assistant.items.length && !$assistant.busy}
      <button class="op-btn is-square" aria-label={$t('chrome.assistant.newChat')} title={$t('chrome.assistant.newChat')} onclick={newConversation}><Icon name="newChat" /></button>
    {/if}
    <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={() => assistantOpen.set(false)}><Icon name="close" /></button>
  </div>

  {#if keyOpen}
    <form class="flex flex-col gap-2.5 p-4 shrink-0" style="border-bottom:1px solid var(--color-border-subtle);background:var(--color-surface-subtle)" onsubmit={(e) => { e.preventDefault(); saveKey(); }} data-key-settings>
      <div class="text-sm font-semibold" style="color:var(--color-text-strong)">{$t('chrome.assistant.key.title')}</div>
      <p class="text-xs leading-snug" style="color:var(--color-text-muted)">{$t('chrome.assistant.key.help')}</p>
      <input class="op-field w-full" type="password" autocomplete="off" spellcheck="false" bind:value={keyDraft} placeholder={$assistantApiKey ? '••••••••' + $assistantApiKey.slice(-4) : $t('chrome.assistant.key.placeholder')} aria-label={$t('chrome.assistant.key.title')} aria-invalid={keyError} />
      {#if keyError}<span class="text-xs" style="color:var(--color-danger-text)">{$t('chrome.assistant.key.invalid')}</span>{/if}
      <div class="flex gap-2">
        <button type="submit" class="op-btn is-primary" disabled={!keyDraft.trim()}>{$t('chrome.assistant.key.save')}</button>
        {#if $assistantApiKey}<button type="button" class="op-btn is-outline" onclick={() => { assistantApiKey.set(''); keyOpen = false; }}>{$t('chrome.assistant.key.remove')}</button>{/if}
      </div>
    </form>
  {/if}

  <div bind:this={scroller} class="op-scroll op-assistant-thread flex-1 min-h-0 flex flex-col gap-3.5 p-4" aria-live="polite">
    {#if !$assistant.items.length}
      <p class="mt-auto text-sm leading-normal" style="color:var(--color-text-muted)">{$t('chrome.assistant.intro')}</p>
    {:else}
      <div class="mt-auto"></div>
    {/if}
    {#each $assistant.items as item (item.id)}
      {#if item.kind === 'user'}
        <div class="self-end flex flex-col items-end gap-1.5 max-w-[300px]" data-chat-user>
          {#if item.files?.length}
            <div class="flex gap-1.5 flex-wrap justify-end">{#each item.files as name}<div class="px-2.5 py-1.5 rounded-xl text-xs max-w-[200px] truncate" style="border:1px solid var(--color-border);background:var(--color-surface-muted);color:var(--color-text)">PDF · {name}</div>{/each}</div>
          {/if}
          {#if item.images?.length}
            <div class="flex gap-1.5">{#each item.images as src}<img {src} alt="" class="w-20 h-20 object-cover rounded-xl" style="border:1px solid var(--color-border)" />{/each}</div>
          {/if}
          {#if item.text}<div class="px-3.5 py-2.5 text-sm leading-snug whitespace-pre-wrap break-words" style="border-radius:18px 18px 4px 18px;background:var(--color-surface-muted);color:var(--color-text)">{item.text}</div>{/if}
        </div>
      {:else if item.kind === 'assistant'}
        <div class="flex flex-col gap-2 text-sm leading-normal break-words" style="color:var(--color-text)" data-chat-reply>
          {#each richText(item.text) as block}
            {#if block.kind === 'p'}
              <p>{#each block.spans as span}{#if span.bold}<strong>{span.text}</strong>{:else}{span.text}{/if}{/each}</p>
            {:else}
              <svelte:element this={block.ordered ? 'ol' : 'ul'} class="flex flex-col gap-1 pl-5 {block.ordered ? 'list-decimal' : 'list-disc'}">
                {#each block.items as spans}<li>{#each spans as span}{#if span.bold}<strong>{span.text}</strong>{:else}{span.text}{/if}{/each}</li>{/each}
              </svelte:element>
            {/if}
          {/each}
          {#if item.stopped}<span class="text-xs" style="color:var(--color-text-muted)">{$t('chrome.assistant.stopped')}</span>{/if}
        </div>
      {:else if item.kind === 'proposal'}
        {#if item.status === 'pending'}
          <div class="flex flex-col gap-2.5 p-3 rounded-lg" style="border:1px solid var(--color-accent-ring);background:var(--color-accent-subtle)" data-proposal>
            <div class="flex items-center gap-2 text-sm font-semibold" style="color:var(--color-accent-text-strong)">
              <span class="w-2 h-2 shrink-0 rounded-full" style="background:var(--color-accent)"></span>
              <span>{summary(item.counts)} · {$t('chrome.assistant.shownOnPlan')}</span>
            </div>
            <div class="flex gap-2">
              <button class="op-btn is-primary" disabled={$assistant.busy} onclick={applyProposal}>{$t('chrome.assistant.apply')}</button>
              <button class="op-btn is-outline whitespace-nowrap" disabled={$assistant.busy} onclick={discardProposal}>{$t('chrome.assistant.notNow')}</button>
            </div>
          </div>
        {:else}
          <div class="flex items-center gap-2 text-xs" style="color:var(--color-text-muted)" data-proposal={item.status}>
            <Icon name={item.status === 'applied' ? 'check' : 'close'} size={14} />
            <span>{$t(item.status === 'applied' ? 'chrome.assistant.applied' : 'chrome.assistant.discarded')} · {summary(item.counts)}</span>
          </div>
        {/if}
      {:else if item.kind === 'tool'}
        <AssistantToolCard toolId={item.toolId} />
      {:else if item.kind === 'error'}
        <div class="flex flex-col items-start gap-2 p-3 rounded-lg text-sm" style="background:var(--color-danger-subtle);color:var(--color-danger-text)" role="alert">
          <span>{$t(`chrome.assistant.error.${item.error}`)}</span>
          <div class="flex gap-2 flex-wrap">
            {#if item.retry}<button class="op-btn is-outline" onclick={retry}>{$t('chrome.assistant.retry')}</button>{/if}
            {#if item.error === 'unavailable' || item.error === 'badKey'}<button class="op-btn is-outline" onclick={openKey}>{$t(item.error === 'badKey' ? 'chrome.assistant.key.open' : 'chrome.assistant.useOwnKey')}</button>{/if}
          </div>
        </div>
      {/if}
    {/each}
    {#if $assistant.activity}
      <div class="flex items-center gap-2 text-sm" style="color:var(--color-text-muted)" data-chat-activity>
        <span class="op-typing" aria-hidden="true"><i></i><i></i><i></i></span>
        {$t(`chrome.assistant.activity.${$assistant.activity}`)}
      </div>
    {/if}
  </div>

  <div class="flex flex-col gap-2.5 p-3 shrink-0" style="border-top:1px solid var(--color-border-subtle)">
    {#if !$assistant.busy}
      <div class="op-chips flex flex-wrap gap-2">
        {#each suggestions as key}
          <button class="op-chip" onclick={() => submit($t(key))}>{$t(key)}</button>
        {/each}
      </div>
    {/if}
    {#if attachments.length || photoError}
      <div class="flex gap-2 items-center flex-wrap" data-attachments>
        {#each attachments as attachment, i}
          <div class="relative">
            {#if attachment.thumb}
              <img src={attachment.thumb} alt="" class="w-14 h-14 object-cover rounded-lg" style="border:1px solid var(--color-border)" />
            {:else}
              <div class="h-14 max-w-[9rem] px-2.5 rounded-lg flex flex-col justify-center text-xs" style="border:1px solid var(--color-border);background:var(--color-surface-muted);color:var(--color-text)" data-pdf-chip><span class="font-semibold">PDF</span><span class="truncate">{attachment.name}</span></div>
            {/if}
            <button class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center" style="background:var(--color-text-strong);color:var(--color-surface)" aria-label={$t('chrome.assistant.removePhoto')} onclick={() => attachments = attachments.filter((_, j) => j !== i)}><Icon name="close" size={14} /></button>
          </div>
        {/each}
        {#if photoError}<span class="text-xs" style="color:var(--color-danger-text)">{$t('chrome.assistant.photoFailed')}</span>{/if}
      </div>
    {/if}
    <div class="flex items-end gap-2">
      <input bind:this={fileInput} type="file" accept="image/*,application/pdf" multiple class="hidden" onchange={(e) => { const el = e.currentTarget; void addPhotos([...(el.files ?? [])]); el.value = ''; }} />
      <button class="op-attach" aria-label={$t('chrome.assistant.attach')} title={$t('chrome.assistant.attach')} disabled={$assistant.busy || attachments.length >= 3} onclick={() => fileInput?.click()}><Icon name="plus" size={20} /></button>
      <textarea
        bind:this={input}
        bind:value={draft}
        oninput={resize}
        onkeydown={onKeydown}
        onpaste={onPaste}
        rows="1"
        maxlength="4000"
        class="op-chat-input flex-1 min-w-0"
        placeholder={$t('chrome.assistant.placeholder')}
        aria-label={$t('chrome.assistant.placeholder')}
      ></textarea>
      {#if $assistant.busy}
        <button class="op-send" aria-label={$t('chrome.assistant.stop')} title={$t('chrome.assistant.stop')} onclick={stop}><Icon name="stop" size={18} /></button>
      {:else}
        <button class="op-send" aria-label={$t('chrome.assistant.send')} disabled={!draft.trim() && !attachments.length} onclick={() => submit()}><Icon name="send" size={20} strokeWidth={2.2} /></button>
      {/if}
    </div>
  </div>
</aside>
