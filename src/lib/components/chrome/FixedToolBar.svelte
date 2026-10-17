<script lang="ts">
  import { t } from '$lib/i18n';
  import { toolGroup, chooseGroup } from './tools';
  import { FIXED_TOOLS } from './tradeTools';
  import Icon from './Icon.svelte';
</script>

<!-- The same tools whatever the trade: moving around, selecting, measuring. -->
<div class="op-float op-cluster op-tool-bar shrink-0" role="toolbar" aria-label={$t('chrome.tools.fixed')} data-fixed-tools>
  {#each FIXED_TOOLS as tool (tool.id)}
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
