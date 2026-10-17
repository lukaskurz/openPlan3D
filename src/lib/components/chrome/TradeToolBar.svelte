<script lang="ts">
  import { t } from '$lib/i18n';
  import { popover, togglePopover, closePopover } from '$lib/stores/chrome';
  import { activeTrade, activeSurface, TRADES } from '$lib/stores/workContext';
  import { toolGroup, chooseGroup, switchTrade } from './tools';
  import { tradeTools, TRADE_INFO } from './tradeTools';
  import Icon from './Icon.svelte';

  let info = $derived(TRADE_INFO[$activeTrade]);
  let tools = $derived(tradeTools($activeTrade, $activeSurface));
  let open = $derived($popover === 'trade');

  let menuRef: HTMLDivElement | undefined = $state();
  function onWindowPointerDown(e: PointerEvent) {
    if (open && menuRef && !menuRef.contains(e.target as Node)) closePopover();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- The trade button names what is being worked on; the tools after it are that trade's for the current surface. -->
<div class="op-float op-cluster op-tool-bar shrink-0" role="toolbar" aria-label={$t('chrome.tools.trade', { trade: $t(info.label) })} data-trade-tools>
  <div class="relative shrink-0" bind:this={menuRef}>
    <button
      class="op-btn op-trade-btn"
      aria-label={$t('chrome.trade.button', { trade: $t(info.label) })}
      title={$t('chrome.trade.button', { trade: $t(info.label) })}
      aria-haspopup="menu"
      aria-expanded={open}
      onclick={() => togglePopover('trade')}
      data-trade-button={$activeTrade}
    >
      <Icon name={info.icon} />
      <Icon name="chevronDown" size={10} strokeWidth={3} class="op-corner-chevron" />
    </button>

    {#if open}
      <div class="op-popover op-enter op-menu absolute left-0 top-full mt-3 w-[21rem] max-w-[calc(100vw-2rem)] z-50" role="menu" aria-label={$t('chrome.trade.menu')} data-trade-menu>
        <div class="op-menu-title">{$t('chrome.trade.menu')}</div>
        {#each TRADES as trade (trade)}
          {@const item = TRADE_INFO[trade]}
          {@const current = trade === $activeTrade}
          <button class="op-menu-item {current ? 'is-active' : ''}" role="menuitemradio" aria-checked={current} onclick={() => switchTrade(trade)} data-trade={trade}>
            <span class="w-11 h-11 rounded-lg flex items-center justify-center shrink-0" style="background:var(--color-accent-subtle);color:var(--color-accent-text)"><Icon name={item.icon} /></span>
            <span class="flex-1 min-w-0">
              {$t(item.label)}
              <span class="op-sub">{$t(item.description)}</span>
            </span>
            {#if current}<Icon name="check" size={18} />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if tools.length}
    <div class="op-divider-v !mx-1 !h-6"></div>
    {#each tools as tool (tool.id)}
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
  {/if}
</div>
