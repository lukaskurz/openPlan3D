<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { selectedElementId, selectedElementIds, selectedRoomId, selectedTool, viewMode } from '$lib/stores/project';
  import { inspectorOpen, inspectorFocus, floorView, catalogOpen, assistantOpen } from '$lib/stores/chrome';
  import PropertiesPanel from '$lib/components/sidebar/PropertiesPanel.svelte';
  import Icon from './Icon.svelte';
  import { planInsetBottom } from '$lib/stores/planView';

  let hasContent = $state(false);
  let showBackground = $derived($inspectorFocus === 'background');
  let visible = $derived($inspectorOpen && hasContent && $selectedElementIds.size < 2 && $selectedTool === 'select' && !$catalogOpen && !$assistantOpen);

  let title = $derived.by((): TranslationKey => {
    const floor = $floorView;
    const id = $selectedElementId;
    if (showBackground && !id && !$selectedRoomId) return 'backgroundProperties.heading';
    if (!floor) return 'chrome.inspector.title';
    if ($selectedRoomId && !id) return 'chrome.inspector.room';
    if (floor.walls.some(w => w.id === id)) return 'chrome.inspector.wall';
    if (floor.doors.some(d => d.id === id)) return 'chrome.inspector.door';
    if (floor.windows.some(w => w.id === id)) return 'chrome.inspector.window';
    if (floor.furniture.some(f => f.id === id)) return 'chrome.inspector.furniture';
    return 'chrome.inspector.title';
  });

  // Report how much of the plan a bottom sheet covers; the wide layout docks beside the plan instead.
  let sheet: HTMLElement | undefined = $state();
  $effect(() => {
    const el = sheet, open = visible;
    if (!el || !open) { planInsetBottom.set(0); return; }
    const report = () => {
      const bottomSheet = el.offsetHeight > 0 && el.offsetWidth > window.innerWidth * 0.6;
      // offsetTop ignores the entry animation's transform, so this is where the sheet settles.
      planInsetBottom.set(bottomSheet ? Math.max(0, window.innerHeight - el.offsetTop) : 0);
    };
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('resize', report);
    report();
    return () => { observer.disconnect(); window.removeEventListener('resize', report); planInsetBottom.set(0); };
  });

  function close() {
    inspectorOpen.set(false);
    inspectorFocus.set(null);
  }
</script>

<!-- Kept mounted so the panel can report whether it has content. -->
<aside
  bind:this={sheet}
  class="op-float op-inspector fixed z-[25] flex flex-col overflow-hidden {visible ? 'op-enter' : 'hidden'}"
  aria-label={$t(title)}
  data-inspector
>
  <div class="flex items-center gap-3 pl-4 pr-2 py-2 shrink-0" style="border-bottom:1px solid var(--color-border-subtle)">
    <div class="flex-1 min-w-0 text-base font-semibold truncate" style="color:var(--color-text-strong)">{$t(title)}</div>
    <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={close}><Icon name="close" /></button>
  </div>
  <div class="flex-1 min-h-0 op-scroll">
    <PropertiesPanel is3D={$viewMode === '3d'} floating {showBackground} bind:hasContent />
  </div>
</aside>
