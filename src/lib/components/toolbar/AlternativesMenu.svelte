<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { currentProject, createAlternative, switchPlanAlternative, renamePlanAlternative, deletePlanAlternative } from '$lib/stores/project';
  import { capturePlanThumbnail } from '$lib/stores/saveStatus';
  import { tick } from 'svelte';
  import Icon from '$lib/components/chrome/Icon.svelte';

  /** `bare` drops the trigger's own card, for when it sits inside another one. */
  let { bare = false }: { bare?: boolean } = $props();

  let open = $state(false);
  let menuRef: HTMLDivElement | undefined = $state();
  let renamingId = $state<string | null>(null);
  let renameValue = $state('');
  let renameInput: HTMLInputElement | undefined = $state();
  /** Live picture of the alternative being edited, taken when the menu opens. */
  let liveThumbnail = $state<string | undefined>();

  // The store edits entries in place, so copy them to let renames and switches re-render.
  let alternatives = $derived(($currentProject?.alternatives ?? []).map(alt => ({ ...alt })));
  let activeId = $derived($currentProject?.activeAlternativeId);
  let activeName = $derived(alternatives.find(alt => alt.id === activeId)?.name);

  const THUMBNAIL_SIZE = 160;
  const nameFor = (letter: string) => $t('alternatives.defaultName', { letter });

  function toggle() {
    open = !open;
    renamingId = null;
    confirmingId = null;
    if (open) liveThumbnail = capturePlanThumbnail(THUMBNAIL_SIZE, 0.7);
  }

  // Pointer-down, not click: a click can remove its own target (e.g. the rename button) before this runs.
  function onWindowPointerDown(e: PointerEvent) {
    if (open && menuRef && !menuRef.contains(e.target as Node)) { open = false; renamingId = null; }
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape' && !renamingId) { open = false; e.stopPropagation(); }
  }

  function branch() {
    createAlternative({ thumbnail: capturePlanThumbnail(THUMBNAIL_SIZE, 0.7), nameFor });
    open = false;
  }

  function choose(id: string) {
    if (renamingId) return;
    if (id !== activeId) switchPlanAlternative(id, capturePlanThumbnail(THUMBNAIL_SIZE, 0.7));
    open = false;
  }

  async function startRename(id: string, name: string) {
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

  /** Alternative waiting for the person to confirm its deletion. */
  let confirmingId = $state<string | null>(null);
  function remove(id: string) {
    confirmingId = null;
    deletePlanAlternative(id);
    if (alternatives.length === 0) open = false;
  }

  function edited(date: Date) {
    const minutes = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
    if (minutes < 1) return $t('library.justNow');
    if (minutes < 60) return $t('library.minutes', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return $t('library.hours', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 7) return $t('library.days', { count: days });
    return new Date(date).toLocaleDateString($locale === 'pt' ? 'pt-BR' : 'en');
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="relative shrink-0" bind:this={menuRef}>
  <button
    onclick={toggle}
    class="{bare ? 'op-btn' : 'op-float op-btn is-big'} gap-1 pl-3.5 pr-2.5"
    title={$t('alternatives.title')}
    aria-label={$t('alternatives.title')}
    aria-expanded={open}
    aria-haspopup="menu"
  >
    <Icon name="branch" />
    <Icon name="chevronDown" size={16} />
  </button>

  {#if open}
    <div class="op-popover op-enter absolute left-0 top-full {bare ? 'mt-3' : 'mt-2'} w-[22rem] max-w-[calc(100vw-2rem)] z-50 overflow-hidden" role="menu">
      <div class="op-menu pb-0">
        <button class="op-menu-item" style="color:var(--color-accent-text)" onclick={branch} role="menuitem">
          <span class="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style="background:var(--color-accent-subtle)"><Icon name="plus" /></span>
          <span class="min-w-0">
            {$t('chrome.alternatives.add')}
            <span class="op-sub truncate">{activeName ? $t('chrome.alternatives.copies', { name: activeName }) : $t('alternatives.branch')}</span>
          </span>
        </button>
      </div>
      {#if !alternatives.length}
        <p class="px-4 pb-4 pt-1 text-xs leading-snug" style="color:var(--color-text-muted)">{$t('alternatives.intro')}</p>
      {:else}
        <div class="op-divider"></div>
        <div class="op-menu-title">{$t('alternatives.title')}</div>
        <ul class="op-scroll max-h-[min(24rem,60vh)] px-1.5 pb-1.5">
          {#each alternatives as alt (alt.id)}
            {@const active = alt.id === activeId}
            {@const picture = active ? liveThumbnail ?? alt.thumbnail : alt.thumbnail}
            <li class="flex items-center gap-1 rounded-lg" style={active ? 'background:var(--color-accent-subtle)' : ''}>
              {#snippet preview()}
                <div class="w-16 h-11 shrink-0 rounded-md overflow-hidden flex items-center justify-center" style="border:1px solid {active ? 'var(--color-accent-border)' : 'var(--color-border)'};background:var(--color-surface-subtle)">
                  {#if picture}
                    <img src={picture} alt="" class="w-full h-full object-cover" />
                  {:else}
                    <Icon name="roomShape" size={18} class="opacity-40" />
                  {/if}
                </div>
              {/snippet}
              {#if renamingId === alt.id}
                <div class="flex items-center gap-2.5 flex-1 min-w-0 p-1.5">
                  {@render preview()}
                  <div class="op-field flex-1 min-w-0">
                    <input bind:this={renameInput} bind:value={renameValue} onkeydown={onRenameKeydown} onblur={commitRename} aria-label={$t('alternatives.rename')} />
                  </div>
                </div>
              {:else if confirmingId === alt.id}
                <div class="flex items-center gap-2 flex-1 min-w-0 p-1.5">
                  <span class="flex-1 min-w-0 text-sm" style="color:var(--color-text-secondary)">{$t('alternatives.confirmDelete', { name: alt.name })}</span>
                  <button class="op-btn" onclick={() => confirmingId = null}>{$t('chrome.cancel')}</button>
                  <button class="op-btn is-danger" onclick={() => remove(alt.id)}>{$t('chrome.delete')}</button>
                </div>
              {:else}
                <button class="flex items-center gap-2.5 flex-1 min-w-0 text-left p-1.5 min-h-[56px]" onclick={() => choose(alt.id)} role="menuitem"
                  title={active ? $t('alternatives.editing') : $t('alternatives.switchTo', { name: alt.name })}>
                  {@render preview()}
                  <div class="min-w-0 flex-1">
                    <div class="text-sm font-semibold truncate" style="color:{active ? 'var(--color-accent-text-strong)' : 'var(--color-text-strong)'}">{alt.name}</div>
                    <div class="text-xs" style="color:{active ? 'var(--color-accent-text)' : 'var(--color-text-muted)'}">
                      {active ? $t('alternatives.editing') : $t('alternatives.edited', { time: edited(alt.updatedAt) })}
                    </div>
                  </div>
                </button>
                <button class="op-btn is-square shrink-0" title={$t('alternatives.rename')} aria-label={$t('alternatives.rename')} onclick={() => startRename(alt.id, alt.name)}>
                  <Icon name="pencil" size={18} />
                </button>
                {#if alternatives.length > 1}
                  <button class="op-btn is-square is-danger shrink-0" title={$t('alternatives.delete')} aria-label={$t('alternatives.delete')} onclick={() => confirmingId = alt.id}>
                    <Icon name="trash" size={18} />
                  </button>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
