<script lang="ts">
  import { floorView } from '$lib/stores/chrome';
  import { t } from '$lib/i18n';
  import { activeFloor, detectedRoomsStore, selectedElementIds, elevationPickMode, doorJoinMode } from '$lib/stores/project';
  import { projectSettings, formatArea } from '$lib/stores/settings';
  import { wallDraft, canvasHint } from '$lib/stores/planView';
  import type { TranslationKey } from '$lib/i18n';
  import { toolGroup } from './tools';

  let rooms = $derived($detectedRoomsStore);
  let area = $derived(rooms.reduce((sum, room) => sum + room.area, 0));

  let text = $derived.by(() => {
    if ($elevationPickMode) return $t('chrome.hint.pickElevation');
    // Scan door join: the canvas narrows the hint once a door in the same room is picked.
    if ($doorJoinMode) return $t(($canvasHint ?? 'doorJoin.hint') as TranslationKey);
    if ($toolGroup === 'wall' && $wallDraft) {
      if ($wallDraft.nearFirst) return $t('chrome.hint.closeRoom');
      if ($wallDraft.snappedTo) return $t($wallDraft.snappedTo === 'corner' ? 'chrome.hint.snappedCorner' : 'chrome.hint.snappedWall');
      return $t('chrome.hint.nextCorner');
    }
    if ($selectedElementIds.size > 1) return $t('chrome.selection.count', { count: $selectedElementIds.size });
    const parts: string[] = [];
    if (rooms.length) {
      parts.push($t(rooms.length === 1 ? 'canvasStatus.roomsOne' : 'canvasStatus.roomsMany', { count: rooms.length }));
      parts.push(formatArea(area, $projectSettings.units));
    }
    if ($floorView) parts.push($floorView.name);
    return parts.join(' · ');
  });
</script>

{#if text}
  {#if $doorJoinMode}
    <!-- Joining doors has no other exit on a touch screen (Esc is keyboard only). -->
    <div class="op-pill flex items-center gap-2" role="status" aria-live="polite" data-status-pill>
      <span>{text}</span>
      <button class="op-btn h-8 px-3" onclick={() => doorJoinMode.set(null)}>{$t('chrome.cancel')}</button>
    </div>
  {:else}
    <div class="op-pill pointer-events-none" role="status" aria-live="polite" data-status-pill>{text}</div>
  {/if}
{/if}
