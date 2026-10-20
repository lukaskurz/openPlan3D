import nodeAdapter from '@sveltejs/adapter-node';
import staticAdapter from '@sveltejs/adapter-static';

/**
 * BUILD_TARGET=static builds a single-page app for static hosts such as Cloudflare Pages (npm run build:static).
 * Every route renders in the browser from one fallback page. Server endpoints are left out, so the hosted
 * Assistant, Assistant shares, the MCP connector and capture uploads are unavailable there; the editor, the
 * library, library sync (docs/cloud-sync.md) and the Assistant with a personal key keep working.
 */
const staticBuild = process.env.BUILD_TARGET === 'static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticBuild ? staticAdapter({ fallback: 'index.html' }) : nodeAdapter()
	}
};

export default config;
