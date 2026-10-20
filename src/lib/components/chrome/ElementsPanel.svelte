<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import { t, locale } from '$lib/i18n';
  import { furnitureName, customModelName } from '$lib/i18n/furnitureNames';
  import { entourageLabels } from '$lib/i18n/entourageLabels';
  import { getEntourageDef } from '$lib/utils/entourageCatalog';
  import { currentProject, selectedElementId, selectedElementIds, selectedRoomId, detectedRoomsStore, layerVisibility } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { elementsListOpen, floorView, assistantOpen } from '$lib/stores/chrome';
  import { planViewApi, planInsetLeft, planInsetBottom } from '$lib/stores/planView';
  import { activeTrade, activeSurface } from '$lib/stores/workContext';
  import { sectionOnFloor } from '$lib/utils/sectionPlan';
  import { elementGroups, roomGroups, filterElementGroups, contextForElement, type ElementEntry, type ElementGroup, type ElementGroupKey } from '$lib/utils/elementsList';
  import { resolveRoomGeometry } from '$lib/utils/roomDetection';
  import type { Floor, Point, Room } from '$lib/models/types';
  import { switchSurface } from './surface';
  import { switchTrade, chooseGroup, toolGroup } from './tools';
  import Icon from './Icon.svelte';

  /**
   * Everything on the current storey, docked on the left of the plan: by room (each room with
   * what is in it, then walls, doors, windows and pipe runs on their own) or by kind (walls,
   * doors, furniture, lights, outlets, pipes, notes…). Tapping a row selects the element,
   * switching trade or surface when the current ones cannot select it, and brings it into
   * view; a selection made on the plan is scrolled to here.
   */

  let query = $state('');
  let collapsed = $state<Partial<Record<ElementGroupKey, boolean>>>({});

  /** By room or by type; each viewer's last choice is remembered. */
  type View = 'room' | 'type';
  const VIEW_KEY = 'o3d_elements_view';
  let view = $state<View>(readView());
  function readView(): View {
    try { return localStorage.getItem(VIEW_KEY) === 'type' ? 'type' : 'room'; } catch { return 'room'; }
  }
  function chooseView(next: View) {
    view = next;
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* storage unavailable */ }
  }
  let list: HTMLDivElement | undefined = $state();

  // The rooms with their outlines, traced again only when walls or saved rooms change. Ids follow
  // the plan's detected rooms, so a room picked here is the room the plan selects.
  let roomCache: { key: string; faces: { room: Room; polygon: Point[] }[] } | null = null;
  function roomFaces(floor: Floor, detected: Room[]) {
    const key = JSON.stringify([floor.id, floor.walls, floor.rooms, detected.map(room => room.id)]);
    if (roomCache?.key !== key) roomCache = { key, faces: resolveRoomGeometry(floor, detected) };
    return roomCache.faces;
  }
  let rooms = $derived($floorView ? roomFaces($floorView, $detectedRoomsStore) : []);

  let groups = $derived.by((): ElementGroup[] => {
    const floor = $floorView, project = $currentProject;
    if (!floor) return [];
    const language = $locale;
    return (view === 'room' ? roomGroups : elementGroups)(floor, {
      t: $t,
      units: $projectSettings.units,
      rooms,
      sections: (project?.sections ?? []).filter(section => sectionOnFloor(section, floor, project ?? undefined)),
      furnitureLabel: item => customModelName(item, project) ?? furnitureName(item.catalogId, language),
      entourageLabel: (item, i) => entourageLabels[item.defId] ? $t(entourageLabels[item.defId]) : getEntourageDef(item.defId)?.name
        ?? project?.customEntourage?.find(def => def.id === item.defId)?.name ?? $t('layers.custom', { number: i + 1 }),
    });
  });
  let shown = $derived(filterElementGroups(groups, query));
  // Rooms count as elements too (By type lists them), whichever view is showing.
  let total = $derived(groups.reduce((sum, group) => sum + group.entries.length + (group.room ? 1 : 0), 0));

  let selected = $derived(new Set([...$selectedElementIds, $selectedElementId, $selectedRoomId].filter((id): id is string => !!id)));

  function hidden(group: ElementGroup) {
    return !!group.layer && !$layerVisibility[group.layer];
  }

  function toggleLayer(group: ElementGroup) {
    const layer = group.layer;
    if (layer) layerVisibility.update(v => ({ ...v, [layer]: !v[layer] }));
  }

  function pick(entry: ElementEntry, group: ElementGroup, e: MouseEvent) {
    const floor = get(floorView);
    if (!floor) return;
    if (hidden(group)) toggleLayer(group);
    const next = entry.room ? null : contextForElement(floor, entry.id, { trade: get(activeTrade), surface: get(activeSurface) });
    if (next) {
      // Both switches go back to Select with nothing selected.
      switchTrade(next.trade);
      switchSurface(next.surface);
    } else if (get(toolGroup) !== 'select' && get(toolGroup) !== 'view') {
      chooseGroup('select');
    }
    if (entry.room) {
      selectedElementId.set(null);
      selectedElementIds.set(new Set());
      selectedRoomId.set(entry.id);
    } else if (!next && (e.shiftKey || e.metaKey || e.ctrlKey) && group.key !== 'sections') {
      // Add to or take out of the selection, as Shift-click does on the plan.
      const ids = new Set(get(selectedElementIds));
      const current = get(selectedElementId);
      if (current && !get(currentProject)?.sections?.some(section => section.id === current)) ids.add(current);
      if (ids.has(entry.id)) ids.delete(entry.id); else ids.add(entry.id);
      selectedRoomId.set(null);
      selectedElementIds.set(ids.size > 1 ? ids : new Set());
      selectedElementId.set(ids.has(entry.id) ? entry.id : (ids.values().next().value ?? null));
    } else {
      selectedRoomId.set(null);
      selectedElementIds.set(new Set());
      selectedElementId.set(entry.id);
    }
    tick().then(() => get(planViewApi)?.revealSelection());
  }

  /** A room's header in the By room view: select the room itself. */
  function pickRoom(id: string) {
    if (get(toolGroup) !== 'select' && get(toolGroup) !== 'view') chooseGroup('select');
    selectedElementId.set(null);
    selectedElementIds.set(new Set());
    selectedRoomId.set(id);
    tick().then(() => get(planViewApi)?.revealSelection());
  }

  /** Double-click: zoom the plan onto the element. */
  function frame() {
    tick().then(() => get(planViewApi)?.zoomToFit(true));
  }

  // A selection made on the plan: open its group and scroll its row into view (again when the inspector sheet shortens the list).
  $effect(() => {
    void $planInsetBottom;
    const id = $selectedElementId ?? $selectedRoomId;
    if (!id || !list) return;
    const group = groups.find(g => g.room?.id === id || g.entries.some(entry => entry.id === id));
    // A room's header shows even when it is folded; an element needs its group open.
    if (group && group.room?.id !== id && collapsed[group.key]) collapsed[group.key] = false;
    tick().then(() => list?.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  });

  // Docked over the left of the plan: slide the plan right while it is open, like the Assistant on the
  // right. On phones the panel covers the whole width anyway. Tablets in portrait have no room for both.
  const PANEL_SPACE = 336;
  let slid = 0;
  $effect(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 0;
    const want = width > 640 ? PANEL_SPACE : 0;
    planInsetLeft.set(want);
    if (want !== slid) {
      get(planViewApi)?.panBy((want - slid) / 2, 0);
      slid = want;
    }
    if (width <= 1000) assistantOpen.set(false);
  });
  $effect(() => () => {
    planInsetLeft.set(0);
    if (slid) get(planViewApi)?.panBy(-slid / 2, 0);
  });

  // Start below whatever the top chrome holds right now (one or two tool rows, three on phones, a banner).
  let top = $state<number | null>(null);
  $effect(() => {
    const chrome = document.querySelector<HTMLElement>('[data-editor-chrome]');
    if (!chrome) return;
    const measure = () => {
      const bottoms = [...chrome.querySelectorAll<HTMLElement>('.op-top > *, .op-center > *')]
        .map(el => el.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.bottom);
      top = bottoms.length ? Math.round(Math.max(...bottoms)) + 12 : null;
    };
    const observer = new ResizeObserver(measure);
    for (const el of chrome.querySelectorAll('.op-top, .op-center')) observer.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  });

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && query) { query = ''; e.stopPropagation(); }
  }
