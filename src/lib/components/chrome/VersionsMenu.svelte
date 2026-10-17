<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n';
  import { currentProject, createAlternative, switchPlanAlternative, renamePlanAlternative, deletePlanAlternative } from '$lib/stores/project';
  import { capturePlanThumbnail } from '$lib/stores/saveStatus';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import { alternativeCodes, nextAlternativeLetter } from '$lib/utils/planAlternatives';
  import type { Project } from '$lib/models/types';
  import Icon from './Icon.svelte';

  /**
   * The version button (branch icon, the current alternative's code, chevron) and
   * its Versions menu. Codes are derived from names and order until they are stored.
   */
  const THUMBNAIL_SIZE = 160;
  const NEW = '\u0000new';
  const nameFor = (letter: string) => $t('alternatives.defaultName', { letter });

  // The store edits entries in place, so copy them to let renames and switches re-render.
  let alternatives = $derived(($currentProject?.alternatives ?? []).map(alt => ({ ...alt })));
  let activeId = $derived($currentProject?.activeAlternativeId);
  /** Without alternatives the plan is implicitly the first one, "A". */
  let rows = $derived(alternatives.length ? alternatives : [{ id: '', name: $t('chrome.versions.thisPlan') }]);
  let codes = $derived(alternativeCodes(rows, nameFor));
  /** The code "New alternative" will get: it is named like `createAlternative` names it. */
  let newCode = $derived.by(() => {
    const before = alternatives.length ? alternatives : [{ id: '', name: nameFor('A') }];
    const name = nameFor(nextAlternativeLetter({ alternatives: before } as Project, nameFor));
    return alternativeCodes([...before, { id: NEW, name }], nameFor).get(NEW) ?? '';
  });
  let active = $derived(rows.find(alt => alt.id === (activeId ?? '')) ?? rows[0]);
  let activeCode = $derived(codes.get(active.id) ?? 'A');
  let open = $derived($popover === 'versions');

  let menuRef: HTMLDivElement | undefined = $state();
  let moreId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let confirmingId = $state<string | null>(null);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();

  $effect(() => { if (!open) { moreId = null; renamingId = null; confirmingId = null; } });

  // Pointer-down, not click: a click can remove its own target (e.g. the rename button) before this runs.
  function onWindowPointerDown(e: PointerEvent) {
    if (open && menuRef && !menuRef.contains(e.target as Node)) closePopover();
  }

  const thumbnail = () => capturePlanThumbnail(THUMBNAIL_SIZE, 0.7);

  function choose(id: string) {
    if (id && id !== activeId) switchPlanAlternative(id, thumbnail());
    closePopover();
  }

  function branch() {
    createAlternative({ thumbnail: thumbnail(), nameFor, name: $t('chrome.versions.copyName', { code: activeCode }) });
    closePopover();
  }

  function addNew() {
    createAlternative({ thumbnail: thumbnail(), nameFor });
    closePopover();
  }

  async function startRename(id: string, name: string) {
    moreId = null;
    renamingId = id;
    renameValue = name;
    await tick();
    renameInput?.select();
  }
  function commitRename() {
    if (renamingId) renamePlanAlternative(renamingId, renameValue);
    renamingId = null;
  }
  function onRenameKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') renamingId = null;
  }
  function remove(id: string) {
    confirmingId = null;
    deletePlanAlternative(id);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#snippet badge(code: string, current: boolean)}
  <span class="op-version-badge {current ? 'is-current' : ''}">{code}</span>
{/snippet}

<div class="relative shrink-0 h-full" bind:this={menuRef}>
  <button
    class="op-btn h-full gap-1.5 !pl-3 !pr-2"
    aria-label={$t('chrome.versions.button', { code: activeCode, name: active.name })}
    title={$t('chrome.versions.button', { code: activeCode, name: active.name })}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => togglePopover('versions')}
    data-version-button
  >
    <Icon name="branch" />
    {@render badge(activeCode, true)}
    <Icon name="chevronDown" size={16} />
  </button>

  {#if open}
    <div class="op-popover op-enter absolute left-0 top-full mt-3 w-[22rem] max-w-[calc(100vw-2rem)] z-50 overflow-hidden" role="menu" aria-label={$t('chrome.versions.title')} data-versions-menu>
      <div class="op-menu-title pt-3">{$t('chrome.versions.title')}</div>
      <ul class="op-scroll max-h-[min(24rem,55vh)] px-1.5 pb-1">
        {#each rows as alt (alt.id)}
          {@const current = alt === active}
          {@const code = codes.get(alt.id) ?? ''}
          <li class="flex items-center gap-1 rounded-lg" style={current ? 'background:var(--color-accent-subtle)' : ''}>
            {#if renamingId === alt.id}
              <div class="flex items-center gap-2.5 flex-1 min-w-0 p-1.5 min-h-[56px]">
                {@render badge(code, current)}
                <div class="op-field flex-1 min-w-0">
                  <input bind:this={renameInput} bind:value={renameValue} onkeydown={onRenameKeydown} onblur={commitRename} aria-label={$t('alternatives.rename')} />
                </div>
              </div>
            {:else if confirmingId === alt.id}
              <div class="flex items-center gap-2 flex-1 min-w-0 p-1.5 min-h-[56px]">
                <span class="flex-1 min-w-0 text-sm" style="color:var(--color-text-secondary)">{$t('alternatives.confirmDelete', { name: alt.name })}</span>
                <button class="op-btn" onclick={() => confirmingId = null}>{$t('chrome.cancel')}</button>
                <button class="op-btn is-danger" onclick={() => remove(alt.id)}>{$t('chrome.delete')}</button>
              </div>
            {:else if moreId === alt.id}
              <div class="flex items-center gap-1 flex-1 min-w-0 p-1.5 min-h-[56px]">
                {@render badge(code, current)}
                <span class="flex-1"></span>
                <button class="op-btn" onclick={() => startRename(alt.id, alt.name)}><Icon name="pencil" size={18} />{$t('alternatives.rename')}</button>
                {#if alternatives.length > 1}
                  <button class="op-btn is-square is-danger" title={$t('alternatives.delete')} aria-label={$t('alternatives.delete')} onclick={() => { moreId = null; confirmingId = alt.id; }}><Icon name="trash" size={18} /></button>
                {/if}
                <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={() => moreId = null}><Icon name="close" size={18} /></button>
              </div>
            {:else}
              <button class="flex items-center gap-3 flex-1 min-w-0 text-left p-1.5 pl-2.5 min-h-[56px]" role="menuitemradio" aria-checked={current} onclick={() => choose(alt.id)}
                title={current ? $t('alternatives.editing') : $t('alternatives.switchTo', { name: alt.name })} data-version={code}>
                {@render badge(code, current)}
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold truncate" style="color:{current ? 'var(--color-accent-text-strong)' : 'var(--color-text-strong)'}">{alt.name}</span>
                  {#if current}<span class="block text-xs" style="color:var(--color-accent-text)">{$t('alternatives.editing')}</span>{/if}
                </span>
              </button>
              {#if alt.id}
                <button class="op-btn is-square shrink-0" title={$t('chrome.versions.more', { name: alt.name })} aria-label={$t('chrome.versions.more', { name: alt.name })} onclick={() => moreId = alt.id}>
                  <Icon name="more" size={18} />
                </button>
              {/if}
            {/if}
          </li>
        {/each}
      </ul>
      {#if !alternatives.length}
        <p class="px-4 pb-2 text-xs leading-snug" style="color:var(--color-text-muted)">{$t('alternatives.intro')}</p>
      {/if}
      <div class="op-divider"></div>
      <div class="op-menu pt-0">
        <button class="op-menu-item" role="menuitem" onclick={branch} data-version-branch>
          <Icon name="branch" />
          <span class="min-w-0">
            {$t('chrome.versions.branch', { code: activeCode })}
            <span class="op-sub truncate">{$t('chrome.alternatives.copies', { name: active.name })}</span>
          </span>
        </button>
        <button class="op-menu-item" role="menuitem" onclick={addNew} data-version-new>
          <Icon name="plus" />
          <span class="min-w-0">
            {$t('chrome.versions.new', { code: newCode })}
            <span class="op-sub">{$t('chrome.versions.newSub')}</span>
          </span>
        </button>
      </div>
    </div>
  {/if}
</div>
