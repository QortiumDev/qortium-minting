import { memo, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowDownUp, ArrowUp, Copy, Users } from 'lucide-react';
import { copyTextToClipboard } from './clipboard';
import { getAvatarFallbackCharacter } from './identityProfiles';
import { getAriaSort, type MinterSortKey, type SortState } from './minterSort';
import type { NodeStatus } from './types';

export function Notice({
  children,
  tone = 'info',
}: {
  children: ReactNode;
  tone?: 'error' | 'info' | 'warning';
}) {
  return <div className={`notice notice--${tone}`}>{children}</div>;
}

export function Avatar({
  className = '',
  name,
  src,
}: {
  className?: string;
  name: string | null;
  src: string | null;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return src && !failed ? (
    <img
      alt=""
      className={`${className} user-avatar`}
      onError={() => setFailed(true)}
      src={src}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`${className} user-avatar user-avatar--fallback`}
    >
      {getAvatarFallbackCharacter(name)}
    </span>
  );
}

export function CopyTextButton({
  label,
  text,
  textLabel = 'Copy',
}: {
  label: string;
  text: string;
  textLabel?: string;
}) {
  const [status, setStatus] = useState<'copied' | 'error' | 'idle'>('idle');
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    window.clearTimeout(timer.current);

    setStatus(await copyTextToClipboard(text) ? 'copied' : 'error');

    timer.current = window.setTimeout(() => setStatus('idle'), 1_800);
  }

  return (
    <button
      aria-label={label}
      className="minor-button"
      onClick={(event) => void copy(event)}
      type="button"
    >
      <Copy size={14} />
      {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : textLabel}
    </button>
  );
}

export function CopyAddressButton({
  address,
  label = 'Copy address',
  textLabel = 'Copy address',
}: {
  address: string;
  label?: string;
  textLabel?: string;
}) {
  return <CopyTextButton label={label} text={address} textLabel={textLabel} />;
}

export function AccountLink({
  address,
  avatarSrc,
  className = '',
  name,
  onOpen,
}: {
  address: string;
  avatarSrc: string | null;
  className?: string;
  name: string | null;
  onOpen: (address: string) => void;
}) {
  const label = name ?? `${address.slice(0, 8)}…${address.slice(-6)}`;

  return (
    <button
      aria-label={`View ${name ?? address}`}
      className={`account-link ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(address);
      }}
      title={address}
      type="button"
    >
      <Avatar className="identity__avatar" name={name} src={avatarSrc} />
      <span className={name ? '' : 'mono'}>{label}</span>
    </button>
  );
}

export function StatTile({
  label,
  onClick,
  value,
}: {
  label: string;
  onClick: () => void;
  value: ReactNode;
}) {
  return (
    <button className="stat-tile" onClick={onClick} type="button">
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

export function SkeletonPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-label={label} className="skeleton-panel" role="status">
      <span />
      <span />
      <span />
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <Users size={24} />
      <p>{children}</p>
    </div>
  );
}

export function SortHeader({
  children,
  onChange,
  sort,
  sortKey,
}: {
  children: ReactNode;
  onChange: (key: MinterSortKey) => void;
  sort: SortState;
  sortKey: MinterSortKey;
}) {
  const entry = sort.find((candidate) => candidate.key === sortKey);
  const Icon = !entry ? ArrowDownUp : entry.direction === 'asc' ? ArrowUp : ArrowDown;
  const rank = entry ? sort.indexOf(entry) : -1;

  return (
    <th aria-sort={getAriaSort(sort, sortKey)}>
      <button className="sort-button" onClick={() => onChange(sortKey)} type="button">
        {children}
        <Icon size={15} />
        {rank > 0 ? <sup>{rank + 1}</sup> : null}
      </button>
    </th>
  );
}

export function NodeSyncPill({
  height,
  status,
}: {
  height: number | null;
  status: NodeStatus | null;
}) {
  const syncing = status?.isSynchronizing === true;
  const connected = typeof status?.numberOfConnections === 'number'
    ? status.numberOfConnections > 0
    : true;
  const label = !status
    ? 'Connecting'
    : syncing
      ? `Syncing ${Math.round(status.syncPercent ?? 0)}%`
      : connected
        ? 'Synced'
        : 'No peers';

  return (
    <span
      className={`pill node-sync${syncing ? ' node-sync--syncing' : ''}`}
      title={height === null ? 'Block height unavailable' : `Block height ${height.toLocaleString()}`}
    >
      {label}
    </span>
  );
}

export const MinterRowCell = memo(function MinterRowCell({ children }: { children: ReactNode }) {
  return <>{children}</>;
});
