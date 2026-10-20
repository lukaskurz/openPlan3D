# Library sync with Google Drive or iCloud

The project library can sync with the user's **own** Google Drive or iCloud
account, so a plan drawn on a Mac opens on an iPad and the other way round.
Sync runs entirely in the browser. **No backend is involved**, so it works
from static hosting too. The browser talks to Google's or Apple's APIs
directly, and plans go into the user's own cloud storage. The browser keeps
its local library as the working copy: saving never waits for the network,
and sync runs in the background, catching up when the device is back online.

The library shows a **Sync across devices** panel. It only appears when the
deployment is configured for at least one provider (see below). Each browser
connects to one account at a time.

## What syncs, and when

- **What:** each plan's JSON and its library preview. Version history and
  library backups stay on the device.
- **Library:** syncs when it opens, when you come back to the tab or window,
  after you rename, duplicate, delete, import or restore a plan, and when you
  press **Sync now**.
- **Editor:** brings the plan up to date before opening it, waiting at most 5
  seconds. It uploads the plan a few seconds after each save, so the preview
  captured after the save usually goes with it. When you come back to the tab
  with no unsaved edits, a newer version from another device is loaded.
- **Deleting** a plan deletes it on the other devices too. In Google Drive it
  goes to the Drive trash, so it can be restored from there. If a plan was
  edited on another device after you deleted it, the edits win and the plan
  comes back.
- **Conflicts:** when the same plan changed on two devices since they last
  synced, both versions are kept. This device's version keeps the plan. The
  other version is added as "*name* (Conflicted copy)", and the library names
  it.
- **Google pauses about once an hour.** Without a backend, Google gives a
  browser one-hour access tokens and no refresh token, and a new token can
  only be requested from a tap or click. When access runs out, sync pauses.
  The library shows **Continue**, and the editor shows a small "sync is
  paused" notice. One tap resumes sync: if you are still signed in to
  Google, its popup closes by itself. Nothing is lost while paused, because
  sync compares the library with the cloud and catches up. iCloud has no
  such pause: CloudKit JS keeps its sign-in.
- **Disconnect** forgets this browser's link to the account. The plans stay
  in the library and in the cloud. Connecting a different account never
  deletes local plans: sync records are kept per account.

### Where the files are

- **Google Drive:** a folder named **openPlan3D** in My Drive, with one
  `*.openplan3d.json` file per plan. Previews are in its **Previews**
  subfolder. The app uses the `drive.file` scope, so it can only see files
  it created itself. Renaming or moving the files in Drive is fine:
  identity comes from file properties, not names. Drive keeps a revision
  history for each file.
- **iCloud:** records of type `Plan` in a zone named `openPlan3D` in the
  user's private CloudKit database. They count against the user's iCloud
  storage. They are not visible in the Files app. Plans up to about 700 KB
  are stored inline. Larger plans, such as those with embedded 3D models,
  are stored as an asset.

## Setting up Google Drive

1. In Google Cloud Console, create (or pick) a project and enable the
   **Google Drive API**.
2. Configure the **OAuth consent screen** (Google Auth Platform): an
   External app with the scope `https://www.googleapis.com/auth/drive.file`.
   This is a non-sensitive scope, so Google's security assessment is not
   required. While the app is in *Testing*, only the test users you list can
   sign in, which is enough for personal use. Publish it to let anyone use
   it.
3. Create an **OAuth client ID** of type *Web application*. Under
   **Authorized JavaScript origins**, add every address the app is served
   from:
   - `https://<your-host>`
   - for development: `http://localhost:5173`

   No redirect URIs are needed. Google accepts only HTTPS origins and
   `localhost`, so a plain-HTTP network address such as
   `http://192.168.1.20:5173` cannot sign in.
4. Set `PUBLIC_GOOGLE_CLIENT_ID` to the client ID. It is a public
   identifier, not a secret. There is no client secret to configure.

### How the Google sign-in works

Google's sign-in library (Google Identity Services, token model) is loaded
from `accounts.google.com`. It is loaded ahead of time so that **Connect**
and **Continue** can open Google's popup within the tap itself; browsers
block popups that start later.

Google returns a one-hour access token, limited to files this app created.
The token is kept in `localStorage` until it expires, so reloads and other
tabs reuse it. The account's email is kept too, to preselect the account
when continuing. Disconnecting forgets both. It does not revoke the grant,
because that would also pause your other devices. To remove access
everywhere, use the Google Account's *Third-party apps & services* page.

