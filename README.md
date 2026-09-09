# Qortium Minting

A QDN app for monitoring and managing minting on the Core node connected to
Qortium Home. Its tabbed workspace separates **My Minting**, **Minters**,
**Blocks**, and an always-English **Developers** reference, rather than putting
all data in one long page.

My Minting focuses on the selected account, its key state, and actions. Minters
lists all minting-group members with names, avatars, levels, blocks minted,
multi-column sorting, and a detail view. Blocks keeps the full online-account
data close to the block that recorded it. Once Previewnet batch rewards are
active, **Skip empty blocks** is on by default and shows the ten online-account
window blocks plus their payout block; the preference is remembered locally.

The app polls the inexpensive chain height while visible and refreshes only the
affected data when a new block arrives. It pauses both polling and its display
ticker when the tab is hidden. The topbar refresh button always reloads the
active workspace view without blanking already loaded tables.

## Minting management

Inside Qortium Home, the app feature-detects bridge actions before offering
writes. The current start flow can:

1. read the selected account and ask Home to unlock it;
2. join Previewnet minting group `2` when the account is not yet a member;
3. submit minting authorization through `START_MINTING` when needed;
4. add the derived minting key to the connected node after authorization; and
5. remove a listed minting key through `REMOVE_MINTING_ACCOUNT`.

Home builds, approves, signs, and broadcasts the account operations; the app
does not hold private keys or sign transactions itself.

Without `window.qdnRequest`, the plain-browser fallback reads the local Core API
at `http://127.0.0.1:24891`. It has no selected account, unlock, join-group, or
start-minting flow. An explicit `VITE_QORTIUM_NODE_API_KEY` can enable local
minting-key removal for development; otherwise browser mode is read-only. Set
`VITE_QORTIUM_NODE_API_URL` to point reads at another node.

## QAVS and UI styles

The app is at QAVS `1.4.4`: the `1.4` portion is its minimum Qortium platform
level and the patch number tracks the app release. `vite.config.ts` reads the
package version, injects the visible version badge, and emits
`dist/qortium-app.json` with the name `Minting` during every build.

Minting supports Classic, Modern, and Fun QDN UI styles and follows Home theme,
accent, language, and text-size settings. All fonts are bundled locally; UI
families intentionally preserve the accent selected in Home. The workspace uses
the full available app window with responsive gutters; Modern keeps the roomiest
outer gutter while Classic and Fun stay tighter.

## Development and verification

```sh
npm install
npm run dev -- --host 127.0.0.1
npm test
npm run build
npm run preview
```

For an embedded smoke check, open `qdn://APP/Minting/Minting` in Qortium Home
with a selected account. Confirm that node status, active keys, minters, online
accounts, and recent blocks load; the batch filter leaves payout rows
non-expandable; display-setting changes apply; and only the bridge actions
advertised by the current Home build appear as management controls. The
Developers tab contains endpoint and bridge-call detail that is deliberately
kept out of the normal user flow.

## Previewnet publish

```sh
npm run build
npm run qdn:publish
```

The publisher uploads `dist/` as `APP/Minting/Minting` through the local Core at
`http://127.0.0.1:24891`. Its default account file is
`~/qortium/git/qortium-core/preview/secrets/initial-minting-accounts.json`.
API-key, node, account-file, identity, title, service, and dist overrides use the
`QORTIUM_MINTING_` prefix.

The identified render URL is
`http://127.0.0.1:24891/render/APP/Minting/Minting`. After publishing, the helper
waits for `/arbitrary/resource/status/APP/Minting/Minting?build=true` to report
`READY`.

The app currently targets Qortium Previewnet, whose default local Core API port
is `24891`.

## Developers workspace

This maintenance pass targets Qortium only. Open `?view=developers` for the
always-English in-app contract. `view=developer` and `view=reference` are read
aliases; recognized Developers views take precedence over other app routes.
Existing `tab=reference` links remain accepted and canonicalize to `view=developers`; other `tab` links remain valid.
Home parameters, repeated unknown query keys and fragments survive navigation.
Section links use the current render URL and scroll only the reference pane.
Copy feedback is announced; when copying is unavailable, examples stay selectable.
The reference imports implementation limits and has route/rendered-contract tests.
