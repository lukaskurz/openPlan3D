<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { furnitureName } from '$lib/i18n/furnitureNames';
  import { entourageLabels } from '$lib/i18n/entourageLabels';
  import { catalogCategoryLabels, normalizeCatalogSearch } from '$lib/i18n/catalogCategories';
  import { selectedTool, placingFurnitureId, placingEntourageId, currentProject, addCustomEntourage } from '$lib/stores/project';
  import { furnitureCatalog, furnitureCategories, type FurnitureDef } from '$lib/utils/furnitureCatalog';
  import { entourageCatalog, entourageCategories } from '$lib/utils/entourageCatalog';
  import { catalogOpen } from '$lib/stores/chrome';
  import FurnitureThumbnail from '$lib/components/sidebar/FurnitureThumbnail.svelte';
  import CustomModelPanel from '$lib/components/sidebar/CustomModelPanel.svelte';
  import { projectSettings, formatLength } from '$lib/stores/settings';
  import { pickFile } from './actions';
  import Icon from './Icon.svelte';

  const PEOPLE = '__people';
  let search = $state('');
  let category = $state<string>('All');
  let modelsOpen = $state(false);

  // Recent and favourite items are kept per browser, as before.
  const RECENT_KEY = 'o3d_recent_furniture';
  const FAV_KEY = 'o3d_favorite_furniture';
  function readList(key: string): string[] {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }
  let recentIds = $state<string[]>(readList(RECENT_KEY));
  let favoriteIds = $state<string[]>(readList(FAV_KEY));
  function save(key: string, ids: string[]) { try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage unavailable */ } }

  const byId = (id: string) => furnitureCatalog.find(f => f.id === id);
  let recent = $derived(recentIds.map(byId).filter(Boolean).slice(0, 8) as FurnitureDef[]);
  let favourites = $derived(favoriteIds.map(byId).filter(Boolean) as FurnitureDef[]);

  const label = (cat: string) => catalogCategoryLabels[cat] ? $t(catalogCategoryLabels[cat]) : cat;
  let units = $derived($projectSettings.units);
  const size = (item: FurnitureDef) => `${formatLength(item.width, units)} × ${formatLength(item.depth, units)}`;

  let results = $derived.by(() => {
    const query = normalizeCatalogSearch(search);
    let items = category === 'Favorites' ? favourites
      : category === 'All' || category === PEOPLE ? furnitureCatalog
      : furnitureCatalog.filter(f => f.category === category);
    if (query) items = items.filter(f => [f.name, furnitureName(f.id, $locale), f.category, label(f.category)].some(v => normalizeCatalogSearch(v).includes(query)));
    return items;
  });
  /** Group the full list by category when nothing narrows it. */
  let sections = $derived(category === 'All' && !search
    ? furnitureCategories.map(cat => ({ cat, items: results.filter(f => f.category === cat) })).filter(s => s.items.length)
    : [{ cat: category === 'Favorites' ? 'Favorites' : category, items: results }]);

  function place(item: FurnitureDef) {
    recentIds = [item.id, ...recentIds.filter(id => id !== item.id)].slice(0, 10);
    save(RECENT_KEY, recentIds);
    placingEntourageId.set(null);
    selectedTool.set('furniture');
    placingFurnitureId.set(item.id);
    catalogOpen.set(false);
  }

  function toggleFavourite(id: string) {
    favoriteIds = favoriteIds.includes(id) ? favoriteIds.filter(f => f !== id) : [...favoriteIds, id];
    save(FAV_KEY, favoriteIds);
  }

  function placeEntourage(id: string) {
    placingFurnitureId.set(null);
    selectedTool.set('select');
    placingEntourageId.set(id);
    catalogOpen.set(false);
  }

  async function uploadSymbol() {
    const file = await pickFile('image/png,image/jpeg,image/webp');
    if (!file || file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => placeEntourage(addCustomEntourage(file.name.replace(/\.[^.]+$/, ''), dataUrl, img.naturalHeight / img.naturalWidth || 1));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function close() { catalogOpen.set(false); }
  function onKeydown(e: KeyboardEvent) {
    if ($catalogOpen && e.key === 'Escape') { e.stopPropagation(); close(); }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet card(item: FurnitureDef)}
  {@const name = furnitureName(item.id, $locale)}
  {@const fav = favoriteIds.includes(item.id)}
  <div class="relative">
    <button class="w-full flex flex-col gap-1.5 text-left rounded-xl p-1.5 hover:bg-[var(--color-surface-hover)] {$placingFurnitureId === item.id ? 'ring-2 ring-[var(--color-accent)]' : ''}" onclick={() => place(item)} data-catalog-item={item.id}>
      <div class="w-full aspect-[4/3] rounded-lg flex items-center justify-center p-3" style="background:var(--color-surface-muted)">
        <div class="w-16 h-16"><FurnitureThumbnail catalogId={item.id} {name} color={item.color} /></div>
      </div>
      <span class="text-sm font-semibold leading-tight px-0.5 line-clamp-2" style="color:var(--color-text-strong)">{name}</span>
      <span class="text-xs px-0.5 tabular-nums" style="color:var(--color-text-muted)">{size(item)}</span>
    </button>
    <button class="absolute top-2.5 right-2.5 w-9 h-9 rounded-full flex items-center justify-center" style="background:var(--color-surface-raised);color:{fav ? 'var(--color-favorite)' : 'var(--color-text-subtle)'}"
      aria-pressed={fav} aria-label={$t(fav ? 'objectControls.remove' : 'objectControls.add', { name })} onclick={() => toggleFavourite(item.id)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={fav ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" /></svg>
    </button>
  </div>
{/snippet}

{#if $catalogOpen}
  <section class="op-float op-slide-up fixed z-40 left-[var(--chrome-inset)] right-[var(--chrome-inset)] bottom-[var(--chrome-inset)] h-[min(58dvh,560px)] flex flex-col overflow-hidden" aria-label={$t('chrome.tool.furniture')} data-catalog-sheet>
    <div class="flex justify-center pt-1.5"><span class="w-10 h-1 rounded-full" style="background:var(--color-border-strong)"></span></div>
    <div class="flex items-center gap-2 px-3 pt-2">
      <label class="op-field flex-1 min-w-0">
        <Icon name="search" size={18} class="opacity-60" />
        <input type="search" placeholder={$t('chrome.catalog.search', { count: furnitureCatalog.length })} aria-label={$t('objectControls.search')} bind:value={search} />
      </label>
      <button class="op-btn is-outline {modelsOpen ? 'is-active' : ''}" aria-expanded={modelsOpen} onclick={() => modelsOpen = !modelsOpen}><Icon name="cube" size={18} /><span class="max-sm:hidden">{$t('chrome.catalog.myModels')}</span></button>
      <button class="op-btn is-square" aria-label={$t('chrome.close')} onclick={close}><Icon name="close" /></button>
    </div>
    <div class="flex gap-2 px-3 py-2.5 overflow-x-auto shrink-0" role="tablist">
      <button class="op-btn shrink-0 !h-10 {category === 'All' ? 'is-primary' : 'is-outline'}" style="border-radius:999px" role="tab" aria-selected={category === 'All'} onclick={() => category = 'All'}>{$t('objectControls.all')}</button>
      <button class="op-btn shrink-0 !h-10 {category === 'Favorites' ? 'is-primary' : 'is-outline'}" style="border-radius:999px" role="tab" aria-selected={category === 'Favorites'} onclick={() => category = 'Favorites'}>♥ {$t('objectControls.favorites')}{favoriteIds.length ? ` · ${favoriteIds.length}` : ''}</button>
      {#each furnitureCategories as cat}
        <button class="op-btn shrink-0 !h-10 {category === cat ? 'is-primary' : 'is-outline'}" style="border-radius:999px" role="tab" aria-selected={category === cat} onclick={() => category = cat}>{label(cat)}</button>
      {/each}
      <button class="op-btn shrink-0 !h-10 {category === PEOPLE ? 'is-primary' : 'is-outline'}" style="border-radius:999px" role="tab" aria-selected={category === PEOPLE} onclick={() => category = PEOPLE}>{$t('entourageLabels.title')}</button>
    </div>

    <div class="flex-1 min-h-0 op-scroll px-3 pb-4">
      {#if modelsOpen}
        <div class="rounded-xl p-3 mb-3" style="background:var(--color-surface-subtle)"><CustomModelPanel /></div>
      {/if}
      {#if category === PEOPLE}
        {#each entourageCategories as cat}
          {@const defs = entourageCatalog.filter(d => d.category === cat.key)}
          <div class="op-menu-title !px-1">{$t(`entourageLabels.${cat.key}`)}</div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            {#each defs as def}
              {@const name = entourageLabels[def.id] ? $t(entourageLabels[def.id]) : def.name}
              <button class="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-[var(--color-surface-hover)] {$placingEntourageId === def.id ? 'ring-2 ring-[var(--color-accent)]' : ''}" style="border:1px solid var(--color-border)" onclick={() => placeEntourage(def.id)}>
                <svg viewBox="0 0 100 {Math.round(100 * def.aspect)}" class="w-full h-12" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" style="color:var(--color-text-secondary)">
                  {#each def.paths as d}<path d={d} />{/each}
                </svg>
                <span class="text-xs text-center truncate w-full" style="color:var(--color-text-secondary)">{name}</span>
              </button>
            {/each}
          </div>
        {/each}
        {#if $currentProject?.customEntourage?.length}
          <div class="op-menu-title !px-1">{$t('entourageLabels.custom')}</div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            {#each $currentProject.customEntourage as def}
              <button class="flex flex-col items-center gap-1.5 p-2 rounded-xl" style="border:1px solid var(--color-border)" onclick={() => placeEntourage(def.id)}>
                <img src={def.dataUrl} alt={def.name} class="w-full h-12 object-contain" />
                <span class="text-xs truncate w-full text-center" style="color:var(--color-text-secondary)">{def.name}</span>
              </button>
            {/each}
          </div>
        {/if}
        <button class="op-btn is-outline w-full mt-3" onclick={uploadSymbol}><Icon name="upload" size={18} />{$t('entourageLabels.upload')}</button>
      {:else}
        {#if category === 'All' && !search && recent.length}
          <div class="op-menu-title !px-1">{$t('objectControls.recent')}</div>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
            {#each recent as item (item.id)}{@render card(item)}{/each}
          </div>
        {/if}
        {#each sections as section (section.cat)}
          <div class="op-menu-title !px-1">{section.cat === 'Favorites' ? $t('objectControls.favorites') : section.cat === 'All' ? $t('objectControls.all') : label(section.cat)} · {section.items.length}</div>
          {#if !section.items.length}
            <p class="px-1 text-sm" style="color:var(--color-text-muted)">{$t('chrome.catalog.empty')}</p>
          {/if}
          <div class="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
            {#each section.items as item (item.id)}{@render card(item)}{/each}
          </div>
        {/each}
      {/if}
    </div>
  </section>
{/if}
