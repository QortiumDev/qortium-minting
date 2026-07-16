# Qortium Minting

A QDN app for monitoring and managing minting on the Core node connected to
Qortium Home. It shows node minting state, active minting accounts, selected
account identity and authorization state, current online accounts, and recent
blocks with the online accounts that signed them.

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

The app is at QAVS `1.4.0`: the `1.4` portion is its minimum Qortium platform
level and the patch number tracks the app release. `vite.config.ts` reads the
package version, injects the visible version badge, and emits
`dist/qortium-app.json` with the name `Minting` during every build.

Minting supports Classic and Modern QDN UI styles and follows Home theme,
accent, language, and text-size settings. It does not define a Fun style.

## Development and verification

```sh
npm install
npm run dev -- --host 127.0.0.1
npm test
npm run build
npm run preview
```

For an embedded smoke check, open `qdn://APP/Minting/Minting` in Qortium Home
with a selected account. Confirm that node status, active keys, online accounts,
and recent blocks load; display-setting changes apply; and only the bridge
actions advertised by the current Home build appear as management controls.

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
