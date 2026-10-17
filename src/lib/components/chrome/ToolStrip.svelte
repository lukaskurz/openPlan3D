<script lang="ts">
  import { t, type TranslationKey } from '$lib/i18n';
  import { toolGroup, chooseGroup, type ToolGroup } from './tools';
  import Icon, { type IconName } from './Icon.svelte';

  // Moving around and editing come first; the drawing tools follow. Each tool's options sit in the tray below.
  const TOOLS: { id: ToolGroup; icon: IconName; label: TranslationKey; title?: TranslationKey }[] = [
    { id: 'view', icon: 'pan', label: 'chrome.tool.view', title: 'chrome.tool.viewHint' },
    { id: 'select', icon: 'select', label: 'chrome.tool.select' },
    { id: 'wall', icon: 'wall', label: 'chrome.tool.wall' },
    { id: 'openings', icon: 'door', label: 'chrome.tool.openings' },
    { id: 'structure', icon: 'stairs', label: 'chrome.tool.structure' },
    { id: 'annotate', icon: 'ruler', label: 'chrome.tool.annotate' },
    { id: 'furniture', icon: 'sofa', label: 'chrome.tool.furniture' },
  ];
</script>

<div class="op-float op-cluster op-tool-strip max-w-full overflow-x-auto" role="toolbar" aria-label={$t('chrome.tools')} data-tool-strip>
  {#each TOOLS as tool (tool.id)}
    {#if tool.id === 'wall'}<div class="op-divider-v !mx-1 !h-6"></div>{/if}
    <button
      class="op-btn is-square shrink-0"
      aria-label={$t(tool.label)}
      aria-pressed={$toolGroup === tool.id}
      title={tool.title ? `${$t(tool.label)}: ${$t(tool.title)}` : $t(tool.label)}
      data-tool={tool.id}
      onclick={() => chooseGroup(tool.id)}
    >
      <Icon name={tool.icon} />
    </button>
  {/each}
</div>
