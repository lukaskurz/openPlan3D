// Off-script design-sync build for openPlan3D (Svelte app -> tokens + reference cards).
//
// The design-sync converter only bundles React component libraries. openPlan3D is
// SvelteKit, so there is nothing importable for the Claude Design agent; instead we
// ship the de-facto tokens (styles.css closure), a conventions README, and the
// hand-authored reference cards from design/claude-design/design-system/previews/.
//
// Usage (repo root): node .design-sync/build.mjs  ->  ./ds-bundle
// Then:              DS_CHROMIUM_PATH=<chromium> node .ds-sync/package-validate.mjs ./ds-bundle
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const SRC = 'design/claude-design/design-system';
const OUT = 'ds-bundle';
const NAMESPACE = 'OpenPlan3D';

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'tokens'), { recursive: true });
mkdirSync(join(OUT, 'components', 'reference'), { recursive: true });

// Tokens-only bundle: no components to import, but the app's self-check needs the header.
const header = { namespace: NAMESPACE, components: [], sourceHashes: {}, inlinedExternals: [] };
writeFileSync(join(OUT, '_ds_bundle.js'),
  `/* @ds-bundle: ${JSON.stringify(header)} */\n(function () { window.${NAMESPACE} = window.${NAMESPACE} || {}; })();\n`);

// Styles: the closure every rendered design receives.
copyFileSync(join(SRC, 'tokens.css'), join(OUT, 'tokens', 'tokens.css'));
writeFileSync(join(OUT, 'tokens', 'base.css'), `/* Page defaults matching src/app.css (html, body). */
html, body { margin: 0; font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); }
`);
writeFileSync(join(OUT, 'styles.css'), `@import "./tokens/tokens.css";\n@import "./tokens/base.css";\n`);

// Reference cards: re-point the stylesheet at styles.css, add card name/subtitle,
// and wrap the body in #root (the render check asserts a non-empty root).
const cards = readdirSync(join(SRC, 'previews')).filter((f) => f.endsWith('.html')).sort();
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/"/g, "'");
for (const file of cards) {
  let html = readFileSync(join(SRC, 'previews', file), 'utf8');
  const [first, ...rest] = html.split('\n');
  const group = /group="([^"]+)"/.exec(first)?.[1];
  if (!group) throw new Error(`${file}: missing @dsCard group`);
  const title = decode(/<h1[^>]*>([^<]*)/.exec(html)?.[1]?.trim() || basename(file, '.html'));
  html = rest.join('\n')
    .replace(/href="\.\.\/tokens\.css"/g, 'href="../../styles.css"')
    .replace(/<body([^>]*)>/, '<body$1>\n<div id="root">')
    .replace(/<\/body>/, '</div>\n</body>');
  writeFileSync(join(OUT, 'components', 'reference', file),
    `<!-- @dsCard group="${group}" name="${title}" subtitle="Current openPlan3D UI (reference only, not importable)" -->\n${html}`);
}

// README = conventions header + the current-state system overview.
const conventions = readFileSync('.design-sync/conventions.md', 'utf8');
const overview = readFileSync(join(SRC, 'README.md'), 'utf8')
  .replace(/`tokens\.css`/g, '`tokens/tokens.css`')
  .replace(/`previews\/\*\.html`/g, '`components/reference/*.html`');
writeFileSync(join(OUT, 'README.md'), `${conventions.trim()}\n\n---\n\n${overview}`);

// Build meta for package-validate (cards count as the previews it checks).
writeFileSync(join(OUT, '.ds-build-meta.json'), JSON.stringify({ shape: 'package', componentCount: cards.length, offScript: 'tokens + reference cards' }, null, 2));
writeFileSync(join(OUT, '_ds_needs_recompile'), JSON.stringify({ by: 'design-sync-cli' }));
console.log(`ds-bundle: ${cards.length} reference cards, tokens + base styles, README`);
