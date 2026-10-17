# openPlan3D: conventions for designs

openPlan3D is a browser-based 2D/3D floor-plan editor, being redesigned to feel calm, canvas-first and iPad-friendly, closer to a sketching/notes app (Notability, Freeform) than a CAD tool.

## What this design system contains

- **Tokens only. There are no importable components.** The app is SvelteKit, so `window.OpenPlan3D` is empty. Build every control yourself in React/HTML and style it with the CSS variables below.
- **The reference cards** (`components/reference/*.html`) show the app's **current** UI: top bar, tool palette, properties panel, catalog, menus, dialogs and canvas visuals. Use them to learn what controls exist and what they're called. Their layout and density are what the redesign is replacing, so don't copy them.

## Styling idiom: CSS custom properties

`styles.css` loads `tokens/tokens.css` and a base layer that applies `--font-sans`, `--color-text` and `--color-bg` to the page. Style with `var(--…)` only; avoid raw hex.

| Family | Use |
|---|---|
| Surfaces | `--color-bg`, `--color-surface`, `--color-surface-raised`, `--color-surface-subtle`, `--color-surface-muted`, `--color-surface-hover` |
| Text | `--color-text-strong`, `--color-text`, `--color-text-secondary`, `--color-text-muted`, `--color-text-disabled` |
| Borders | `--color-border`, `--color-border-subtle`, `--color-border-strong` |
| Inputs | `--color-input-bg`, `--color-input-text`, `--color-input-border`, `--color-placeholder` |
| Accent (primary action, selection) | `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-accent-subtle`, `--color-accent-text`, `--color-accent-ring`, `--color-focus-ring` |
| Status | `--color-danger*`, `--color-warning*`, `--color-success*`; `--color-constraint*` (indigo, geometric constraints) |
| Overlays | `--color-scrim`, `--color-tooltip-bg`, `--color-tooltip-text`, `--color-hud` |
| Type | `--font-sans` (system UI), `--font-mono`; sizes `--text-2xs`, `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl` |
| Shape | `--space-1` … `--space-10`, `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` / `--radius-2xl` / `--radius-full`, `--shadow-sm` … `--shadow-2xl` |
| Plan canvas | `--canvas-bg`, `--canvas-grid`, `--canvas-grid-major`, `--canvas-wall`, `--canvas-wall-selected`, `--canvas-selection`, `--canvas-handle-fill`, `--canvas-room-fill-*`, `--canvas-dimension` |

**Theming.** Light is the default. Put `data-theme="dark"` (or the class `dark`) on a wrapper and the `--color-*` tokens switch. The `--canvas-*` tokens deliberately don't change.

**Avoid the legacy chrome tokens.** The `--color-chrome-*` tokens are today's dark slate top bar. Prefer light, floating surfaces (`--color-surface-raised` + `--shadow-lg` + `--radius-xl`).

## Design rules for this product

- The plan canvas fills the screen. Tools live in a compact floating palette; selection controls appear next to the selected object.
- **Touch first.** Hit targets are at least 44×44 px. Nothing may depend on hover, right-click or a keyboard shortcut; every action needs a visible touch path, such as long-press or a contextual bar.
- Precise numeric entry (lengths in cm or ft-in, angles) stays one tap away.
- Labels are localized (en, pt). Portuguese can be 2–3× longer, so don't fix the width of text buttons.

## Example

```jsx
<div style={{ position: 'fixed', left: 16, top: '50%', transform: 'translateY(-50%)',
  display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', padding: 'var(--space-2)',
  background: 'var(--color-surface-raised)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)' }}>
  {['Select', 'Wall', 'Room', 'Door', 'Measure'].map((t, i) => (
    <button key={t} aria-label={t} style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', border: 0,
      background: i === 0 ? 'var(--color-accent-subtle)' : 'transparent',
      color: i === 0 ? 'var(--color-accent-text)' : 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>{t}</button>
  ))}
</div>
```
