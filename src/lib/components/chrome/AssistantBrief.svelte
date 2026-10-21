<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { currentProject, previewActive, updateProjectBrief } from '$lib/stores/project';
  import { assistant } from '$lib/assistant/session';
  import { BRIEF_MAX_LENGTH } from '$lib/assistant/brief';
  import Icon from './Icon.svelte';

  let open = $state(false);
  let editing = $state(false);
  let draft = $state('');
  let field: HTMLTextAreaElement | undefined = $state();

  let brief = $derived($currentProject?.brief ?? '');
  // An edit made while a proposal is shown would join it, and "Not now" would throw it away.
  let locked = $derived($assistant.busy || $previewActive);

  function edit() {
    draft = brief;
    editing = true;
    open = true;
    tick().then(() => field?.focus());
  }

  function save() {
    if (locked) return;
    updateProjectBrief(draft.trim());
    editing = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editing = false; }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  }
</script>

<section class="shrink-0" style="border-bottom:1px solid var(--color-border-subtle);{open ? 'background:var(--color-surface-subtle)' : ''}" data-project-brief>
  <button class="w-full flex items-center gap-2.5 min-h-11 px-4 py-2 text-left" aria-expanded={open} aria-controls="assistant-brief-body" onclick={() => { open = !open; if (!open) editing = false; }}>
    <span class="shrink-0" style="color:var(--color-text-muted)"><Icon name="details" size={18} /></span>
    <span class="text-sm font-semibold shrink-0" style="color:var(--color-text-strong)">{$t('chrome.assistant.brief.title')}</span>
    <span class="flex-1 min-w-0 text-xs truncate" style="color:var(--color-text-muted)">{open ? '' : brief ? brief.split('\n')[0] : $t('chrome.assistant.brief.empty')}</span>
    <span class="shrink-0 transition-transform {open ? 'rotate-180' : ''}" style="color:var(--color-text-muted)"><Icon name="chevronDown" size={18} /></span>
  </button>

  {#if open}
    <div id="assistant-brief-body" class="flex flex-col gap-2.5 px-4 pb-3">
      {#if editing}
        <textarea
          bind:this={field}
          bind:value={draft}
          onkeydown={onKeydown}
          rows="5"
          maxlength={BRIEF_MAX_LENGTH}
          class="w-full max-h-[min(30vh,14rem)] px-3 py-2.5 rounded-lg text-base leading-snug resize-none outline-none op-scroll border border-[var(--color-input-border)] focus:border-[var(--color-accent)] focus:shadow-[0_0_0_3px_var(--color-accent-subtle)]"
          style="background:var(--color-input-bg);color:var(--color-input-text)"
          placeholder={$t('chrome.assistant.brief.placeholder')}
          aria-label={$t('chrome.assistant.brief.title')}
        ></textarea>
        <div class="flex items-center gap-2 flex-wrap">
          <button class="op-btn is-primary" disabled={locked} onclick={save}>{$t('chrome.assistant.brief.save')}</button>
          <button class="op-btn is-outline" onclick={() => editing = false}>{$t('chrome.assistant.brief.cancel')}</button>
          {#if locked}<span class="text-xs" style="color:var(--color-text-muted)">{$t($assistant.busy ? 'chrome.assistant.brief.busy' : 'chrome.assistant.brief.locked')}</span>{/if}
        </div>
      {:else}
        {#if brief}
          <div class="max-h-[min(30vh,14rem)] op-scroll text-sm leading-snug whitespace-pre-wrap break-words" style="color:var(--color-text)" data-brief-text>{brief}</div>
        {:else}
          <p class="text-xs leading-snug" style="color:var(--color-text-muted)">{$t('chrome.assistant.brief.hint')}</p>
        {/if}
        <div class="flex items-center gap-2 flex-wrap">
          <button class="op-btn is-outline" disabled={locked} onclick={edit}><Icon name="pencil" size={16} /><span>{$t(brief ? 'chrome.assistant.brief.edit' : 'chrome.assistant.brief.add')}</span></button>
          {#if locked}<span class="text-xs" style="color:var(--color-text-muted)">{$t($assistant.busy ? 'chrome.assistant.brief.busy' : 'chrome.assistant.brief.locked')}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
