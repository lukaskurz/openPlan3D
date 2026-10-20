import nodeAdapter from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';

/**
 * BUILD_TARGET=static builds a single-page app for static hosts such as Cloudflare Pages (npm run build:static).
 * Every route renders in the browser from one fallback page. Server endpoints are left out, so the hosted
 * Assistant, Assistant shares, the MCP connector and capture uploads are unavailable there; the editor, the
 * library, library sync (docs/cloud-sync.md) and the Assistant with a personal key keep working.
 */
const staticBuild = process.env.BUILD_TARGET === 'static';

/**
 * Content-Security-Policy of the static build, sent as a meta tag that carries the hash of SvelteKit's inline start
 * script. Scripts may only come from this site, Google sign-in and CloudKit JS, which keeps an injected script from
 * reading the library sync sign-ins kept in the browser. Requests may go to any https host because the Assistant and
 * AI renders call providers the user configures. static/_headers adds what a meta tag cannot (frame-ancestors).
 * See docs/deployment-security.md.
 */
const csp = {
	mode: 'hash',
	directives: {
		'default-src': ['self'],
		'script-src': ['self', 'wasm-unsafe-eval', 'https://accounts.google.com/gsi/', 'https://cdn.apple-cloudkit.com/'],
		'style-src': ['self', 'unsafe-inline', 'https://accounts.google.com/gsi/'],
		'img-src': ['self', 'data:', 'blob:', 'https:'],
		'font-src': ['self', 'data:'],
		'connect-src': ['self', 'data:', 'blob:', 'https:', 'http://localhost:*', 'http://127.0.0.1:*'],
		'worker-src': ['self', 'blob:'],
		'frame-src': ['https://accounts.google.com/', 'https://*.apple.com/', 'https://*.icloud.com/'],
		'object-src': ['none'],
		'base-uri': ['self'],
		'form-action': ['self']
	}
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticBuild ? staticAdapter({ fallback: 'index.html' }) : nodeAdapter(),
		...(staticBuild && { csp })
	}
};

export default config;
