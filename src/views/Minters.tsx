import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { changeSortState, sortMinters, type SortState } from '../minterSort';
import { Avatar, EmptyState, Identity, Notice, SkeletonPanel, SortHeader } from '../ui';
import type { AccountEnrichment, MinterRow, ResolvedIdentity } from '../types';

export function Minters({
  enrichment,
  error,
  loading,
  onSelect,
  onShowMore,
  profiles,
  rows,
  selected,
  selectedAddress,
  setSort,
  sort,
  visibleCount,
}: {
  enrichment: Map<string, AccountEnrichment>;
  error?: string;
  loading: boolean;
  onSelect: (address: string) => void;
  onShowMore: () => void;
  profiles: Map<string, ResolvedIdentity>;
  rows: MinterRow[];
  selected: string | null;
  selectedAddress: string | null;
  setSort: (sort: SortState) => void;
  sort: SortState;
  visibleCount: number;
}) {
  const sorted = useMemo(() => sortMinters(rows, sort, enrichment), [enrichment, rows, sort]);

  if (selected) {
    const row = rows.find((item) => item.address === selected);
    if (!row) return null;
    const info = enrichment.get(selected);
    const profile = profiles.get(selected);

    return (
      <section className="workspace detail">
        <button className="minor-button" onClick={() => onSelect('')} type="button">
          <ArrowLeft size={15} />
          Back to minters
        </button>
        <div className="card detail-card">
          <Avatar
            className="detail-avatar"
            name={profile?.name ?? row.primaryName ?? null}
            src={profile?.avatarSrc ?? null}
          />
          <h2>{profile?.name ?? row.primaryName ?? row.address}</h2>
          <p className="mono">{row.address}</p>
          {selectedAddress === selected ? <span className="pill">This is you</span> : null}
          <dl className="stats-grid">
            <div><dt>Level</dt><dd>{info?.level ?? '—'}</dd></div>
            <div><dt>Blocks minted</dt><dd>{info?.blocksMinted?.toLocaleString() ?? '—'}</dd></div>
            <div>
              <dt>Joined</dt>
              <dd>{row.joined ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(row.joined) : '—'}</dd>
            </div>
          </dl>
        </div>
      </section>
    );
  }

  if (loading && !rows.length) return <SkeletonPanel label="Loading minters" />;
  if (!rows.length) {
    return (
      <section className="workspace">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <EmptyState>{error ? 'The minter list could not be loaded.' : 'No minters were found.'}</EmptyState>
      </section>
    );
  }

  return (
    <section className="workspace">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Minters</h2>
            <p className="muted">Members of the minting group, enriched with current account totals.</p>
          </div>
          {loading ? <span className="pill">Refreshing</span> : null}
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="table-wrap" role="region" tabIndex={0}>
          <table>
            <caption className="table-caption">
              Showing {Math.min(visibleCount, rows.length)} of {rows.length} minters
            </caption>
            <thead>
              <tr>
                <SortHeader onChange={(key) => setSort(changeSortState(sort, key))} sort={sort} sortKey="name">Account</SortHeader>
                <SortHeader onChange={(key) => setSort(changeSortState(sort, key))} sort={sort} sortKey="level">Level</SortHeader>
                <SortHeader onChange={(key) => setSort(changeSortState(sort, key))} sort={sort} sortKey="blocksMinted">Blocks minted</SortHeader>
                <SortHeader onChange={(key) => setSort(changeSortState(sort, key))} sort={sort} sortKey="joined">Joined</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, visibleCount).map((row) => {
                const profile = profiles.get(row.address);
                const info = enrichment.get(row.address);

                return (
                  <tr
                    key={row.address}
                    onClick={() => onSelect(row.address)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(row.address);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td>
                      <Identity
                        address={row.address}
                        avatarSrc={profile?.avatarSrc ?? null}
                        name={profile?.name ?? row.primaryName ?? null}
                      />
                      {row.isAdmin ? <span className="pill">Admin</span> : null}
                    </td>
                    <td className="mono">{info?.level ?? '—'}</td>
                    <td className="mono">
                      {info?.blocksMinted?.toLocaleString() ?? '—'}
                      {info?.blocksMintedPenalty ? <span className="pill">Penalized</span> : null}
                    </td>
                    <td>
                      {row.joined
                        ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(row.joined)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleCount < rows.length ? (
          <button className="minor-button" onClick={onShowMore} type="button">Show more</button>
        ) : null}
      </div>
    </section>
  );
}
