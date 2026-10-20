# Deployment and credential security

How the live site at **https://openfloorplan.lukaskurz.com** is built and
served, which credentials exist and where each lives, why a public repository
does not leak them, and what was checked on 20 October 2026. The library sync
itself is described in [cloud-sync.md](cloud-sync.md).

## Verdict

- No secret is in the repository or its history. Every commit on every branch
  and tag (515) and the current tree were scanned; details are under
  [Audit](#audit-20-october-2026).
- The deployment holds no secrets at all. Everything the live site needs is a
  public identifier: the Google OAuth client ID, the iCloud container and its
  API token. Each is locked to this domain by Google and Apple, not by being
  hidden.
- There is no backend. Browsers talk to Google Drive and iCloud directly with
  the visitor's own sign-in, so no server holds user data or tokens to steal.
- The audit found the live site sending usage analytics to the **upstream
  project's** Firebase / Google Analytics account. Analytics now only run when a
  deployment sets `PUBLIC_ENABLE_ANALYTICS=true`, and this one does not.

## How it fits together

```
GitHub lukaskurz/openPlan3D (public fork of laanlabs/openPlan3D)
   │  push to main
   ▼
Cloudflare Pages project "openfloorplan"
   │  npm run build:static   (adapter-static, Node 22)
   │  PUBLIC_* build variables baked into _app/env.js
   ▼
Static files at openfloorplan.lukaskurz.com   (CNAME → openfloorplan.pages.dev)
   │
   ▼  in the visitor's browser
   ├── Google Identity Services ──► one-hour access token (scope drive.file)
   │      └── Google Drive API ──► "openPlan3D" folder in the visitor's Drive
   └── CloudKit JS (Apple CDN) ──► visitor's private iCloud database,
                                   container iCloud.com.lukaskurz.openfloorplan
```

- **Code:** `main` of the fork. Every push to `main` deploys automatically, and
  every other branch gets a preview at `<branch>.openfloorplan.pages.dev`.
- **Build:** Cloudflare runs `npm run build:static`
  ([svelte.config.js](../svelte.config.js)). The static build has no server
  endpoints. The hosted Assistant, Assistant shares, the MCP connector and
  capture uploads are therefore off; they need the Node build and a server.
- **DNS:** one record, `CNAME openfloorplan → openfloorplan.pages.dev`, in the
  lukaskurz.com zone. Cloudflare issues and renews the certificate.
- **Accounts involved:** GitHub (lukaskurz), Cloudflare (me@lukaskurz.com),
  Google Cloud project `openfloorplan` in the lukaskurz.com organization, and
  the Apple Developer team that owns the iCloud container.

## Credentials inventory

"Public by design" means the value is meant to ship in web pages. Protection
comes from the provider checking where requests come from.

| Credential | Where it lives | Public? | Protection | If misused |
| --- | --- | --- | --- | --- |
| Google OAuth client ID `661875565060-…` | Cloudflare variable `PUBLIC_GOOGLE_CLIENT_ID`; local `.env` | Public by design | Google only issues tokens to the registered JavaScript origins: `https://openfloorplan.lukaskurz.com` and `http://localhost:5173` | Another site cannot obtain tokens with it |
| Google OAuth client secret (`GOCSPX-…`) | Nowhere. Created with the client, never used: the browser token flow needs no secret | Must stay secret | Not stored in any file or variable | Unused by this app; disable it anyway ([action 3](#actions)) |
| iCloud container `iCloud.com.lukaskurz.openfloorplan` | Cloudflare variable; local `.env` | Public by design | Apple account access control | Nothing on its own |
| CloudKit production token `openfloorplan-web-production` (`894d71e8…`) | Cloudflare variable `PUBLIC_CLOUDKIT_API_TOKEN` | Public by design | Apple accepts it only from `https://openfloorplan.lukaskurz.com` (verified: other origins get `AUTHENTICATION_FAILED`) | Another site cannot use it |
| CloudKit development token `openfloorplan-dev` (`8abe3ba0…`) | Local `.env` only (git-ignored) | Not published | Development environment only, which has separate data; allows any origin so `http://localhost:5173` works | Could let a phishing page reach development data of someone who signs in there; only you do |
| CloudKit development token `openfloorplan-web` (`e1713d84…`) | Nowhere; superseded | — | Development only, domain-limited | Unused; delete it ([action 4](#actions)) |
| Firebase web config of the **upstream** project (`AIzaSyBA-…`, project `openplan3d`) | Committed in [src/lib/firebase.ts](../src/lib/firebase.ts) by upstream | Public by design (Firebase web keys are identifiers) | Upstream's Firebase rules ([storage.rules](../storage.rules) deny writes) | Not yours to rotate. Unused here: analytics are off unless `PUBLIC_ENABLE_ANALYTICS=true` |
| Server secrets of the Node build (`ANTHROPIC_API_KEY`, `HANDOFF_*`, `ASSISTANT_SHARES_*`) | Not set anywhere for this deployment | Must stay secret | Only read through `$env/dynamic/private` in server code, which the static build does not ship | Not present, so nothing to leak |
| Visitor's Google access token | Visitor's browser, `localStorage` key `openplan3d-google-token`, about 1 hour | Per-visitor secret | `drive.file` reaches only files this app created; never sent to any server of ours | Someone who runs script on the page (XSS) could read or change that visitor's openPlan3D files for up to an hour |
| Visitor's iCloud session | Visitor's browser, stored by CloudKit JS | Per-visitor secret | Limited to this container; never sent to any server of ours | Same XSS caveat, for that visitor's openPlan3D records |

Local files that hold values and must never be committed are already ignored
by [.gitignore](../.gitignore): `.env`, `.env.*` (except `.env.example`), and
`.claude/`. `build/` and `.svelte-kit/` are build output and are ignored too.

## Why a public repository does not leak anything

1. **No secrets are needed to build or run the site.** Everything in Cloudflare
   is a public ID that also appears in the live site's `_app/env.js` for
   anyone to read. A build that ran someone else's code would find nothing to
   steal.
2. **Private values never reach the browser bundle.** SvelteKit only bundles
   `PUBLIC_*` variables. A test build set fake values for
   `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET` and `HANDOFF_BUCKET`; none
   appeared anywhere in the output.
3. **Origins, not secrecy, protect the IDs.** Google and Apple only honour the
   client ID and the production token from `openfloorplan.lukaskurz.com`.
   Preview deployments on `*.pages.dev` are not registered, so sign-in fails
   there by design.
4. **The CI workflow is safe for outside contributions.**
   [ci.yml](../.github/workflows/ci.yml) runs on `pull_request` (not
   `pull_request_target`), with `contents: read` permissions and no secrets.
5. **Third-party access is narrow.** The Cloudflare GitHub app can read only
   `lukaskurz/openPlan3D`. Google sees only the files the app creates
   (`drive.file`), and iCloud only this container.

## Audit (20 October 2026)

**History and tree scan.** Every line ever added in any commit reachable from
any branch, tag or stash, and every tracked file as it is now, was scanned for
these patterns: AWS keys; Google API keys, OAuth client IDs and client secrets;
Anthropic and OpenAI keys; GitHub, Slack, Stripe and npm tokens; private key
blocks; service-account fields; JWTs; quoted secret assignments; and the three
CloudKit tokens.

| Match | Where | Verdict |
| --- | --- | --- |
| `sk-ant-test-0123456789abcdefghij`, `sk-ant-api03-abcdefghijklmnopqrstuvwxyz` | [tests/assistant-features.test.ts](../tests/assistant-features.test.ts) | Fake test values |
| `sk-ant-dry-run-000…` | `tooling/assistant-eval/run.eval.ts` (history) | Placeholder for dry runs |
| `secret: '0123456789abcdef…'` | Assistant share tests | Fake test value |
| `TOKEN_KEY = 'openplan3d-google-token'` | [googleIdentity.ts](../src/lib/services/cloudSync/googleIdentity.ts) | A storage key name, not a token |
| `AIzaSyBA-uD9…` | [src/lib/firebase.ts](../src/lib/firebase.ts) | Upstream's public Firebase web key |
| Google client ID, client secret, any CloudKit token | — | **Not found** anywhere in history or tree |

Files that were ever committed and look like configuration: only
`.env.example` (empty values) and `.npmrc` (`engine-strict=true`). No `.env`,
key file or service-account JSON has ever been committed.

**Live site.** `_app/env.js` holds exactly the four `PUBLIC_*` values.
`/editor` and other deep links are served. The page contacts
`accounts.google.com` and `www.googleapis.com` (sign-in and Drive) and, at
the time, also `firebase.googleapis.com`, `www.googletagmanager.com` and
`region1.google-analytics.com`: upstream analytics, loaded unless a deployment
opted out. Analytics are now opt-in (`PUBLIC_ENABLE_ANALYTICS=true`), so the
site no longer contacts them.

**One thing to know.** During setup the Google Cloud console showed the new
client's secret once in the browser, and it appeared in this session's
screenshots. It was never written to a file or variable, and the app does not
use it. Disabling it ([action 3](#actions)) makes that moot.

## Actions

In order of importance:

1. **Analytics (done).** They are off unless a deployment sets
   `PUBLIC_ENABLE_ANALYTICS=true`. To add analytics of your own, point
   [src/lib/firebase.ts](../src/lib/firebase.ts) at your own Firebase project
   first, and mention it in a privacy notice.
2. **Version guard (done).** Deployed with the analytics change. It stops a
   stale tab or an older deployment from overwriting plans saved by newer code
   (see [cloud-sync.md](cloud-sync.md#plans-saved-by-a-newer-app-version)).
3. **Disable the unused Google client secret.** In Google Cloud → Google Auth
   Platform → Clients → `openFloorplan web`, disable or delete the client
   secret. The browser flow does not use it.
4. **Delete the unused CloudKit token** `openfloorplan-web` in the CloudKit
   Console (development environment → Tokens & Keys).
5. **Protect `main`.** On GitHub, require pull requests (or at least block force
   pushes) for `main`, since every push deploys. Keep two-factor
   authentication on GitHub, Cloudflare, Google and Apple; those accounts are
   the real keys to this setup.
6. **Limit preview deployments**, unless you use them. Cloudflare Pages →
   Settings → Builds → Branch control: set previews to *None* or to selected
   branches. Previews cannot sign in anyway, and every pushed branch currently
   builds one.
7. **Add security headers.** A `static/_headers` file lets Cloudflare send a
   Content-Security-Policy that limits scripts to this site, Google
   (`accounts.google.com`) and Apple (`cdn.apple-cloudkit.com`). That is the
   main defence for the visitor tokens kept in the browser. Test it against
   the 3D viewer and the Assistant before relying on it.
8. **Before inviting others:** publish the Google consent screen (needs a home
   page and a privacy policy on the domain), and say in the privacy policy
   where plans are stored.

## Routine tasks

- **Rotate the CloudKit production token:** create a new token in the
  production environment limited to the domain, update
  `PUBLIC_CLOUDKIT_API_TOKEN` in Cloudflare, redeploy, then delete the old
  token.
- **Rotate the Google client:** create a new web client with the same origins,
  update `PUBLIC_GOOGLE_CLIENT_ID`, redeploy, then delete the old client.
  Existing Drive files stay; `drive.file` access belongs to the Cloud project,
  not the client.
- **Add a domain:** add it as an authorized JavaScript origin of the Google
  client and as an allowed domain of the production CloudKit token (create a
  new token if editing does not save), then attach it in Cloudflare Pages.
- **Change the CloudKit schema:** change it in development, then use **Deploy
  Schema Changes…**. Production can only gain fields and types, never lose
  them.
- **Change the saved plan format:** bump `PROJECT_FORMAT`
  ([CONTRIBUTING.md](../CONTRIBUTING.md#changing-the-saved-plan-format)).
- **Never commit** `.env`, a filled-in `.env.example`, service-account JSON,
  `.p8`/`.pem` keys, or any value from a provider page labelled secret. If it
  happens, rotate first; rewriting history does not undo a push to a public
  repository.
