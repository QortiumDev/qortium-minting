// Intentionally outside the i18n catalog: this is an always-English protocol reference.
import { ReferenceNavigation } from '../ReferenceNavigation';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { copyTextToClipboard } from '../clipboard';
import { AVATAR_MAX_BYTES } from '../avatarClient';
import { buildGroupMembersPath, getPayoutConfig, MINTING_GROUP_ID } from '../coreApi';
import { GROUP_MEMBER_PAGE_SIZE, GROUP_MEMBER_MAX_PAGE_SIZE, RESOLVE_IDENTITIES_LIMIT, PENDING_ACTION_TIMEOUT_MS } from '../mintingConstants';

export const MINTING_REFERENCE_ENDPOINTS = [
  `GET /groups/members/${MINTING_GROUP_ID}?limit&offset&reverse&onlyAdmins`,
  'GET /addresses/{address}',
  'GET /addresses/online',
  'GET /admin/mintingaccounts',
  'GET /admin/status',
  'GET /blocks/height',
  'GET /blocks/range/{height}?count&reverse',
  'GET /blocks/byheight/{height}/mintinginfo',
  'GET /blocks/onlineaccounts/{height}',
  'GET /transactions/signature/{sig}',
];

export const MINTING_REFERENCE_EXAMPLES = {
  'minting-status': "qdnRequest({ action: 'GET_MINTING_STATUS', address })",
  'start-minting': [
    "const result = await qdnRequest({ action: 'START_MINTING' })",
    '// rewardSharePending: wait for transactionSignature confirmation, then start again to add the key.',
    '// keyAdded: verify keyOnNode and hasRewardShare; submission alone is not confirmation.',
  ].join('\n'),
  'join-group': `qdnRequest({ action: 'JOIN_GROUP', groupId: ${MINTING_GROUP_ID} })`,
  'resolve-identities': [
    "qdnRequest({ action: 'RESOLVE_IDENTITIES', addresses })",
    `// Up to ${RESOLVE_IDENTITIES_LIMIT} addresses per request.`,
  ].join('\n'),
  minters: [
    "const actions = await qdnRequest({ action: 'SHOW_ACTIONS' });",
    'let offset = 0;',
    'const members = [];',
    'while (true) {',
    "  const response = actions.includes('GET_GROUP_MEMBERS')",
    `    ? await qdnRequest({ action: 'GET_GROUP_MEMBERS', groupId: ${MINTING_GROUP_ID}, limit: ${GROUP_MEMBER_PAGE_SIZE}, offset })`,
    `    : await qdnRequest({ action: 'FETCH_NODE_API', path: '${buildGroupMembersPath(MINTING_GROUP_ID).replace('offset=0&', '')}&offset=' + offset });`,
    "  if (!actions.includes('GET_GROUP_MEMBERS') && !response.ok) throw new Error(response.body);",
    "  const page = actions.includes('GET_GROUP_MEMBERS') ? response : response.data;",
    '  members.push(...page.members);',
    `  if (page.members.length < ${GROUP_MEMBER_PAGE_SIZE}) break;`,
    '  offset += page.members.length;',
    '}',
  ].join('\n'),
  'account-avatar': [
    "const actions = await qdnRequest({ action: 'SHOW_ACTIONS' })",
    "if (actions.includes('FETCH_ACCOUNT_AVATAR')) {",
    `  const avatar = await qdnRequest({ action: 'FETCH_ACCOUNT_AVATAR', address, maxBytes: ${AVATAR_MAX_BYTES} })`,
    "  // Render a validated base64 response as a Blob URL; retry PENDING only.",
    '}',
  ].join('\n'),
  'watch-tx': [
    'const response = await qdnRequest({',
    "  action: 'FETCH_NODE_API',",
    '  path: `/transactions/signature/${signature}`',
    '})',
    'if (!response.ok) throw new Error(response.body);',
    '// response.data.blockHeight > 0 means confirmed; a timeout leaves the outcome unknown.',
  ].join('\n'),
};

