# design-sync notes: openPlan3D

## Off-script layout (read first)
- openPlan3D is a **SvelteKit** app, so the React converter (`package-build.mjs`) does not apply. There are no importable components; `_ds_bundle.js` is an empty `window.OpenPlan3D` stub with a valid `@ds-bundle` header.
- `node .design-sync/build.mjs` generates `./ds-bundle` from `design/claude-design/design-system/`:
  - `tokens.css` becomes `tokens/tokens.css` and `styles.css` (plus `tokens/base.css` page defaults).
  - `previews/*.html` become `components/reference/*.html`. The build re-points the stylesheet to `../../styles.css`, adds `name`/`subtitle` to `@dsCard` and wraps the body in `#root` for the render check.
  - `README.md` = `.design-sync/conventions.md` + the design-system README.
- `.ds-build-meta.json` sets `componentCount` = number of cards, so `package-validate.mjs` counts the cards as previews.
- Validate: `DS_CHROMIUM_PATH=<chromium> node .ds-sync/package-validate.mjs ./ds-bundle`. Playwright is installed in `.ds-sync/` (`npm i playwright@1.63.0`). The cached browser is `~/Library/Caches/ms-playwright/chromium-1223/...`.
- No `_ds_sync.json` is produced (off-script), so every re-sync is a full re-upload. That's fine: it's about 25 small files.

## Known render warns
- `[FONT_MISSING] "bold 11px system-ui" (--font-canvas-ui)` is a false positive. The token is a canvas `ctx.font` shorthand, not a family; it only uses system-ui.
- `_ds_sync.json absent` is expected for this off-script layout.

## Re-sync risks
- The cards and tokens are **hand-extracted snapshots** of the current Svelte UI (2026-10-02). Nothing regenerates them from source, so they go stale as the UI changes. Re-extract or edit `design/claude-design/design-system/` before re-syncing.
- The conventions header names token families. Re-check them against `tokens.css` whenever tokens change.
- Once the redesign lands, replace this current-state system with the new tokens; the conventions header says the cards are "current UI, not to copy".
