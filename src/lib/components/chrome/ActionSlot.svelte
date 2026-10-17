<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import {
    viewMode, sideViewOpen, elevationPickMode, doorJoinMode, calibrationMode, calibrationPoints, constraintPickMode,
    detectedRoomsStore, selectedElementId, selectedElementIds, selectedRoomId, selectedTool, placingFurnitureId,
    currentProject,
  } from '$lib/stores/project';
  import { activeSurface } from '$lib/stores/workContext';
  import { ceilingSummaryOfRooms, formatCeilingRange } from '$lib/utils/ceilingLabels';
  import { projectSettings, formatArea } from '$lib/stores/settings';
  import { canvasHint, selectMode } from '$lib/stores/planView';
  import { catalogOpen, floorView } from '$lib/stores/chrome';
  import { toolGroup } from './tools';
  import { hintKey } from './hints';
  import SelectionBar from './SelectionBar.svelte';
  import ToolTray from './ToolTray.svelte';
  import Icon from './Icon.svelte';

  /**
   * The one centred slot at the bottom: what the person is doing right now. Strict priority:
   * 1. an overlay mode's hint and Cancel, 2. the selection's actions, 3. the tool's hint, options
   * and Done, 4. the status line.
   */

  let plan = $derived($viewMode === '2d' && !$sideViewOpen);
  let rooms = $derived($detectedRoomsStore);

  interface Overlay { text: string; cancel: () => void; kind: string }
  let overlay = $derived.by((): Overlay | null => {
    if (!plan) return null;
    if ($calibrationMode) return { kind: 'calibrate', text: $t('chrome.hint.calibrate'), cancel: () => { calibrationMode.set(false); calibrationPoints.set([]); } };
    // Scan door join: the canvas narrows the hint once a door in the same room is picked.
    if ($doorJoinMode) return { kind: 'door-join', text: $t(hintKey($canvasHint ?? 'doorJoin.hint')), cancel: () => doorJoinMode.set(null) };
    if ($constraintPickMode) {
      const key: TranslationKey = $constraintPickMode === 'fix' ? 'chrome.hint.pickFix'
        : $constraintPickMode === 'parallel' || $constraintPickMode === 'perpendicular' ? 'chrome.hint.pickPair' : 'chrome.hint.pickWall';
      return { kind: 'constraint', text: $t(key), cancel: () => constraintPickMode.set(null) };
    }
    if ($elevationPickMode) return { kind: 'elevation', text: $t('chrome.hint.pickElevation'), cancel: () => elevationPickMode.set(false) };
    return null;
  });

  // Mirrors SelectionBar's own visibility.
  let hasSelection = $derived(plan && $selectedTool === 'select'
    && ($selectedElementIds.size >= 2 || !!$selectedElementId || (!!$selectedRoomId && rooms.some(r => r.id === $selectedRoomId))));

  // Pan and Select have no tray; Furniture has one only while an item waits to be placed (the catalog sheet covers the slot otherwise).
  let toolActive = $derived(plan && $toolGroup !== 'view' && $toolGroup !== 'select'
    && (($toolGroup !== 'furniture' && $toolGroup !== 'fixture') || (!!$placingFurnitureId && !$catalogOpen)));

  let status = $derived.by(() => {
    const floorName = $floorView?.name;
    if ($viewMode === '3d') return ['3D', floorName].filter(Boolean).join(' · ');
    // The ceiling: `Ceiling · Ground floor · 10 lights · 2.40–2.60 m` (spec §3.8).
    if ($activeSurface === 'ceiling' && $floorView && $currentProject) {
      const floor = $floorView;
      // Saved rooms carry the newest details; detected ones catch up a frame later.
      const ceilingRooms = rooms.filter(room => !room.floorOpening).map(room => floor.rooms.find(saved => saved.id === room.id) ?? room);
      const summary = ceilingSummaryOfRooms($currentProject, floor, ceilingRooms);
      return [
        $t('chrome.status.ceiling'), floorName,
        $t(summary.lights === 1 ? 'chrome.status.lightsOne' : 'chrome.status.lightsMany', { count: summary.lights }),
        formatCeilingRange(summary.min, summary.max, $projectSettings.units),
      ].filter(Boolean).join(' · ');
    }
    const parts: string[] = [];
    if (rooms.length) {
      parts.push($t(rooms.length === 1 ? 'canvasStatus.roomsOne' : 'canvasStatus.roomsMany', { count: rooms.length }));
      parts.push(formatArea(rooms.reduce((sum, room) => sum + room.area, 0), $projectSettings.units));
    }
    if (floorName) parts.push(floorName);
    return parts.join(' · ');
  });

  // Select's Box and Add modes stay on until turned off, so they live next to the status.
  let selecting = $derived(plan && $toolGroup === 'select');
</script>

{#if overlay}
  <div class="op-slot-stack">
    <div class="op-float op-enter op-slot-bar" data-overlay={overlay.kind}>
      <span class="op-slot-hint" role="status" aria-live="polite" data-status-pill>{overlay.text}</span>
      <!-- The only way out on a touch screen (Esc is keyboard only). -->
      <button class="op-btn is-outline shrink-0" onclick={overlay.cancel}>{$t('chrome.cancel')}</button>
    </div>
  </div>
{:else if hasSelection}
  <SelectionBar />
{:else if toolActive}
  <ToolTray />
{:else if selecting && $selectMode !== 'tap'}
  <div class="op-slot-stack">
    <div class="op-float op-enter op-slot-bar" data-tool-tray>
      <span class="op-slot-hint" role="status" aria-live="polite" data-status-pill>{$t($selectMode === 'box' ? 'chrome.hint.box' : 'chrome.hint.add')}</span>
      {@render selectModes()}
      <div class="op-divider-v"></div>
      <button class="op-btn is-primary shrink-0" onclick={() => selectMode.set('tap')} data-tray-done>{$t('chrome.done')}</button>
    </div>
  </div>
{:else if selecting || (status && (plan || $viewMode === '3d'))}
  <div class="op-slot-stack">
    <div class="op-float op-slot-bar is-status">
      {#if status}<span class="op-slot-status" role="status" aria-live="polite" data-status-pill>{status}</span>{/if}
      {#if selecting}
        {#if status}<div class="op-divider-v"></div>{/if}
        {@render selectModes()}
      {/if}
    </div>
  </div>
{/if}

{#snippet selectModes()}
  {#each [{ mode: 'box', icon: 'box' }, { mode: 'add', icon: 'plus' }] as const as option (option.mode)}
    {@const on = $selectMode === option.mode}
    <button class="op-btn is-square shrink-0" aria-pressed={on} aria-label={$t(`chrome.select.${option.mode}`)} title={$t(`chrome.select.${option.mode}`)} data-variant={option.mode}
      onclick={() => selectMode.set(on ? 'tap' : option.mode)}>
      <Icon name={option.icon} size={20} />
    </button>
  {/each}
{/snippet}