## Setting up iCloud (CloudKit)

iCloud needs an Apple Developer Program membership.

1. In Certificates, Identifiers & Profiles, create an **iCloud container**,
   e.g. `iCloud.com.example.openplan3d`.
2. In the CloudKit Console, open the container and go to **Tokens & Keys**.
   API tokens belong to one environment, so create one for each:
   - **Production**: sign-in callback *Post Message*. Allowed origins: only
     the addresses the app is served from.
   - **Development**: sign-in callback *Post Message*. Allowed origins:
     **Any Domain**. The console prefixes every allowed domain with
     `https://`, and `localhost` then matches only `https://localhost` on
     port 443, never a dev server such as `http://localhost:5173`. Any
     Domain is acceptable here: development data is separate from
     production, and only developers sign in to it.

   A new token can take a few minutes before Apple's API accepts it. Until
   then every request fails with `AUTHENTICATION_FAILED`. Editing an
   existing token's origins did not reliably save, so create a new token
   instead.
3. Set these variables:

   | Variable | Value |
   | --- | --- |
   | `PUBLIC_CLOUDKIT_CONTAINER` | The container identifier. With the token, it shows **Connect iCloud**. |
   | `PUBLIC_CLOUDKIT_API_TOKEN` | The API token. It is public by design and limited to the allowed origins. |
   | `PUBLIC_CLOUDKIT_ENVIRONMENT` | `development` (default) or `production`. |

4. Create the `Plan` record type yourself. CloudKit Web Services does not
   create it on first save. Until it exists, every plan fails with "could
   not find record_type with name 'Plan'". In the CloudKit Console, open
   the **development** environment, go to **Record Types**, add `Plan` and
   give it these fields, then **Save Changes**:

   | Field | Type |
   | --- | --- |
   | `name` | String |
   | `data` | String |
   | `dataAsset` | Asset |
   | `thumbnail` | String |
   | `thumbnailHash` | String |

   No indexes are needed: sync reads the zone's changes and fetches records
   by name, and never queries. Before switching to `production`, choose
   **Deploy Schema Changes…**.

The CloudKit JS library is loaded from Apple's CDN only after someone connects
iCloud, or when a browser that connected before opens the library or the
editor. **Connect iCloud** shows Apple's **Sign in with Apple ID** button, and
Apple's sign-in opens in a popup. CloudKit JS remembers the session, so
returning visits stay signed in.

## Static hosting

Sync needs no server, so the app can be hosted statically. Run
`npm run build:static`: it builds a single-page app into `build/`, where every
route is served from `index.html`. On Cloudflare Pages:

- Build command `npm run build:static`, output directory `build`.
- Set the `PUBLIC_*` variables above as build variables of the production
  environment. They are baked into `_app/env.js` at build time. Use the
  production CloudKit token, with `PUBLIC_CLOUDKIT_ENVIRONMENT=production`.
- With no `404.html` present, Pages serves `index.html` for unknown paths,
  which is what the single-page build needs.

A static build has no server endpoints. The hosted Assistant, Assistant
shares, the MCP connector and capture uploads are unavailable there. The
editor, the library, sync and the Assistant with a personal key keep working.

## Code map

- `src/lib/services/cloudSync/engine.ts`: provider-neutral reconciliation.
  It compares each plan's local hash and remote version with what was last
  agreed, then uploads, downloads, deletes or keeps both.
- `src/lib/services/cloudSync/localLibrary.ts`: library reads and
  compare-and-write updates. An edit saved while sync is running is never
  overwritten; it is picked up on the next pass.
- `src/lib/services/cloudSync/googleDrive.ts` and `cloudKit.ts`: the two
  providers. `googleIdentity.ts` handles Google's browser sign-in.
- `src/lib/stores/cloudSync.ts`: connection state, sign-in, and the sync
  triggers used by the library page (`CloudSyncPanel.svelte`) and the editor
  (`CloudSyncPausedNotice.svelte`).
- Tests: `tests/cloud-sync.test.ts` covers the engine, simulating two devices
  that share an in-memory cloud. `tests/cloud-sync-providers.test.ts` covers
  the providers and Google's browser sign-in.
