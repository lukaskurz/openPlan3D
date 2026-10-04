<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { projectServiceMessage } from '$lib/i18n/projectServiceMessages';
  import { CaptureImportError } from '$lib/i18n/captureImportError';
  import { modalDialog, hasOpenModal } from '$lib/utils/modalDialog';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { base } from '$app/paths';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { reportLoadingFailure } from '$lib/services/deployment';
  import { currentProject, viewMode, selectedElementId, selectedRoomId, createDefaultProject, loadProject, elevationWallId, elevationPickMode } from '$lib/stores/project';
  import { localStore, storageErrorMessage, downloadLibraryBackup } from '$lib/services/datastore';
  import { autoSave, markClean, saveState } from '$lib/stores/saveStatus';
  import { createProjectFromRoomPlan, isRoomPlanJson } from '$lib/utils/roomplanImport';
  import FloorPlanCanvas from '$lib/components/editor/FloorPlanCanvas.svelte';
  import CommandPalette from '$lib/components/editor/CommandPalette.svelte';
  import ElevationView from '$lib/components/editor/ElevationView.svelte';
  import OnboardingTooltip from '$lib/components/OnboardingTooltip.svelte';
  import EditorChrome from '$lib/components/chrome/EditorChrome.svelte';
  import { dialog, elementsListOpen } from '$lib/stores/chrome';
  import { triggerTip } from '$lib/stores/onboarding.svelte';

  let commandPaletteOpen = $state(false);

  // Lazy-load ThreeViewer to avoid loading Three.js (~1.4MB) until 3D mode is activated
  let ThreeViewer: any = $state(null);
  $effect(() => {
    if (mode === '3d' && !ThreeViewer) {
      import('$lib/components/viewer3d/ThreeViewer.svelte').then(m => { ThreeViewer = m.default; }).catch(() => {
        viewMode.set('2d');
        reportLoadingFailure();
      });
    }
  });

  let mode = $state<'2d' | '3d'>('2d');
  let ready = $state(false);
  let showHelp = $state(false);
  let shortcutCopyState = $state<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  let shortcutCopyGeneration = 0;
  $effect(() => {
    showHelp;
    shortcutCopyGeneration++;
    shortcutCopyState = 'idle';
  });
  // The menu drawer's Help opens the shortcuts sheet.
  $effect(() => {
    if ($dialog === 'help') { showHelp = true; dialog.set(null); }
  });

  // iOS capture handoff (?import=CODE → fetch RoomPlan JSON from Firebase Storage inbox)
  let importingCapture = $state(false);
  let importError = $state<string | CaptureImportError | null>(null);
  let loadError = $state<string | null>(null);

  async function backupLibrary() {
    try { await downloadLibraryBackup(); }
    catch (error) { loadError = storageErrorMessage(error); }
  }

  /** Fetch a RoomPlan capture uploaded by the iOS app and open it as a new project. Returns true on success. */
  async function importCaptureFromCode(code: string): Promise<boolean> {
    importingCapture = true;
    try {
      const url = `https://firebasestorage.googleapis.com/v0/b/openplan3d.firebasestorage.app/o/inbox%2F${code}.json?alt=media`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        throw new CaptureImportError('captureImport.network');
      }
      if (res.status === 404) {
        throw new CaptureImportError('captureImport.missing', { code });
      }
      if (!res.ok) {
        throw new CaptureImportError('captureImport.http', { status: res.status });
      }
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new CaptureImportError('captureImport.json');
      }
      if (!isRoomPlanJson(data)) {
        throw new CaptureImportError('captureImport.format');
      }
      const project = createProjectFromRoomPlan(data, `Room Capture ${code}`);
      loadProject(project);
      // A storage failure must not discard a successfully downloaded capture.
      await autoSave();
      // Remove ?import=CODE so a refresh doesn't re-import
      replaceState(`${base}/editor?id=${project.id}`, page.state);
      return true;
    } catch (e: any) {
      importError = e instanceof CaptureImportError ? e : e?.message ?? new CaptureImportError('captureImport.fallback');
      return false;
    } finally {
      importingCapture = false;
    }
  }

  viewMode.subscribe((m) => {
    mode = m;
    if (m === '3d') {
      // Clear selection when entering 3D — start in view-only mode
      selectedElementId.set(null);
      selectedRoomId.set(null);
      elevationPickMode.set(false);
      // Onboarding tip for first 3D view
      triggerTip('first-3d', 200, 80);
    }
  });

  async function initializeEditor() {
    loadError = null;
    try {
      const url = new URL(window.location.href);

      // iOS capture handoff: ?import=CODE
      const rawCode = url.searchParams.get('import');
      if (rawCode) {
        const code = rawCode.toUpperCase();
        if (/^[A-Z2-9]{4,32}$/.test(code)) {
          if (await importCaptureFromCode(code)) {
            ready = true;
            return;
          }
          // Import failed — fall through to the normal load flow (error shown via toast)
        } else {
          importError = new CaptureImportError('captureImport.code');
        }
      }

      const id = url.searchParams.get('id');
      if (id) {
        // A new/imported project may exist only in memory if its first save failed.
        const pending = get(currentProject);
        if (pending?.id === id && get(saveState) !== 'saved') { ready = true; return; }
        const project = await localStore.load(id);
        if (project) {
          loadProject(project);
          markClean();
        } else {
          const p = createDefaultProject();
          loadProject(p);
          await autoSave();
          replaceState(`${base}/editor?id=${p.id}`, page.state);
        }
      } else {
        const p = createDefaultProject();
        loadProject(p);
        await autoSave();
        replaceState(`${base}/editor?id=${p.id}`, page.state);
      }
      ready = true;
    } catch (error) {
      loadError = storageErrorMessage(error);
    }
  }

  onMount(() => {
    void initializeEditor();
    // Imports can replace the active project from either sidebar or toolbar.
    // Keep reloads pointed at that project once initial route loading is complete.
    const stopSyncProjectUrl = currentProject.subscribe((project) => {
      if (!ready || !project) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('id') === project.id) return;
      url.searchParams.delete('import');
      url.searchParams.set('id', project.id);
      replaceState(url, page.state);
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (get(saveState) !== 'saved') {
        void autoSave();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden && get(saveState) === 'unsaved') void autoSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopSyncProjectUrl();
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });
  function onEditorKeydown(e: KeyboardEvent) {
    if (hasOpenModal()) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'p' && mod) { e.preventDefault(); dialog.set('print'); }
    if ((e.key === 'k' && mod) || (e.key === '/' && !mod && !e.altKey && !typing)) {
      e.preventDefault(); commandPaletteOpen = !commandPaletteOpen;
    }
    if (e.key === '?' && !mod && !e.altKey && !typing) { showHelp = !showHelp; e.preventDefault(); }
    if (e.key === 'Escape' && showHelp) showHelp = false;
    if (e.key === 'l' && !mod && !e.altKey && !typing) elementsListOpen.update(v => !v);
  }
