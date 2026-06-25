# Qortium Minting

A small QDN app for Qortium Home that reports the minting state of the connected
node. It shows whether the node is currently minting, the minting-key account's
on-chain info (address, registered name, level, blocks minted, balance), and a
list of recent blocks together with the online accounts that signed them, using
the current `qdnRequest` bridge.

The app holds no private keys and never signs transactions directly. All reads
go through Qortium Home's `qdnRequest` bridge when available, with a read-only
local Core node API fallback for plain browser development.

## Development

Install dependencies:

```sh
npm install
```

Run the app locally:

```sh
npm run dev -- --host 127.0.0.1
```

The local browser fallback reads from `http://127.0.0.1:24891` by default. Set
`VITE_QORTIUM_NODE_API_URL` to use another node during development.

Build and publish the app to the local Previewnet QDN test name:

```sh
npm run build
npm run qdn:publish
```

By default the publish helper uploads `dist/` as `qdn://APP/Minting/Minting`
through `http://127.0.0.1:24891`, using the local preview account files under
`~/git/qortium/preview`. The helper uses `QORTIUM_MINTING_NODE_API_KEY` or
`QORTIUM_MINTING_NODE_API_KEY_PATH` when set, then tries the API key for the
active local Core process, and finally falls back to
`~/.config/qortium-core/runtime/apikey.txt`. Set `QORTIUM_MINTING_QDN_NAME`,
`QORTIUM_MINTING_QDN_IDENTIFIER`, `QORTIUM_MINTING_QDN_TITLE`, or
`QORTIUM_MINTING_QDN_SERVICE` to publish another QDN resource.

## Qortium Home Smoke Check

Before publishing a new QDN build:

```sh
npm test
npm run build
```

Then open `qdn://APP/Minting/Minting` in Qortium Home with a local node
selected and an unlocked tab account. Confirm that the status pill reports Home,
the node minting state loads, the minting-key account summary renders, recent
blocks and their online accounts load, and Home display settings update theme,
text size, accent, and language in the app.

For a publish pass, confirm the local Core is fully synchronized before running
`npm run qdn:publish`. The expected identified render URL is
`http://127.0.0.1:24891/render/APP/Minting/Minting` (Home now passes the
identifier as a path segment; Core injects a matching `<base href>` so bundled
relative assets resolve under it), and the
published resource should report `READY` at
`/arbitrary/resource/status/APP/Minting/Minting?build=true`.

## Current Limits

This app does not handle private keys or transaction signing directly. It is a
read-only view of node and chain minting state. Browser development remains
read-only and reads directly from the local Core node API. The app targets
Qortium Previewnet (node API port `24891`).