</script>

<aside
  class="op-float op-enter op-elements-panel fixed z-[25] flex flex-col overflow-hidden"
  class:above-sheet={$planInsetBottom > 0}
  style:--sheet-inset="{$planInsetBottom}px"
  style:top={top === null ? undefined : `${top}px`}
  aria-label={$t('elements.title')}
  data-elements-panel
>
  <div class="flex items-center gap-3 pl-4 pr-2 py-2 shrink-0">
    <div class="flex-1 min-w-0">
      <div class="text-base font-semibold" style="color:var(--color-text-strong)">{$t('elements.title')}</div>
      <div class="text-xs truncate" style="color:var(--color-text-muted)">
        {$floorView?.name ?? ''} · {total === 1 ? $t('elements.countOne') : $t('elements.count', { count: total })}
      </div>
    </div>
    <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={() => elementsListOpen.set(false)}><Icon name="close" /></button>
  </div>
  {#if total > 0}
    <div class="px-3 pb-2 shrink-0 flex flex-col gap-2">
      <div class="op-el-views" role="group" aria-label={$t('elements.view.label')}>
        <button aria-pressed={view === 'room'} onclick={() => chooseView('room')} data-elements-view="room"><Icon name="roomShape" size={16} />{$t('elements.view.room')}</button>
        <button aria-pressed={view === 'type'} onclick={() => chooseView('type')} data-elements-view="type"><Icon name="list" size={16} />{$t('elements.view.type')}</button>
      </div>
      <label class="op-field !h-10">
        <Icon name="search" size={18} class="opacity-60" />
        <input type="search" placeholder={$t('elements.search')} aria-label={$t('elements.search')} bind:value={query} onkeydown={onSearchKeydown} data-elements-search />
        {#if query}
          <button class="op-btn is-square !h-8 !w-8 !min-w-8 -mr-2" aria-label={$t('elements.clearSearch')} onclick={() => query = ''}><Icon name="close" size={16} /></button>
        {/if}
      </label>
    </div>
  {/if}

  <div class="flex-1 min-h-0 op-scroll pb-2" style="border-top:1px solid var(--color-border-subtle)" bind:this={list} data-elements-list>
    {#each shown as group (group.key)}
      {@const open = !collapsed[group.key] || !!query}
      {@const off = hidden(group)}
      <section class="op-el-group" data-elements-group={group.key}>
        <div class="op-el-head">
          {#if group.room}
            {@const room = group.room}
            <!-- A room: the chevron folds it, the name selects the room. -->
            <button class="op-el-toggle !flex-none !w-9 !px-0 justify-center" aria-expanded={open} aria-label={$t(open ? 'elements.collapse' : 'elements.expand', { group: group.label })}
              onclick={() => collapsed[group.key] = open}>
              <Icon name="chevronRight" size={14} strokeWidth={2.5} class="op-el-chevron {open ? 'rotate-90' : ''}" />
            </button>
            <button class="op-el-toggle op-el-room !pl-1" aria-current={selected.has(room.id) ? 'true' : undefined}
              aria-label={$t('elements.selectRoom', { name: group.label })} onclick={() => pickRoom(room.id)} ondblclick={frame} data-element-id={room.id}>
              <Icon name={group.icon} size={16} />
              <span class="flex-1 min-w-0 truncate text-left">{group.label}</span>
              <span class="op-el-detail !font-normal">{room.detail}</span>
            </button>
            <span class="op-el-count">{group.entries.length}</span>
          {:else}
          <button class="op-el-toggle" aria-expanded={open} aria-label={$t(open ? 'elements.collapse' : 'elements.expand', { group: group.label })}
            onclick={() => collapsed[group.key] = open}>
            <Icon name="chevronRight" size={14} strokeWidth={2.5} class="op-el-chevron {open ? 'rotate-90' : ''}" />
            <Icon name={group.icon} size={16} />
            <span class="flex-1 min-w-0 truncate text-left">{group.label}</span>
            <span class="op-el-count">{group.entries.length}</span>
          </button>
          {/if}
          {#if group.layer}
            <button class="op-btn is-square !h-9 !w-9 !min-w-9" aria-pressed={!off}
              aria-label={$t(off ? 'layers.show' : 'layers.hide', { category: group.label })} title={$t(off ? 'layers.show' : 'layers.hide', { category: group.label })}
              onclick={() => toggleLayer(group)} data-elements-visibility={group.key}>
              <Icon name={off ? 'eyeOff' : 'eye'} size={16} />
            </button>
          {/if}
        </div>
        {#if open}
          <ul class:opacity-50={off}>
            {#each group.entries as entry (entry.id)}
              <li>
                <button class="op-el-row" aria-current={selected.has(entry.id) ? 'true' : undefined} title={off ? $t('elements.hidden') : undefined}
                  onclick={(e) => pick(entry, group, e)} ondblclick={frame} data-element-id={entry.id}>
                  <Icon name={entry.icon} size={16} class="shrink-0 opacity-70" />
                  <span class="flex-1 min-w-0 truncate">{entry.name}</span>
                  {#if entry.locked}<span title={$t('elements.locked')} class="shrink-0 opacity-60"><Icon name="lock" size={13} /></span>{/if}
                  {#if entry.detail}<span class="op-el-detail">{entry.detail}</span>{/if}
                </button>
              </li>
            {/each}
            {#if group.room && group.entries.length === 0}
              <li class="op-el-empty">{$t('elements.emptyRoom')}</li>
            {/if}
          </ul>
        {/if}
      </section>
    {/each}
    {#if total === 0}
      <p class="px-5 py-6 text-sm text-center" style="color:var(--color-text-muted)">{$t('elements.empty')}</p>
    {:else if shown.length === 0}
      <p class="px-5 py-6 text-sm text-center" style="color:var(--color-text-muted)">{$t('elements.noMatch', { query })}</p>
    {/if}
  </div>
</aside>
