<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import { t, type TranslationKey } from '$lib/i18n';
  import { currentProject, updateProjectName } from '$lib/stores/project';
  import { lastSavedAt, saveState, capturePlanThumbnail } from '$lib/stores/saveStatus';
  import { downloadLibraryBackup, storageErrorMessage } from '$lib/services/datastore';
  import { drawerOpen, dialog } from '$lib/stores/chrome';
  import { importProjectFile, newProject, traceImage, exportAs } from './actions';
  import Icon, { type IconName } from './Icon.svelte';

  let { onerror }: { onerror: (message: string) => void } = $props();

  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());

  let importOpen = $state(false);
  let renaming = $state(false);
  let nameValue = $state('');
  let nameInput: HTMLInputElement | undefined = $state();
  let thumbnail = $state<string | undefined>();

  $effect(() => {
    if (!$drawerOpen) { importOpen = false; renaming = false; return; }
    thumbnail = capturePlanThumbnail(120, 0.7);
  });

  let alternativeName = $derived(($currentProject?.alternatives ?? []).find(alt => alt.id === $currentProject?.activeAlternativeId)?.name);
  let savedText = $derived($saveState === 'saved' && $lastSavedAt
    ? $t('chrome.drawer.savedAt', { time: $lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
    : $t(`chrome.save.${$saveState}`));

  function close() { drawerOpen.set(false); }
  function open(name: Exclude<typeof $dialog, null>) { close(); dialog.set(name); }

  async function startRename() {
    nameValue = $currentProject?.name ?? '';
    renaming = true;
    await tick();
    nameInput?.select();
  }
  function commitRename() {
    if (renaming && nameValue.trim()) updateProjectName(nameValue.trim());
    renaming = false;
  }

  async function guarded(action: () => Promise<void>) {
    close();
    try { await action(); }
    catch (error) { onerror(error instanceof Error ? error.message : String(error)); }
  }

  function onKeydown(e: KeyboardEvent) {
    if ($drawerOpen && e.key === 'Escape' && !renaming) { e.stopPropagation(); close(); }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet item(icon: IconName, label: TranslationKey, sub: TranslationKey | null, onclick: () => void, chevron = false)}
  <button class="op-menu-item" onclick={onclick}>
    <Icon name={icon} size={20} />
    <span class="flex-1 min-w-0">{$t(label)}{#if sub}<span class="op-sub">{$t(sub)}</span>{/if}</span>
    {#if chevron}<Icon name="chevronRight" size={18} />{/if}
  </button>
{/snippet}

{#if $drawerOpen}
  <div class="op-scrim z-[60]" onclick={close} aria-hidden="true"></div>
  <aside class="op-float op-slide-left fixed z-[61] left-[var(--chrome-inset)] top-[var(--chrome-inset)] bottom-[var(--chrome-inset)] w-[360px] max-w-[calc(100vw-1rem)] flex flex-col overflow-hidden" aria-label={$t('chrome.menu')} data-menu-drawer>
    <div class="flex items-center justify-between p-2 pl-1">
      <a class="op-btn" href={base || '/'}><Icon name="chevronLeft" size={18} />{$t('chrome.drawer.allProjects')}</a>
      <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={close}><Icon name="close" /></button>
    </div>
    <div class="flex items-center gap-3 px-4 pb-3">
      <div class="w-14 h-14 rounded-lg overflow-hidden shrink-0 flex items-center justify-center" style="border:1px solid var(--color-border);background:var(--color-surface-subtle)">
        {#if thumbnail}<img src={thumbnail} alt="" class="w-full h-full object-cover" />{:else}<Icon name="roomShape" class="opacity-40" />{/if}
      </div>
      {#if renaming}
        <div class="op-field flex-1 min-w-0">
          <input bind:this={nameInput} bind:value={nameValue} aria-label={$t('projectToolbar.name')} onblur={commitRename}
            onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') renaming = false; }} />
        </div>
      {:else}
        <div class="flex-1 min-w-0">
          <div class="text-base font-semibold truncate" style="color:var(--color-text-strong)">{$currentProject?.name}</div>
          <div class="text-xs truncate" style="color:var(--color-text-muted)">{alternativeName ? `${alternativeName} · ` : ''}{savedText}</div>
        </div>
        <button class="op-btn is-square" aria-label={$t('projectToolbar.rename')} onclick={startRename}><Icon name="pencil" size={18} /></button>
      {/if}
    </div>
    <div class="op-divider !mx-0"></div>

    <nav class="op-menu flex-1 op-scroll">
      {@render item('download', 'chrome.drawer.export', 'chrome.drawer.exportHint', () => open('export'), true)}
      {@render item('printer', 'chrome.drawer.print', 'chrome.drawer.printHint', () => open('print'))}
      {@render item('share', 'chrome.drawer.share', 'chrome.drawer.shareHint', () => open('assistant'))}
      <div class="op-divider"></div>
      {@render item('upload', 'chrome.drawer.import', 'chrome.drawer.importHint', () => importOpen = !importOpen, true)}
      {#if importOpen}
        <div class="pl-8 flex flex-col op-enter">
          {@render item('details', 'chrome.drawer.importFile', 'chrome.drawer.importFileHint', () => guarded(() => importProjectFile(lifetime.signal)))}
          {@render item('image', 'chrome.drawer.importImage', 'chrome.drawer.importImageHint', () => guarded(traceImage))}
          {@render item('plus', 'library.new', null, () => guarded(() => newProject(lifetime.signal)))}
        </div>
      {/if}
      {@render item('chart', 'chrome.drawer.area', 'chrome.drawer.areaHint', () => open('area'))}
      {@render item('history', 'versions.title', 'chrome.drawer.versionsHint', () => open('versions'))}
      <div class="op-divider"></div>
      {@render item('archive', 'chrome.drawer.backup', 'chrome.drawer.backupHint', () => guarded(() => exportAs('json')))}
      {@render item('projects', 'chrome.drawer.backupAll', 'chrome.drawer.backupAllHint', () => guarded(async () => {
        try { await downloadLibraryBackup(); } catch (error) { throw new Error(storageErrorMessage(error)); }
      }))}
      {@render item('settings', 'settings.title', null, () => open('settings'))}
      {@render item('help', 'chrome.drawer.help', 'chrome.drawer.helpHint', () => open('help'))}
    </nav>

    <div class="flex items-start gap-2.5 m-3 p-3 rounded-lg text-xs leading-snug" style="background:var(--color-surface-subtle);color:var(--color-text-tertiary)">
      <Icon name="info" size={18} class="shrink-0" />
      <span>{$t('chrome.drawer.localOnly')}</span>
    </div>
  </aside>
{/if}
