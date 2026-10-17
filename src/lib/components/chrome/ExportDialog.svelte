<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t, locale, type TranslationKey } from '$lib/i18n';
  import { get } from 'svelte/store';
  import { currentProject, openSectionId } from '$lib/stores/project';
  import { exportSectionPDF, exportSectionSVG } from '$lib/utils/export';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { dialog } from '$lib/stores/chrome';
  import { exportAs, type ExportFormat } from './actions';
  import Icon, { type IconName } from './Icon.svelte';

  let { onerror }: { onerror: (message: string) => void } = $props();

  const lifetime = new AbortController();
  onDestroy(() => lifetime.abort());

  const FORMATS: { id: ExportFormat; icon: IconName; label: TranslationKey; hint: TranslationKey; about: TranslationKey }[] = [
    { id: 'pdf', icon: 'details', label: 'chrome.export.pdf', hint: 'chrome.export.pdfHint', about: 'chrome.export.pdfAbout' },
    { id: 'png', icon: 'image', label: 'chrome.export.png', hint: 'chrome.export.pngHint', about: 'chrome.export.pngAbout' },
    { id: 'png3d', icon: 'cube', label: 'chrome.export.png3d', hint: 'chrome.export.png3dHint', about: 'chrome.export.png3dAbout' },
    { id: 'svg', icon: 'pencil', label: 'chrome.export.svg', hint: 'chrome.export.svgHint', about: 'chrome.export.svgAbout' },
    { id: 'dxf', icon: 'ruler', label: 'chrome.export.dxf', hint: 'chrome.export.dxfHint', about: 'chrome.export.dxfAbout' },
    { id: 'package', icon: 'archive', label: 'chrome.export.package', hint: 'chrome.export.packageHint', about: 'exportMenu.packageHelp' },
    { id: 'json', icon: 'download', label: 'chrome.export.json', hint: 'chrome.export.jsonHint', about: 'chrome.export.jsonAbout' },
  ];

  let chosen = $state<ExportFormat>('pdf');
  let format = $derived(FORMATS.find(f => f.id === chosen)!);
  let busy = $state(false);

  function close() { dialog.set(null); }

  // With a section open, PDF and SVG can also export just that section.
  let openSection = $derived($openSectionId ? $currentProject?.sections?.find(s => s.id === $openSectionId) ?? null : null);
  function runSection() {
    const project = get(currentProject);
    if (!project || !openSection) return;
    if (chosen === 'svg') exportSectionSVG(project, openSection, get(locale));
    else exportSectionPDF(project, openSection, get(locale));
    close();
  }

  async function run() {
    busy = true;
    try {
      await exportAs(chosen, lifetime.signal);
      close();
    } catch (error) {
      onerror(error instanceof Error ? error.message : String(error));
    } finally {
      busy = false;
    }
  }
</script>

<dialog use:modalDialog class="modal-overlay fixed inset-0 z-[70] flex items-center justify-center" style="background:var(--color-scrim)" aria-label={$t('exportMenu.title')}
  onclick={(e) => { if (e.target === e.currentTarget) close(); }} oncancel={(e) => { e.preventDefault(); close(); }}>
  <div class="op-popover op-enter w-[720px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden" data-export-dialog>
    <div class="flex items-center justify-between pl-5 pr-2 py-2" style="border-bottom:1px solid var(--color-border-subtle)">
      <h2 class="text-base font-semibold" style="color:var(--color-text-strong)">{$t('exportMenu.title')}</h2>
      <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={close}><Icon name="close" /></button>
    </div>
    <div class="flex max-sm:flex-col min-h-0 flex-1">
      <div class="op-menu w-[300px] max-sm:w-auto shrink-0 op-scroll" role="listbox" aria-label={$t('chrome.export.formats')}>
        {#each FORMATS as item}
          <button class="op-menu-item {chosen === item.id ? 'is-active' : ''}" role="option" aria-selected={chosen === item.id} onclick={() => chosen = item.id}>
            <span class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style="background:{chosen === item.id ? 'var(--color-accent)' : 'var(--color-surface-muted)'};color:{chosen === item.id ? 'var(--color-on-accent)' : 'var(--color-text-secondary)'}"><Icon name={item.icon} size={18} /></span>
            <span class="min-w-0">{$t(item.label)}<span class="op-sub">{$t(item.hint)}</span></span>
          </button>
        {/each}
        <p class="px-3 py-2 text-xs" style="color:var(--color-text-muted)">{$t('chrome.export.noDwg')}</p>
      </div>
      <div class="flex-1 flex flex-col gap-4 p-5 min-w-0" style="background:var(--color-surface-subtle)">
        <div class="text-sm font-semibold" style="color:var(--color-text-strong)">{$t(format.label)}</div>
        <p class="text-sm leading-relaxed" style="color:var(--color-text-tertiary)">{$t(format.about)}</p>
        <div class="flex-1"></div>
        <div class="flex gap-2 justify-end flex-wrap">
          {#if chosen === 'pdf'}
            <button class="op-btn is-outline" onclick={() => dialog.set('print')}><Icon name="printer" size={18} />{$t('chrome.export.printLayout')}</button>
          {/if}
          {#if openSection && (chosen === 'pdf' || chosen === 'svg')}
            <button class="op-btn is-outline" onclick={runSection} data-export-section>{$t('sectionView.exportThis', { code: openSection.code })}</button>
          {/if}
          <button class="op-btn is-primary" disabled={busy} onclick={run} data-export-run>{$t('chrome.export.run', { format: $t(format.label) })}</button>
        </div>
      </div>
    </div>
  </div>
</dialog>
