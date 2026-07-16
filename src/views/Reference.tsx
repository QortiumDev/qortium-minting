// Intentionally outside the i18n catalog: this is an always-English protocol reference.
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { copyTextToClipboard } from '../clipboard';

const endpoints = [
  'GET /groups/members/2?limit&offset&reverse&onlyAdmins',
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

const snippets = {
  'minting-status': "qdnRequest({ action: 'GET_MINTING_STATUS' })",
  'start-minting': [
    "const result = await qdnRequest({ action: 'START_MINTING' })",
    '// Watch result.transactionSignature or the resulting reward-share/key state.',
  ].join('\n'),
  'join-group': "qdnRequest({ action: 'JOIN_GROUP', groupId: 2 })",
  'resolve-identities': [
    "qdnRequest({ action: 'RESOLVE_IDENTITIES', addresses: [...] })",
    '// Up to 500 addresses per request.',
  ].join('\n'),
  minters: [
    "qdnRequest({ action: 'FETCH_NODE_API',",
    "  path: '/groups/members/2?limit=250&offset=0'",
    '})',
  ].join('\n'),
  'avatar-url': [
    "qdnRequest({ action: 'GET_QDN_RESOURCE_URL',",
    "  service: 'THUMBNAIL', name, identifier: 'avatar'",
    '})',
  ].join('\n'),
  'watch-tx': [
    'const tx = await qdnRequest({',
    "  action: 'FETCH_NODE_API',",
    '  path: `/transactions/signature/${signature}`',
    '})',
    '// tx.blockHeight > 0 means confirmed.',
  ].join('\n'),
};

export function Reference() {
  const [copied, setCopied] = useState('');

  async function copy(key: string, code: string) {
    setCopied(await copyTextToClipboard(code) ? key : 'unavailable');
  }

  return (
    <section className="workspace reference">
      <h2>Developer Reference</h2>
      <p>
        Always-English protocol reference for the Minting QDN app. Core is
        authoritative; client validation is a fast preflight.
      </p>

      <div className="reference-grid">
        <article className="card">
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
                    Home creates or ensures the reward share and adds its key to the node
                    after approval.
                  </td>
                </tr>
                <tr>
                  <td>JOIN_GROUP</td>
                  <td>
                    Group <code>2</code> is the minting group; membership is required for
                    eligibility and Home asks for approval.
                  </td>
                </tr>
                <tr>
                  <td>REMOVE_MINTING_ACCOUNT</td>
                  <td>
                    A node-admin operation: <code>DELETE /admin/mintingaccounts</code> with
                    a base58 reward-share key. It is not a chain transaction.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article className="card">
          <h3>Read endpoints</h3>
          {endpoints.map((endpoint) => (
            <code className="endpoint" key={endpoint}>{endpoint}</code>
          ))}
          <p>
            <code>/addresses/online</code> identifies online minters but does not provide a
            reward-share percentage. <code>blockHeight</code> appears on a transaction
            response once it is confirmed.
          </p>
        </article>

        <article className="card">
          <h3>Minting status and batch rewards</h3>
          <p>
            <code>isMinting</code> is the overlap of node minting keys and an active reward
            share. Stored share percentages are divided by 100 for display.
          </p>
          <p>
            Previewnet batches use <code>batchSize 100</code>,{' '}
            <code>accountsBlockCount 10</code>, and start at <code>55000</code> from{' '}
            <code>featureTriggers.blockRewardBatchStartHeight</code> in{' '}
            <code>previewchain.json</code>; the top-level <code>1508000</code> is only a
            fallback.
          </p>
          <p>
            The ten blocks before each batch boundary carry online-account data. Payout
            blocks return an empty decoded list even when their online count is positive
            because their signatures are pruned; ordinary online-window blocks decode
            normally. Each payout credits 100 blocks minted.
          </p>
        </article>

        <article className="card">
          <h3>Bridge, QAVS, and feature detection</h3>
          <ul>
            <li>Use SHOW_ACTIONS before offering writes; public and network nodes trim action lists.</li>
            <li>GET_HOST_INFO failure means an older host. IS_USING_PUBLIC_NODE reports write availability.</li>
            <li>START_MINTING, JOIN_GROUP, and REMOVE_MINTING_ACCOUNT prompt for approval.</li>
            <li>RESOLVE_IDENTITIES is limited to 500 addresses per request.</li>
            <li>GET_QDN_RESOURCE_URL returns avatar render URLs.</li>
            <li>QAVS remains 1.4.x because all newer behavior is feature-detected.</li>
          </ul>

          {Object.entries(snippets).map(([key, code]) => (
            <div className="snippet" key={key}>
              <div className="snippet-head">
                <span>{key}</span>
                <button
                  className="minor-button"
                  onClick={() => void copy(key, code)}
                  type="button"
                >
                  <Copy size={15} />
                  {copied === key ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre>{code}</pre>
            </div>
          ))}
        </article>
      </div>
    </section>
  );
}
