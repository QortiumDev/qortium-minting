import { ChevronDown, ChevronRight } from 'lucide-react';
import { isOnlineAccountsBlock, isPayoutBlock } from '../blockFilter';
import { AccountLink, EmptyState, Notice, SkeletonPanel } from '../ui';
import type { BlockSummary, ChainPayoutConfig, OnlineAccountEntry } from '../types';

type AsyncState<T> = { error?: string; loading: boolean; value: T };

export type BlockOnlineState = {
  entries: OnlineAccountEntry[];
  error?: string;
  loading: boolean;
};

function shortAddress(address: string) {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function formatRelative(timestamp: number | null, now: number) {
  if (!timestamp) return '—';
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
}

function OnlineAccountsTable({
  entries,
  emptyLabel,
  onOpenAccount,
}: {
  entries: OnlineAccountEntry[];
  emptyLabel: string;
  onOpenAccount: (address: string) => void;
}) {
  if (!entries.length) return <EmptyState>{emptyLabel}</EmptyState>;

  return (
    <div className="table-wrap online-accounts-wrap" role="region" tabIndex={0}>
      <table className="online-table">
        <thead>
          <tr>
            <th>Account</th>
            <th>Level</th>
            <th>Share</th>
            <th>Recipient</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.minter}-${index}`}>
              <td>
                <AccountLink
                  address={entry.minter}
                  avatarSrc={entry.avatarSrc}
                  name={entry.name}
                  onOpen={onOpenAccount}
                />
              </td>
              <td className="mono">{entry.level ?? '—'}</td>
              <td>{entry.sharePercent === null ? '—' : `${entry.sharePercent / 100}%`}</td>
              <td className="mono">
                {entry.recipient && entry.recipient !== entry.minter
                  ? shortAddress(entry.recipient)
                  : 'self'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Blocks({
  blocks,
  config,
  error,
  expanded,
  loading,
  now,
  onlineAccounts,
  onlineNow,
  onOpenAccount,
  onShowMore,
  onToggle,
  setSkipEmpty,
  showMore,
  skipEmpty,
  tip,
}: {
  blocks: BlockSummary[];
  config: ChainPayoutConfig;
  error?: string;
  expanded: number | null;
  loading: boolean;
  now: number;
  onlineAccounts: Map<number, BlockOnlineState>;
  onlineNow: AsyncState<OnlineAccountEntry[]>;
  onOpenAccount: (address: string) => void;
  onShowMore: () => void;
  onToggle: (height: number) => void;
  setSkipEmpty: (value: boolean) => void;
  showMore: boolean;
  skipEmpty: boolean;
  tip: number | null;
}) {
  const active = tip !== null && tip > config.blockRewardBatchStartHeight;

  return (
    <section className="workspace">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Online now</h2>
            <p className="muted">Accounts currently participating in the network.</p>
          </div>
          <span className="pill">{onlineNow.value.length.toLocaleString()} online</span>
        </div>
        {onlineNow.error ? <Notice tone="error">{onlineNow.error}</Notice> : null}
        {onlineNow.loading && !onlineNow.value.length
          ? <SkeletonPanel label="Loading online accounts" />
          : (
              <OnlineAccountsTable
                entries={onlineNow.value}
                emptyLabel="No accounts are currently online."
                onOpenAccount={onOpenAccount}
              />
            )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Blocks</h2>
            <p className="muted">Recent activity and the online-account snapshots recorded with it.</p>
          </div>
          {active ? (
            <label className="switch">
              <input
                checked={skipEmpty}
                onChange={(event) => setSkipEmpty(event.target.checked)}
                type="checkbox"
              />
              Skip empty blocks
            </label>
          ) : null}
        </div>

        {active && skipEmpty ? (
          <p className="field-help">
            Between payouts most blocks carry no minter data; this shows just the blocks that matter.
          </p>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {loading && !blocks.length ? <SkeletonPanel label="Loading blocks" /> : null}
        {!loading && !blocks.length ? <EmptyState>No blocks are available yet.</EmptyState> : null}

        {blocks.length ? (
          <ol className="block-list">
            {blocks.map((block) => {
              const payout = isPayoutBlock(block.height, config);
              const windowBlock = isOnlineAccountsBlock(block.height, config);
              const expandable = !payout && windowBlock && (block.onlineAccountsCount ?? 0) > 0;
              const state = onlineAccounts.get(block.height);
              const summary = (
                <>
                  {expandable ? (
                    <button
                      aria-expanded={expanded === block.height}
                      aria-label={`${expanded === block.height ? 'Collapse' : 'Expand'} block ${block.height}`}
                      className="block-toggle"
                      onClick={() => onToggle(block.height)}
                      type="button"
                    >
                      {expanded === block.height
                        ? <ChevronDown aria-hidden="true" size={16} />
                        : <ChevronRight aria-hidden="true" size={16} />}
                      <strong className="mono">#{block.height.toLocaleString()}</strong>
                    </button>
                  ) : (
                    <span className="block-row__height">
                      <strong className="mono">#{block.height.toLocaleString()}</strong>
                    </span>
                  )}
                  {block.minterAddress ? (
                    <AccountLink
                      address={block.minterAddress}
                      avatarSrc={block.minterAvatarSrc}
                      className="block-minter"
                      name={block.minterName}
                      onOpen={onOpenAccount}
                    />
                  ) : (
                    <span className="block-minter">Unknown minter</span>
                  )}
                  <span>{block.onlineAccountsCount ?? '—'} online</span>
                  <span>
                    {payout ? <span className="pill">Payout</span> : null}
                    {!payout && windowBlock ? <span className="pill">Online accounts</span> : null}
                  </span>
                  <time
                    dateTime={block.timestamp ? new Date(block.timestamp).toISOString() : undefined}
                    title={block.timestamp ? new Date(block.timestamp).toLocaleString() : undefined}
                  >
                    {formatRelative(block.timestamp, now)}
                  </time>
                </>
              );

              return (
                <li className="block-row" key={block.height}>
                  <div className="block-row__summary">{summary}</div>

                  {payout ? (
                    <p className="field-help">
                      Payout block — distributes batch rewards; per-account signatures are pruned, so the online list cannot be shown.
                    </p>
                  ) : null}

                  {expanded === block.height ? (
                    <div className="block-row__panel">
                      {state?.loading ? <SkeletonPanel label="Loading block snapshot" /> : null}
                      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
                      {state && !state.loading && !state.error ? (
                        <OnlineAccountsTable
                          entries={state.entries}
                          emptyLabel="No online accounts were recorded for this block."
                          onOpenAccount={onOpenAccount}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}

        {showMore ? (
          <button className="minor-button" disabled={loading} onClick={onShowMore} type="button">
            Show more
          </button>
        ) : null}
      </div>
    </section>
  );
}
