<script lang="ts">
  /**
   * SectionView — the open section (spec §5.4), drawn over the plan like ElevationView:
   * cut walls and slabs filled, what lies beyond outlined, ceilings dashed, dimensions.
   * Read-only; it follows every project change live. Drag to pan, pinch / scroll to zoom,
   * double-tap to fit. The header steps through the sections, turns the view round,
   * exports SVG or PDF and goes back to the plan (as does Escape).
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { t, locale } from '$lib/i18n';
  import { prefersTouch } from '$lib/utils/inputDevice';
  import { currentProject, openSectionId, selectedElementId, selectedElementIds, selectedRoomId, flipSection } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { computeSection } from '$lib/utils/sectionCut';
  import { fittedTextScale, sectionSvg, type SectionTheme } from '$lib/utils/sectionSvg';
  import { exportSectionPDF, exportSectionSVG } from '$lib/utils/export';
  import { listenSideViewKeys } from '$lib/utils/sideViewKeys';
  import Icon from '$lib/components/chrome/Icon.svelte';

  // The store edits the project in place: count its updates so the drawing follows each one.
  let revision = $state(0);
  const stopProject = currentProject.subscribe(() => { revision++; });
  onDestroy(stopProject);

  let sections = $derived.by(() => { void revision; return [...(get(currentProject)?.sections ?? [])]; });
  let index = $derived(sections.findIndex(s => s.id === $openSectionId));
  let section = $derived(index >= 0 ? { ...sections[index] } : null);
  let units = $derived($projectSettings.units);
  let title = $derived(section ? $t('sectionView.title', { code: section.code }) : '');

  let model = $derived.by(() => {
    void revision;
    const project = get(currentProject);
    return project && section ? computeSection(project, section) : null;
  });

  // The open section was deleted (or undone away): back to the plan.
  $effect(() => {
    if ($openSectionId && $currentProject && index < 0) openSectionId.set(null);
  });

  // Light or dark, following the app (html.dark).
  let theme = $state<SectionTheme>(typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  $effect(() => {
    const root = document.documentElement;
    const read = () => { theme = root.classList.contains('dark') ? 'dark' : 'light'; };
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    read();
    return () => observer.disconnect();
  });

  // ── Drawing, fitted to the box; 1 annotation unit = 1 px at the fitted zoom ──
  let cw = $state(0);
  let ch = $state(0);
  let labels = $derived({ title, empty: $t('sectionView.empty') });
  let svg = $derived.by(() => {
    if (!model || cw < 40 || ch < 40) return '';
    const textScale = fittedTextScale(model, { units, labels }, cw, ch);
    return sectionSvg(model, { units, labels, theme, textScale, width: '100%', height: '100%' });
  });

  // ── Pan and zoom: the drawing box is cw·k × ch·k px at (tx, ty) ──
  const MIN_ZOOM = 0.5, MAX_ZOOM = 24;
  let k = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  function fit() { k = 1; tx = 0; ty = 0; }
  // A different section starts fitted.
  $effect(() => { void $openSectionId; fit(); });

  function zoomAt(px: number, py: number, factor: number) {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k * factor));
    const f = next / k;
    tx = px - (px - tx) * f;
    ty = py - (py - ty) * f;
    k = next;
  }

  let area = $state<HTMLDivElement | null>(null);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; mx: number; my: number } | null = null;
  let lastTap = { time: 0, x: 0, y: 0 };
  let downAt = { time: 0, x: 0, y: 0, moved: false };
  let grabbing = $state(false);

  const local = (e: PointerEvent | WheelEvent) => {
    const r = area!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  function onPointerDown(e: PointerEvent) {
    if (!area || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    area.focus({ preventScroll: true });
    area.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) pinch = pinchState();
    if (pointers.size === 1) downAt = { time: performance.now(), x: p.x, y: p.y, moved: false };
    else downAt.moved = true;
    grabbing = true;
  }

  function onPointerMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (Math.hypot(p.x - downAt.x, p.y - downAt.y) > 8) downAt.moved = true;
    if (pointers.size >= 2 && pinch) {
      const next = pinchState();
      tx += next.mx - pinch.mx;
      ty += next.my - pinch.my;
      zoomAt(next.mx, next.my, next.dist / pinch.dist);
      pinch = next;
    } else if (pointers.size === 1) {
      tx += p.x - prev.x;
      ty += p.y - prev.y;
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { area?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      grabbing = false;
      // A double tap (or double click) fits the drawing again.
      const now = performance.now();
      if (e.type === 'pointerup' && !downAt.moved && now - downAt.time < 300) {
        if (now - lastTap.time < 350 && Math.hypot(downAt.x - lastTap.x, downAt.y - lastTap.y) < 24) {
          fit();
          lastTap = { time: 0, x: 0, y: 0 };
        } else {
          lastTap = { time: now, x: downAt.x, y: downAt.y };
        }
      }
    }
  }

  // Wheel and trackpad pinch zoom about the pointer (needs a non-passive listener).
  $effect(() => {
    const el = area;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // ── Header actions ──
  function showSection(id: string) {
    openSectionId.set(id);
    selectedElementId.set(id);
    selectedElementIds.set(new Set());
    selectedRoomId.set(null);
  }
  function cycle(step: 1 | -1) {
    if (sections.length < 2 || index < 0) return;
    showSection(sections[(index + step + sections.length) % sections.length].id);
  }
  function close() {
    exportOpen = false;
    openSectionId.set(null);
  }

  let exportOpen = $state(false);
  let exportButton = $state<HTMLButtonElement | null>(null);
  let exportMenu = $state<HTMLDivElement | null>(null);
  function exportAs(format: 'svg' | 'pdf') {
    exportOpen = false;
    const project = get(currentProject);
    if (!project || !section) return;
    if (format === 'svg') exportSectionSVG(project, section, get(locale));
    else exportSectionPDF(project, section, get(locale));
  }
  // The export menu closes on Escape and on a press outside it.
  $effect(() => {
    if (!exportOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exportOpen = false; exportButton?.focus(); } };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!exportMenu?.contains(target) && !exportButton?.contains(target)) exportOpen = false;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  });

  // Escape returns to the plan (after an open menu has taken it).
  $effect(() => {
    if (!$openSectionId) return;
    return listenSideViewKeys(close);
  });
</script>

{#if section}
  <!-- Fills the screen under the floating chrome, like the wall elevation; the header sits where the plan tools were. -->
  <div class="absolute inset-0 z-20 flex flex-col" style="background:var(--color-surface)" data-section-view>
    <div class="absolute top-4 max-[1150px]:top-[80px] left-1/2 -translate-x-1/2 z-40 op-float op-cluster max-w-[calc(100vw-1rem)]" data-section-header>
      <button class="op-btn is-square" onclick={() => cycle(-1)} disabled={sections.length < 2} title={$t('sectionView.previous')} aria-label={$t('sectionView.previous')}>
        <Icon name="chevronLeft" />
      </button>
      <div class="flex flex-col items-center px-2 min-w-[7.5rem]">
        <span class="text-sm font-semibold whitespace-nowrap" style="color:var(--color-text-strong)">{title}</span>
        {#if sections.length > 1}
          <span class="text-xs tabular-nums" style="color:var(--color-text-muted)">{$t('sectionView.count', { index: index + 1, count: sections.length })}</span>
        {/if}
      </div>
      <button class="op-btn is-square" onclick={() => cycle(1)} disabled={sections.length < 2} title={$t('sectionView.next')} aria-label={$t('sectionView.next')}>
        <Icon name="chevronRight" />
      </button>
      <span class="op-divider-v"></span>
      <button class="op-btn is-square" onclick={() => flipSection(section.id)} title={$t('sectionView.flip')} aria-label={$t('sectionView.flip')}>
        <Icon name="lookFlip" />
      </button>
      <div class="relative">
        <button bind:this={exportButton} class="op-btn is-square" aria-haspopup="menu" aria-expanded={exportOpen} onclick={() => (exportOpen = !exportOpen)} title={$t('sectionView.export')} aria-label={$t('sectionView.export')}>
          <Icon name="download" />
        </button>
        {#if exportOpen}
          <div bind:this={exportMenu} class="op-popover op-menu absolute right-0 top-[calc(100%+8px)] min-w-[14rem] z-50" role="menu" data-popup="menu">
            <button class="op-menu-item" role="menuitem" onclick={() => exportAs('svg')}>{$t('sectionView.exportSvg')}</button>
            <button class="op-menu-item" role="menuitem" onclick={() => exportAs('pdf')}>{$t('sectionView.exportPdf')}</button>
          </div>
        {/if}
      </div>
      <span class="op-divider-v"></span>
      <button class="op-btn is-square" onclick={close} title={$t('sectionView.close')} aria-label={$t('sectionView.close')}>
        <Icon name="close" />
      </button>
    </div>
    <div class="absolute top-[72px] max-[1150px]:top-[136px] left-1/2 -translate-x-1/2 z-30 op-pill pointer-events-none max-sm:hidden whitespace-nowrap">{$t(prefersTouch() ? 'sectionView.help.touch' : 'sectionView.help')}</div>

    <!-- Drawing area: focused only by pressing it (not a Tab stop), so it draws no focus ring -->
    <div
      bind:this={area}
      bind:clientWidth={cw}
      bind:clientHeight={ch}
      class="flex-1 min-h-0 relative mt-[120px] max-[1150px]:mt-[176px] mb-[84px] mx-[84px] max-sm:mx-2 overflow-hidden touch-none select-none outline-none rounded-xl"
      style="cursor:{grabbing ? 'grabbing' : 'grab'}"
      role="img"
      aria-label={`${$t('sectionView.drawing')}: ${title}`}
      tabindex="-1"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      onlostpointercapture={onPointerUp}
    >
      <div class="section-drawing absolute pointer-events-none" style="left:{tx}px; top:{ty}px; width:{cw * k}px; height:{ch * k}px">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- built by sectionSvg, every string escaped -->
        {@html svg}
      </div>
    </div>
  </div>
{/if}

<style>
  .section-drawing :global(svg) { display: block; width: 100%; height: 100%; }
</style>
