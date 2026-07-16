import { useState } from 'react';
import type { PendingAction } from '../pendingAction';
import type {
  MintingAccountInfo,
  MintingAccountsResult,
  MintingStatus,
  QdnSelectedAccount,
  ResolvedIdentity,
} from '../types';
import { Avatar, CopyAddressButton, EmptyState, Notice, SkeletonPanel, StatTile } from '../ui';

type AsyncState<T> = { error?: string; loading: boolean; value: T };

export type SelectedMintingDetails = {
  blocksMinted: number | null;
  isMember: boolean;
  level: number | null;
  sharePercent: number | null;
};

function formatSharePercent(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function pendingLabel(pending: PendingAction) {
  if (pending.phase === 'signing') return 'Waiting for approval…';
  if (pending.phase === 'timeout') return 'This is taking longer than expected. You can refresh to check the latest state.';
  if (pending.phase === 'confirmed') {
    if (pending.kind === 'join') return 'Minting-group membership confirmed.';
    if (pending.kind === 'remove') return 'Minting key removed.';
    return pending.goal === 'reward-share'
      ? 'Minting authorization confirmed. Start minting again to load the key onto this node.'
      : 'Minting key is active on this node.';
  }
  if (pending.kind === 'remove') return 'Checking that the key was removed…';
  return 'Waiting for the network to record this action…';
}

function MintingAccount({
  account,
  canRemove,
  onRemove,
  pending,
}: {
  account: MintingAccountInfo;
  canRemove: boolean;
  onRemove: (account: MintingAccountInfo) => void;
  pending: PendingAction | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const removing = pending?.kind === 'remove'
    && pending.targetPublicKey === account.publicKey
    && (pending.phase === 'signing' || pending.phase === 'pending');

  return (
    <article className="minting-account">
      <Avatar className="identity__avatar" name={account.name} src={account.avatarSrc} />
      <div>
        <strong title={account.address}>{account.name ?? account.address}</strong>
        <p className="mono">
          Level {account.level ?? '—'} · {account.blocksMinted?.toLocaleString() ?? '—'} blocks
        </p>
        <CopyAddressButton address={account.address} />
      </div>
      {canRemove && account.publicKey ? (
        <div className="minting-account__actions">
          {confirming ? (
            <>
              <span>Remove this key from the node?</span>
              <button
                className="button--danger"
                disabled={removing}
                onClick={() => onRemove(account)}
                type="button"
              >
                {removing ? 'Removing…' : 'Confirm remove'}
              </button>
              <button
                className="minor-button"
                disabled={removing}
                onClick={() => setConfirming(false)}
                type="button"
              >
                Cancel
              </button>
            </>
          ) : (
            <button className="minor-button" onClick={() => setConfirming(true)} type="button">
              Remove key
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function MyMinting({
  account,
  accounts,
  canJoin,
  canRemove,
  canStart,
  details,
  identity,
  onBlocks,
  onJoin,
  onRemove,
  onStart,
  onlineCount,
  pending,
  status,
}: {
  account: QdnSelectedAccount | null;
  accounts: AsyncState<MintingAccountsResult>;
  canJoin: boolean;
  canRemove: boolean;
  canStart: boolean;
  details: AsyncState<SelectedMintingDetails | null>;
  identity: ResolvedIdentity | null;
  onBlocks: () => void;
  onJoin: () => void;
  onRemove: (account: MintingAccountInfo) => void;
  onStart: () => void;
  onlineCount: number;
  pending: PendingAction | null;
  status: AsyncState<MintingStatus | null>;
}) {
  const firstLoad = (status.loading || accounts.loading) && !status.value && !accounts.value.accounts.length;
  if (firstLoad) return <SkeletonPanel label="Loading minting status" />;

  const verdict = !account
    ? 'Connect your account'
    : status.value?.isMinting === true
      ? 'You are minting'
      : status.value?.isMinting === false
        ? 'You are not minting yet'
        : 'Node-side minting status unavailable';
  const name = identity?.name ?? account?.name ?? null;

  return (
    <section className="workspace">
      <div className="card hero">
        <p className="eyebrow">My Minting</p>
        <h2>{verdict}</h2>

        {account ? (
          <div className="selected-account" title={account.address}>
            <Avatar
              className="identity__avatar"
              name={name}
              src={identity?.avatarSrc ?? account.avatarUrl}
            />
            <div>
              <strong>{name ?? account.address}</strong>
              <p className="mono">{account.address}</p>
            </div>
          </div>
        ) : (
          <p className="muted">Choose an account in Qortium Home to manage its minting.</p>
        )}

        <details>
          <summary>Details</summary>
          <dl className="stats-grid">
            <div>
              <dt>Level</dt>
              <dd>{details.value?.level ?? '—'}</dd>
            </div>
            <div>
              <dt>Blocks minted</dt>
              <dd>{details.value?.blocksMinted?.toLocaleString() ?? '—'}</dd>
            </div>
            <div>
              <dt>Minting group</dt>
              <dd>{details.value ? (details.value.isMember ? 'Member' : 'Not joined') : '—'}</dd>
            </div>
            <div>
              <dt>Reward share</dt>
              <dd>{status.value?.hasRewardShare ? 'Authorized' : 'Not ready'}</dd>
            </div>
            <div>
              <dt>Share</dt>
              <dd>{formatSharePercent(details.value?.sharePercent)}</dd>
            </div>
            <div>
              <dt>Node key</dt>
              <dd>{status.value?.keyOnNode === null ? 'Unavailable' : status.value?.keyOnNode ? 'Loaded' : 'Not loaded'}</dd>
            </div>
          </dl>
        </details>

        {status.error ? <Notice tone="error">{status.error}</Notice> : null}
        {details.error ? <Notice tone="error">{details.error}</Notice> : null}
        {pending ? (
          <p
            className={`pending-status pending-status--${pending.phase}`}
            role="status"
          >
            {pendingLabel(pending)}
          </p>
        ) : null}

        <div className="action-row">
          {canJoin ? (
            <button disabled={pending?.phase === 'signing' || pending?.phase === 'pending'} onClick={onJoin} type="button">
              Join minting group
            </button>
          ) : null}
          {canStart ? (
            <button disabled={pending?.phase === 'signing' || pending?.phase === 'pending'} onClick={onStart} type="button">
              Start minting
            </button>
          ) : null}
        </div>
      </div>

      <StatTile label="Online now" onClick={onBlocks} value={onlineCount.toLocaleString()} />

      <div className="card">
        <h2>Minting accounts</h2>
        {accounts.error ? <Notice tone="error">{accounts.error}</Notice> : null}
        {!accounts.value.available ? (
          <p className="muted">This connected node does not make its minting-key list available.</p>
        ) : !accounts.value.accounts.length ? (
          accounts.loading
            ? <SkeletonPanel label="Loading minting accounts" />
            : <EmptyState>No minting keys are loaded on this node.</EmptyState>
        ) : (
          accounts.value.accounts.map((item) => (
            <MintingAccount
              account={item}
              canRemove={canRemove}
              key={item.address}
              onRemove={onRemove}
              pending={pending}
            />
          ))
        )}
      </div>
    </section>
  );
}
