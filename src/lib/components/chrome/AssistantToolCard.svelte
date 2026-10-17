<script lang="ts">
  import { t } from '$lib/i18n';
  import { assistantTools, activeCheck, showTool, removeTool } from '$lib/assistant/checks';
  import { assistantOpen } from '$lib/stores/chrome';
  import Icon from './Icon.svelte';

  let { toolId }: { toolId: string } = $props();
  let tool = $derived($assistantTools.find(item => item.id === toolId));
  let on = $derived(!!tool && $activeCheck?.toolId === tool.id);
  let explain = $state(false);
</script>

{#if tool}
  <div class="flex flex-col gap-2.5 p-3 rounded-lg" style="border:1px solid var(--color-border)" data-tool-card>
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" style="background:var(--color-surface-muted);color:var(--color-text-secondary)">
        <Icon name={tool.kind === 'walkway' ? 'walkway' : 'roomShape'} size={22} />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold" style="color:var(--color-text)">{tool.name}</div>
        {#if tool.description}<div class="text-xs" style="color:var(--color-text-muted)">{tool.description}</div>{/if}
      </div>
    </div>
    {#if explain}
      <p class="text-xs leading-snug" style="color:var(--color-text-secondary)">{$t(tool.kind === 'walkway' ? 'chrome.assistant.tool.howWalkway' : 'chrome.assistant.tool.howRoomSize')}</p>
    {/if}
    <div class="flex gap-2 flex-wrap">
      <button class="op-btn {on ? 'is-active' : 'is-primary'}" aria-pressed={on} onclick={() => { if (on) activeCheck.set(null); else { showTool(tool); assistantOpen.set(false); } }}>
        {#if on}<Icon name="check" size={16} />{$t('chrome.assistant.tool.on')}{:else}{$t('chrome.assistant.tool.try')}{/if}
      </button>
      <button class="op-btn is-outline whitespace-nowrap" aria-expanded={explain} onclick={() => explain = !explain}>{$t('chrome.assistant.tool.how')}</button>
      <button class="op-btn is-square ml-auto" aria-label={$t('chrome.assistant.tool.remove')} title={$t('chrome.assistant.tool.remove')} onclick={() => removeTool(tool.id)}><Icon name="trash" size={18} /></button>
    </div>
  </div>
{:else}
  <div class="text-xs" style="color:var(--color-text-muted)">{$t('chrome.assistant.tool.removed')}</div>
{/if}