export function Reference() {
  const [copied, setCopied] = useState('');
  const payout = getPayoutConfig();

  async function copy(key: string, code: string, button: HTMLButtonElement) {
    setCopied(await copyTextToClipboard(code) ? key : 'unavailable');
    button.focus({ preventScroll: true });
  }

  return (
    <section className="workspace reference" lang="en" dir="ltr">
      <h2>Developer Reference</h2>
      <p>
        Qortium Minting contract, QAVS 1.4. Always-English protocol reference for the Minting QDN app. Core is
        authoritative; client validation is a fast preflight.
      </p>

      <ReferenceNavigation />
      <p role="status" aria-live="polite" className="copy-status">{copied === 'unavailable' ? 'Clipboard unavailable. Select the code and copy it manually.' : copied ? `Copied ${copied} example.` : 'Code examples can be selected for manual copying.'}</p>
      <div className="reference-scroll" role="region" aria-label="Developer reference content" tabIndex={0}>
      <div className="reference-grid">
        <article className="card" id="reference-contract" tabIndex={-1}>
          <h3>Transactions and validation</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Fields and Core rule</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>REWARD_SHARE</td>
                  <td>
                    <ul>
                      <li>A self-share creates minting authorization.</li>
                      <li>
                        Share percent is sent scaled by 100: <code>2.5%</code> is{' '}
                        <code>250</code>.
                      </li>
                      <li>The transaction must confirm before its key can be added to a node.</li>
                    </ul>
                  </td>
                </tr>
                <tr>
                  <td>START_MINTING</td>
                  <td>
                    Home either submits a missing self reward share (rewardSharePending), or adds the key when a confirmed share already exists (keyAdded). After confirmation, invoke Start again if the key is still absent. Each invocation requires approval.
                  </td>
                </tr>
                <tr>
                  <td>JOIN_GROUP</td>
                  <td>
                    Group <code>{MINTING_GROUP_ID}</code> is the minting group; membership is required for
                    eligibility and Home asks for approval.
                  </td>
                </tr>
                <tr>
                  <td>REMOVE_MINTING_ACCOUNT</td>
                  <td>
                    A node-admin operation: <code>DELETE /admin/mintingaccounts</code> with
                    the selected minting account’s base58 publicKey. The app does not need a private key. It is not a chain transaction and does not remove the on-chain reward share.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="card" id="reference-reads" tabIndex={-1}>
          <h3>Read endpoints</h3>
          {MINTING_REFERENCE_ENDPOINTS.map((endpoint) => (
            <code className="endpoint" key={endpoint}>{endpoint}</code>
          ))}
          <p>
            <code>/addresses/online</code> identifies online minters but does not provide a
            reward-share percentage. <code>blockHeight</code> appears on a transaction
            response once it is confirmed.
          </p>
        </article>

        <article className="card" id="reference-results" tabIndex={-1}>
          <h3>Minting status and batch rewards</h3>
          <p>
            <code>isMinting</code> is the overlap of node minting keys and an active reward
            share. Stored share percentages are divided by 100 for display.
          </p>
          <p>
            Previewnet batches use <code>batchSize {payout.blockRewardBatchSize}</code>,{' '}
            <code>accountsBlockCount {payout.blockRewardBatchAccountsBlockCount}</code>, and start at <code>{payout.blockRewardBatchStartHeight}</code> from{' '}
            <code>featureTriggers.blockRewardBatchStartHeight</code> in{' '}
            <code>previewchain.json</code>; the top-level <code>1508000</code> is only a
            fallback.
          </p>
          <p>
            The {payout.blockRewardBatchAccountsBlockCount} blocks before each batch boundary carry online-account data. Payout
            blocks return an empty decoded list even when their online count is positive
            because their signatures are pruned; ordinary online-window blocks decode
            normally. Each payout credits {payout.blockRewardBatchSize} blocks minted.
          </p>
        </article>

        <article className="card" id="reference-bridge" tabIndex={-1}>
          <h3>Bridge, QAVS, and feature detection</h3>
          <ul>
            <li>Use SHOW_ACTIONS before offering writes; public and network nodes trim action lists.</li>
            <li>IS_USING_PUBLIC_NODE describes node mode; it does not grant write authority. This app uses SHOW_ACTIONS, not GET_HOST_INFO or a version number, to detect capabilities. Home still validates account, trusted node and approval.</li>
            <li>START_MINTING, JOIN_GROUP, and REMOVE_MINTING_ACCOUNT prompt for approval.</li>
            <li>RESOLVE_IDENTITIES is limited to {RESOLVE_IDENTITIES_LIMIT} addresses per request.</li>
            <li>FETCH_ACCOUNT_AVATAR is feature-gated, returns pointer-aware image bytes, and may be PENDING.</li>
            <li>Keep batch identity resolution names-only; fetch avatars only for visible account UI.</li>
            <li>QAVS remains 1.4.x because all newer behavior is feature-detected.</li>
          </ul>

          <p>Minters prefers GET_GROUP_MEMBERS and otherwise uses FETCH_NODE_API with an explicit checked response envelope. It requests {GROUP_MEMBER_PAGE_SIZE} members per page (app cap {GROUP_MEMBER_MAX_PAGE_SIZE}) until a short page. Older Home builds with a lower action limit need the merged Home compatibility fix; an error is not an empty group.</p>
          <p>Account reads feature-detect GET_ACCOUNT_DATA, GET_ACCOUNT_GROUPS and GET_ACCOUNT_NAMES, with Core read fallbacks. GET_SELECTED_ACCOUNT identifies the active account; UNLOCK_SELECTED_ACCOUNT requests an unlock and SELECTED_ACCOUNT_CHANGED triggers a refresh. GET_NODE_STATUS and LIST_MINTING_ACCOUNTS provide connected-node state. Missing admin visibility is unknown, not proof that an account stopped minting.</p>
          <p>Home writes require an unlocked selected account and approval. START_MINTING and REMOVE_MINTING_ACCOUNT require a trusted node; public-node mode does not make admin operations available. Plain-browser development is read-only by default, with an explicit local API-key option for removing a node key. Never embed an API key or wallet secret in a published build.</p>
          <p>Membership, reward shares, blocks and transaction signatures are public chain data. Node key removal is a local administration change. The app verifies the resulting state and watches pending operations for {PENDING_ACTION_TIMEOUT_MS / 60_000} minutes; a timeout is an unknown outcome, so reconcile the signature and current state before retrying.</p>
          <p>The canonical Developers link is <code>?view=developers</code>. Read aliases <code>view=developer</code>, <code>view=reference</code> and <code>tab=reference</code> remain accepted. A recognized Developers view wins over tab. Other tabs keep their existing links; Home parameters, repeated unknown keys and fragments survive navigation.</p>
          {Object.entries(MINTING_REFERENCE_EXAMPLES).map(([key, code]) => (
            <div className="snippet" key={key}>
              <div className="snippet-head">
                <span>{key}</span>
                <button
                  className="minor-button"
                  aria-label={`Copy ${key} example`} onClick={event => void copy(key, code, event.currentTarget)}
                  type="button"
                >
                  <Copy size={15} />
                  {copied === key ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre aria-label={`${key} example`} tabIndex={0}>{code}</pre>
            </div>
          ))}
        </article>
      </div>
      </div>
    </section>
  );
}
