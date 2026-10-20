<script>
  import '../app.css';
  import { initializeLocale } from '$lib/i18n';
  onMount(initializeLocale);
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { themePreference } from '$lib/stores/theme';
  import DeploymentNotice from '$lib/components/DeploymentNotice.svelte';
  // Analytics report to the Firebase project in $lib/firebase, so only a deployment that owns it opts in.
  onMount(() => { if (window.location.pathname !== '/render-lab' && env.PUBLIC_ENABLE_ANALYTICS === 'true') void import('$lib/firebase'); });
  // Pinching the toolbars must not zoom the page (the plan handles its own pinch); Safari only.
  onMount(() => {
    /** @param {Event} e */
    const stop = (e) => e.preventDefault();
    document.addEventListener('gesturestart', stop);
    return () => document.removeEventListener('gesturestart', stop);
  });
  let { children } = $props();
</script>

{@render children()}
<DeploymentNotice />
