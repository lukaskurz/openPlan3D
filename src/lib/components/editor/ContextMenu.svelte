<script lang="ts">
  import { t } from '$lib/i18n';
  import { onMount } from 'svelte';
  import type { Wall, Door, Window as Win, FurnitureItem, Room } from '$lib/models/types';

  interface Props {
    x: number;
    y: number;
    visible: boolean;
    targetType: 'furniture' | 'wall' | 'door' | 'window' | 'room' | 'canvas' | null;
    targetId: string | null;
    targetWall?: Wall | null;
    targetFurniture?: FurnitureItem | null;
    targetRoom?: Room | null;
    clipboard?: any;
    onclose: () => void;
    onaction: (action: string, data?: any) => void;
  }

  let { x, y, visible, targetType, targetId, targetWall, targetFurniture, targetRoom, clipboard, onclose, onaction }: Props = $props();

  let menuEl = $state<HTMLDivElement>();

  // Adjust position to keep menu within viewport
  let adjustedX = $state(0);
  let adjustedY = $state(0);

  $effect(() => {
    if (visible && menuEl) {
      const rect = menuEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      adjustedX = x + rect.width > vw ? vw - rect.width - 8 : x;
      adjustedY = y + rect.height > vh ? vh - rect.height - 8 : y;
    } else {
      adjustedX = x;
      adjustedY = y;
    }
  });

  let returnFocus: HTMLElement | null = null;
  $effect(() => {
    if (visible && menuEl) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      menuEl.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    // Menu keys must not reach the editor's selection/geometry shortcuts.
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      returnFocus?.focus();
      onclose();
      return;
    }
    const items = [...(menuEl?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (e.key) {
      case 'ArrowDown': next = (current + 1) % items.length; break;
      case 'ArrowUp': next = (current - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      default: return;
    }
    e.preventDefault();
    items[next].focus();
  }

  function handleClickOutside(e: MouseEvent) {
    if (menuEl && !menuEl.contains(e.target as Node)) {
      onclose();
    }
  }

  function clickItem(action: string, data?: any) {
    returnFocus?.focus();
    onaction(action, data);
    onclose();
  }

  onMount(() => {
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  });
</script>

{#if visible}
  <div
    bind:this={menuEl}
    class="op-popover op-enter fixed z-[9999] p-1.5 min-w-[240px] text-sm select-none"
    style="left: {adjustedX}px; top: {adjustedY}px;"
    role="menu"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    {#if targetType === 'furniture'}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('duplicate-furniture')}>
        <span class="ctx-icon">📋</span> {$t('contextMenu.duplicate')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('rotate-furniture-90')}>
        <span class="ctx-icon">🔄</span> {$t('contextMenu.rotate90')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('flip-horizontal')}>
        <span class="ctx-icon">↔️</span> {$t('contextMenu.flipHorizontal')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('bring-to-front')}>
        <span class="ctx-icon">⬆️</span> {$t('contextMenu.bringToFront')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('send-to-back')}>
        <span class="ctx-icon">⬇️</span> {$t('contextMenu.sendToBack')}
      </button>
      <div class="ctx-sep"></div>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('toggle-lock')}>
        <span class="ctx-icon">{targetFurniture?.locked ? '🔓' : '🔒'}</span> {targetFurniture?.locked ? $t('contextMenu.unlock') : $t('contextMenu.lock')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> {$t('contextMenu.properties')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> {$t('contextMenu.delete')}
      </button>

    {:else if targetType === 'wall'}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('split-wall')}>
        <span class="ctx-icon">✂️</span> {$t('contextMenu.splitWall')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('toggle-curve')}>
        <span class="ctx-icon">〰️</span> {$t(targetWall?.curvePoint ? 'contextMenu.curveOff' : 'contextMenu.curveOn')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> {$t('contextMenu.properties')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> {$t('contextMenu.deleteWall')}
      </button>

    {:else if targetType === 'door' || targetType === 'window'}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('properties')}>
        <span class="ctx-icon">⚙️</span> {$t('contextMenu.properties')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete')}>
        <span class="ctx-icon">🗑️</span> {$t('contextMenu.delete')}
      </button>

    {:else if targetType === 'room'}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('reset-room-label')}>
        <span class="ctx-icon">↺</span> {$t('contextMenu.resetLabel')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('rename-room')}>
        <span class="ctx-icon">✏️</span> {$t('contextMenu.renameRoom')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('change-floor-texture')}>
        <span class="ctx-icon">🎨</span> {$t('contextMenu.changeFloorTexture')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item ctx-danger" role="menuitem" onclick={() => clickItem('delete-room')}>
        <span class="ctx-icon">🗑️</span> {$t('contextMenu.deleteRoom')}
      </button>

    {:else if targetType === 'canvas'}
      {#if clipboard}
        <button class="ctx-item" role="menuitem" onclick={() => clickItem('paste')}>
          <span class="ctx-icon">📋</span> {$t('contextMenu.paste')}
        </button>
        <div class="ctx-sep"></div>
      {/if}
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('select-all')}>
        <span class="ctx-icon">⬜</span> {$t('contextMenu.selectAll')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('group')}>
        <span class="ctx-icon">📦</span> {$t('contextMenu.groupSelected')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('ungroup')}>
        <span class="ctx-icon">📤</span> {$t('contextMenu.ungroup')}
      </button>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('add-wall')}>
        <span class="ctx-icon">🧱</span> {$t('contextMenu.addWall')}
      </button>
      <div class="ctx-sep"></div>
      <button class="ctx-item" role="menuitem" onclick={() => clickItem('zoom-to-fit')}>
        <span class="ctx-icon">🔍</span> {$t('contextMenu.zoomToFit')}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Touch-sized rows in the shared menu look; the old emoji icons are dropped. */
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    border-radius: var(--radius-lg);
    text-align: left;
    cursor: pointer;
    border: none;
    background: none;
    color: var(--color-text-secondary);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .ctx-item:hover, .ctx-item:focus-visible {
    background: var(--color-surface-hover);
  }
  .ctx-danger {
    color: var(--color-danger-text);
  }
  .ctx-danger:hover {
    background: var(--color-danger-subtle);
  }
  .ctx-icon {
    display: none;
  }
  .ctx-sep {
    height: 1px;
    background: var(--color-border-subtle);
    margin: 4px 8px;
  }
</style>