</script>

<svelte:window on:keydown={onEditorKeydown} />

{#if ready}
  <!-- The plan fills the screen; every control floats over it. -->
  <div class="h-dvh overflow-hidden relative isolate" style="background:var(--canvas-bg, #f8f9fa)">
    {#if mode === '2d'}
      <FloorPlanCanvas />
      {#if $elevationWallId}
        <ElevationView />
      {/if}
    {:else}
      {#if ThreeViewer}
        <ThreeViewer />
      {:else}
        <div class="flex items-center justify-center h-full text-slate-400">{$t('shortcuts.loading3d')}</div>
      {/if}
    {/if}
    <EditorChrome />
  </div>

  <!-- Shortcuts overlay -->
  {#if showHelp}
    <dialog use:modalDialog class="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={(e) => { if (e.target === e.currentTarget) showHelp = false; }} oncancel={(e) => { e.preventDefault(); showHelp = false; }} onkeydown={(e) => { if (e.key === '?') { e.preventDefault(); showHelp = false; } }} aria-label={$t('shortcuts.title')}>
      <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"/></svg>
            <h2 class="text-lg font-bold text-slate-800">{$t('shortcuts.title')}</h2>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 transition-colors flex items-center gap-1.5"
              disabled={shortcutCopyState === 'copying'}
              onclick={async () => {
                const generation = ++shortcutCopyGeneration;
                shortcutCopyState = 'copying';
                const text = [
                  $t('shortcuts.title') + ' — Open3D Floorplan',
                  '',
                  '── ' + $t('shortcuts.tools') + ' ──',
                  "V          " + $t('shortcuts.select'),
                  "W          " + $t('shortcuts.wall'),
                  "D          " + $t('shortcuts.door'),
                  "H          " + $t('shortcuts.pan'),
                  "M          " + $t('shortcuts.measure'),
                  "N          " + $t('shortcuts.annotate'),
                  "T          " + $t('shortcuts.text'),
                  "S          " + $t('shortcuts.snap'),
                  "⌘/Ctrl     " + $t('shortcuts.freeMove'),
                  '',
                  '── ' + $t('shortcuts.edit') + ' ──',
                  "Ctrl+Z     " + $t('shortcuts.undo'),
                  "Ctrl+Y     " + $t('shortcuts.redo'),
                  "Ctrl+C     " + $t('shortcuts.copy'),
                  "Ctrl+V     " + $t('shortcuts.paste'),
                  "Ctrl+A     " + $t('shortcuts.selectAll'),
                  "Ctrl+D     " + $t('shortcuts.deselectAll'),
                  "Ctrl+S     " + $t('shortcuts.save'),
                  "Esc        " + $t('shortcuts.cancel'),
                  '',
                  '── ' + $t('shortcuts.elements') + ' ──',
                  "R          " + $t('shortcuts.rotate'),
                  "Del/Back   " + $t('shortcuts.delete'),
                  "Ctrl+L     " + $t('shortcuts.lock'),
                  "Ctrl+G     " + $t('shortcuts.group'),
                  "Ctrl+\u21e7+G   " + $t('shortcuts.ungroup'),
                  '',
                  '── ' + $t('shortcuts.view') + ' ──',
                  "Tab        " + $t('shortcuts.mode'),
                  "F          " + $t('shortcuts.fit'),
                  "G          " + $t('shortcuts.grid'),
                  "L          " + $t('shortcuts.layers'),
                  "?          " + $t('shortcuts.show'),
                  '',
                  '── ' + $t('shortcuts.canvas') + ' ──',
                  $t('shortcuts.scroll') + ' ' + $t('shortcuts.zoom'),
                  "+/-        " + $t('shortcuts.zoom'),
                  $t('shortcuts.spaceDrag') + ' ' + $t('shortcuts.panCanvas'),
                  '',
                  '── ' + $t('shortcuts.walls') + ' ──',
                  $t('shortcuts.doubleClick') + ' ' + $t('shortcuts.finishWall'),
                  "C          " + $t('shortcuts.closeWall'),
                ].join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                  if (generation === shortcutCopyGeneration) shortcutCopyState = 'copied';
                } catch {
                  if (generation === shortcutCopyGeneration) shortcutCopyState = 'failed';
                }
              }}
              aria-label={$t('shortcuts.copyLabel')}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              {$t('shortcuts.copyAll')}
            </button>
            <button class="text-gray-400 hover:text-gray-600 text-xl leading-none" onclick={() => showHelp = false} aria-label={$t('shortcuts.close')}>✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="overflow-y-auto px-6 py-4">
          <div class="grid grid-cols-2 gap-x-8 gap-y-0 text-sm">
            <!-- Left column -->
            <div>
              <!-- Tools -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-indigo-500">{$t('shortcuts.tools')}</span>
                <div class="flex-1 h-px bg-indigo-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.select')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">V</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.wall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">W</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.door')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">D</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.pan')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">H</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.measure')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">M</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.annotate')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">N</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.text')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">T</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.snap')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">S</kbd></div>
                <div class="flex justify-between gap-2"><span class="text-gray-600">{$t('shortcuts.freeMove')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200 whitespace-nowrap">⌘/Ctrl</kbd></div>
              </div>

              <!-- Edit -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-amber-500">{$t('shortcuts.edit')}</span>
                <div class="flex-1 h-px bg-amber-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.undo')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+Z</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.redo')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+Y</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.copy')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+C</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.paste')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+V</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.selectAll')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+A</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.deselectAll')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+D</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.save')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+S</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.cancel')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Esc</kbd></div>
              </div>
            </div>

            <!-- Right column -->
            <div>
              <!-- Elements -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-emerald-500">{$t('shortcuts.elements')}</span>
                <div class="flex-1 h-px bg-emerald-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.rotate')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">R</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.delete')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Del</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.lock')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+L</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.group')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+G</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.ungroup')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+⇧+G</kbd></div>
              </div>

              <!-- View -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-blue-500">{$t('shortcuts.view')}</span>
                <div class="flex-1 h-px bg-blue-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.mode')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Tab</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.fit')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">F</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.grid')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">G</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.layers')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">L</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.show')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">?</kbd></div>
              </div>

              <!-- Canvas -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-purple-500">{$t('shortcuts.canvas')}</span>
                <div class="flex-1 h-px bg-purple-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.zoom')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.scroll')}</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.zoom')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">+ / −</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.panCanvas')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.spaceDrag')}</kbd></div>
              </div>

              <!-- Walls -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-rose-500">{$t('shortcuts.walls')}</span>
                <div class="flex-1 h-px bg-rose-100"></div>
              </div>
              <div class="space-y-1.5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.finishWall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.doubleClick')}</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.closeWall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">C</kbd></div>
              </div>
            </div>
          </div>
        </div>

        {#if shortcutCopyState !== 'idle'}
          <p role="status" class="px-6 py-2 text-xs text-slate-600">{$t(`shortcuts.${shortcutCopyState}`)}</p>
        {/if}

        <!-- Footer -->
        <div class="px-6 py-3 border-t border-gray-100 text-center">
          <p class="text-xs text-gray-400">{$t('shortcuts.footer')}</p>
        </div>
      </div>
    </dialog>
  {/if}

  <CommandPalette bind:open={commandPaletteOpen} />
  <OnboardingTooltip />
{:else}
  <div class="h-screen flex flex-col items-center justify-center gap-3">
    {#if loadError}
      <p role="alert" class="max-w-lg px-6 text-center text-red-700">{projectServiceMessage(loadError, $locale)}</p>
      <button class="text-blue-700 underline" onclick={initializeEditor}>{$t('library.retry')}</button>
      <button class="text-blue-700 underline" onclick={backupLibrary}>{$t('library.backup')}</button>
      <a class="text-blue-700 underline" href={`${base}/`}>{$t('editorRecovery.back')}</a>
    {:else if importingCapture}
      <div class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
      <p class="text-gray-400">{$t('editorRecovery.importing')}</p>
    {:else}
      <p class="text-gray-400">{$t('editorRecovery.loading')}</p>
    {/if}
  </div>
{/if}

<!-- iOS capture import error toast -->
{#if importError}
  <div class="fixed top-16 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-2rem)] max-w-md bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3" role="alert">
    <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
    <div class="flex-1 text-sm">
      <p class="font-semibold">{$t('editorRecovery.failed')}</p>
      <p>{importError instanceof CaptureImportError ? $t(importError.key, importError.variables) : importError}</p>
    </div>
    <button class="text-red-400 hover:text-red-600 text-lg leading-none" onclick={() => importError = null} aria-label={$t('editorRecovery.dismiss')}>✕</button>
  </div>
{/if}
