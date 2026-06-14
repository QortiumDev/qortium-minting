import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getBlockOnlineAccounts,
  getCurrentHeight,
  getCurrentOnlineAccounts,
  getMintingStatus,
  getPayoutConfig,
  getRecentBlocks,
  isPayoutBlock,
  listMintingAccounts,
  removeMintingAccount,
} from './coreApi';
import { getBridgeState, hasAction, qdnRequest } from './qdnRequest';
import { applyDisplaySettings, getDisplaySettingsUpdateFromMessage, getInitialDisplaySettings } from './displaySettings';
import { normalizeLanguage } from './i18n';
import { getAvatarFallbackCharacter } from './avatarProfiles';
import type {
  BlockSummary,
  BridgeState,
  ChainPayoutConfig,
  MintingAccountInfo,
  MintingAccountsResult,
  MintingStatus,
  OnlineAccountEntry,
  QdnAction,
  QdnSelectedAccount,
} from './types';

type AsyncState<T> =
  | { error?: string; phase: 'idle' | 'loading'; value: T }
  | { error: string; phase: 'error'; value: T }
  | { phase: 'ready'; value: T };

const DEFAULT_BLOCK_COUNT = 25;
const BLOCK_COUNT_STEP = 25;
const MAX_BLOCK_COUNT = 200;

const emptyBlocks: BlockSummary[] = [];
const emptyMintingAccounts: MintingAccountsResult = { accounts: [], available: true };

function createState<T>(value: T): AsyncState<T> {
  return { phase: 'idle', value };
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getShortAddress(address: string) {
  if (address.length <= 16) {
    return address;
  }

  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getAccountLabel(name: string | null, address: string) {
  return name ?? getShortAddress(address);
}

function formatNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '—';
}

function formatLevel(level: number | null | undefined) {
  return typeof level === 'number' && Number.isFinite(level) ? String(level) : '—';
}

// Online-account share percent is stored as a scaled integer in Core
// (sharePercent * 100). Display it as a friendly percentage.
function formatSharePercent(sharePercent: number | null) {
  if (typeof sharePercent !== 'number' || !Number.isFinite(sharePercent)) {
    return null;
  }

  const percent = sharePercent / 100;
  const rounded = Math.round(percent * 100) / 100;

  return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function formatTimeAgo(timestamp: number | null, now: number) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return '—';
  }

  const totalMinutes = Math.floor(Math.max(0, now - timestamp) / 60000);

  if (totalMinutes < 1) {
    return 'just now';
  }

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  // Always show down to minutes; include larger units only when non-zero.
  // e.g. "23d 4h 12m ago", "4h 12m ago", "12m ago".
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m ago`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m ago`;
  }

  return `${minutes}m ago`;
}

function formatTimestamp(timestamp: number | null) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return '';
  }

  return new Date(timestamp).toLocaleString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isSelectedAccountChangedMessage(value: unknown) {
  return isRecord(value) && (
    value.type === 'qortium:selected-account-changed' ||
    value.action === 'SELECTED_ACCOUNT_CHANGED'
  );
}

function normalizeSelectedAccount(account: QdnSelectedAccount): QdnSelectedAccount {
  return {
    ...account,
    isUnlocked: account.isUnlocked === true,
  };
}

function Avatar({ className, name, src }: { className: string; name: string | null; src: string | null }) {
  if (src) {
    return <img alt="" className={`${className} user-avatar`} src={src} />;
  }

  return (
    <span aria-hidden="true" className={`${className} user-avatar user-avatar--fallback`}>
      {getAvatarFallbackCharacter(name)}
    </span>
  );
}

function CopyAddressButton({ address, label }: { address: string; label: string }) {
  const [status, setStatus] = useState<'copied' | 'error' | 'idle'>('idle');
  const timeoutRef = useRef(0);

  useEffect(() => {
    return () => window.clearTimeout(timeoutRef.current);
  }, []);

  async function copy() {
    window.clearTimeout(timeoutRef.current);

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable.');
      }

      await navigator.clipboard.writeText(address);
      setStatus('copied');
    } catch {
      setStatus('error');
    }

    timeoutRef.current = window.setTimeout(() => setStatus('idle'), 2000);
  }

  return (
    <button
      aria-label={label}
      className="copy-button"
      onClick={() => void copy()}
      title={label}
      type="button"
    >
      {status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

function LoadingRows({ count = 3, label }: { count?: number; label: string }) {
  return (
    <div className="skeleton-list" aria-label={label} role="status">
      {Array.from({ length: count }, (_, index) => (
        <span className="skeleton skeleton--row" key={index} />
      ))}
    </div>
  );
}

function MintingBanner({ isMinting, detail }: { isMinting: boolean; detail: string }) {
  return (
    <div className={`minting-banner minting-banner--${isMinting ? 'on' : 'off'}`} role="status">
      <span className="minting-banner__dot" aria-hidden="true" />
      <div className="minting-banner__text">
        <strong>{isMinting ? 'This node IS minting' : 'This node is NOT minting'}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function MintingAccountCard({
  account,
  canRemove,
  onRemove,
}: {
  account: MintingAccountInfo;
  canRemove: boolean;
  onRemove: (account: MintingAccountInfo) => Promise<void>;
}) {
  const label = getAccountLabel(account.name, account.address);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removable = canRemove && !!account.publicKey;

  async function handleRemove() {
    setRemoving(true);
    setError(null);

    try {
      await onRemove(account);
      // On success the list reloads and this card unmounts; no further state needed.
    } catch (caught) {
      setError(getErrorMessage(caught, 'Unable to remove this minting key.'));
      setRemoving(false);
      setConfirming(false);
    }
  }

  return (
    <article className="minting-account">
      <Avatar className="minting-account__avatar" name={account.name} src={account.avatarSrc} />
      <div className="minting-account__body">
        <div className="minting-account__heading">
          <strong title={account.address}>{label}</strong>
          {account.name ? <span className="minting-account__tag">name</span> : null}
        </div>
        <div className="minting-account__address-row">
          <code className="minting-account__address" title={account.address}>
            {account.address}
          </code>
          <CopyAddressButton address={account.address} label={`Copy address for ${label}`} />
        </div>
        <dl className="minting-account__stats">
          <div>
            <dt>Level</dt>
            <dd>{formatLevel(account.level)}</dd>
          </div>
          <div>
            <dt>Blocks minted</dt>
            <dd>{formatNumber(account.blocksMinted)}</dd>
          </div>
          {account.recipientAddress ? (
            <div>
              <dt>Recipient</dt>
              <dd title={account.recipientAddress}>{getShortAddress(account.recipientAddress)}</dd>
            </div>
          ) : null}
        </dl>
        {removable ? (
          <div className="minting-account__actions">
            {confirming ? (
              <>
                <span className="minting-account__confirm">Remove this key from the node?</span>
                <button
                  className="button button--danger"
                  disabled={removing}
                  onClick={handleRemove}
                  type="button"
                >
                  {removing ? 'Removing…' : 'Confirm remove'}
                </button>
                <button
                  className="button button--secondary"
                  disabled={removing}
                  onClick={() => setConfirming(false)}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button className="button button--danger-outline" onClick={() => setConfirming(true)} type="button">
                Remove key
              </button>
            )}
          </div>
        ) : null}
        {error ? <p className="error minting-account__error">{error}</p> : null}
      </div>
    </article>
  );
}

function MinterIdentity({
  address,
  name,
  level,
}: {
  address: string | null;
  name: string | null;
  level: number | null;
}) {
  if (!address) {
    return <span className="minter minter--unknown">Unknown minter</span>;
  }

  return (
    <span className="minter" title={address}>
      <Avatar className="minter__avatar" name={name} src={null} />
      <span className="minter__label">{getAccountLabel(name, address)}</span>
      <span className="minter__level">L{formatLevel(level)}</span>
    </span>
  );
}

type OnlineAccountsState = AsyncState<OnlineAccountEntry[]> & { loaded: boolean };

function OnlineAccountsTable({
  entries,
  minterAddress,
  emptyLabel = 'No online accounts recorded for this block.',
}: {
  entries: OnlineAccountEntry[];
  minterAddress: string | null;
  emptyLabel?: string;
}) {
  if (entries.length === 0) {
    return <p className="empty">{emptyLabel}</p>;
  }

  const minterPresent = !!minterAddress && entries.some((entry) => entry.minter === minterAddress);

  return (
    <div className="online-accounts">
      {minterAddress && !minterPresent ? (
        <p className="online-accounts__note">
          The block&apos;s minter isn&apos;t in this list — it wasn&apos;t part of the online-accounts
          snapshot taken for this block (the snapshot is recorded slightly before the block is minted).
        </p>
      ) : null}
      <div className="online-accounts__head" role="row">
        <span>Account</span>
        <span>Level</span>
        <span>Share</span>
        <span>Recipient</span>
      </div>
      <ol className="online-accounts__list">
        {entries.map((entry, index) => {
          const share = formatSharePercent(entry.sharePercent);
          const recipientDiffers =
            !!entry.recipient && entry.recipient !== entry.minter && entry.recipient !== minterAddress;
          const isMinter = !!minterAddress && entry.minter === minterAddress;

          return (
            <li
              className={`online-accounts__row${isMinter ? ' online-accounts__row--minter' : ''}`}
              key={`${entry.minter}-${index}`}
              role="row"
            >
              <span className="online-accounts__account">
                <Avatar className="online-accounts__avatar" name={entry.name} src={null} />
                <span className="online-accounts__name" title={entry.minter}>
                  {getAccountLabel(entry.name, entry.minter)}
                </span>
                {isMinter ? <span className="badge badge--minter">minter</span> : null}
              </span>
              <span className="online-accounts__level">L{formatLevel(entry.level)}</span>
              <span className="online-accounts__share">{share ?? '—'}</span>
              <span className="online-accounts__recipient">
                {recipientDiffers && entry.recipient ? (
                  <code title={entry.recipient}>{getShortAddress(entry.recipient)}</code>
                ) : (
                  <span className="muted">self</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function BlockRow({
  block,
  config,
  expanded,
  now,
  onlineAccounts,
  onToggle,
}: {
  block: BlockSummary;
  config: ChainPayoutConfig;
  expanded: boolean;
  now: number;
  onlineAccounts: OnlineAccountsState | undefined;
  onToggle: (height: number) => void;
}) {
  const payout = isPayoutBlock(block.height, config);
  const panelId = `online-accounts-${block.height}`;

  // A block is expandable when it carries online accounts to show beyond the row
  // header. The node now records the online accounts for every block, so any block
  // with onlineAccountsCount > 0 can be expanded to list them. Blocks with none
  // (e.g. non-online-accounts blocks once batch rewards activate) stay static.
  const expandable = (block.onlineAccountsCount ?? 0) > 0;
  const inner = (
    <>
      <span className="block-row__height">
        {expandable ? (
          <span className="block-row__caret" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
        ) : null}
        #{block.height.toLocaleString()}
      </span>
      <MinterIdentity address={block.minterAddress} name={block.minterName} level={block.minterLevel} />
      <span className="block-row__online" title="Online accounts that signed this block">
        {formatNumber(block.onlineAccountsCount)} online
      </span>
      <span className="block-row__badges">{payout ? <span className="badge badge--payout">payout</span> : null}</span>
      <time
        className="block-row__time"
        dateTime={block.timestamp ? new Date(block.timestamp).toISOString() : undefined}
        title={formatTimestamp(block.timestamp)}
      >
        {formatTimeAgo(block.timestamp, now)}
      </time>
    </>
  );

  if (!expandable) {
    return (
      <li className="block-row block-row--static">
        <div className="block-row__summary block-row__summary--static">{inner}</div>
      </li>
    );
  }

  return (
    <li className={`block-row${expanded ? ' block-row--expanded' : ''}`}>
      <button
        aria-controls={panelId}
        aria-expanded={expanded}
        className="block-row__summary"
        onClick={() => onToggle(block.height)}
        type="button"
      >
        {inner}
      </button>
      {expanded ? (
        <div className="block-row__panel" id={panelId}>
          {!onlineAccounts || onlineAccounts.phase === 'loading' || !onlineAccounts.loaded ? (
            <LoadingRows count={3} label="Loading online accounts" />
          ) : onlineAccounts.phase === 'error' ? (
            <p className="error">{onlineAccounts.error}</p>
          ) : (
            <OnlineAccountsTable entries={onlineAccounts.value} minterAddress={block.minterAddress} />
          )}
        </div>
      ) : null}
    </li>
  );
}

export default function App() {
  const [bridge, setBridge] = useState<AsyncState<BridgeState>>(
    createState({ actions: [], isHomeBridge: false, ui: 'BROWSER_DEV' }),
  );
  const [account, setAccount] = useState<QdnSelectedAccount | null>(null);
  const [mintingStatus, setMintingStatus] = useState<AsyncState<MintingStatus | null>>(createState(null));
  const [mintingAccounts, setMintingAccounts] =
    useState<AsyncState<MintingAccountsResult>>(createState(emptyMintingAccounts));
  const [blocks, setBlocks] = useState<AsyncState<BlockSummary[]>>(createState(emptyBlocks));
  const [height, setHeight] = useState<number | null>(null);
  const [blockCount, setBlockCount] = useState(DEFAULT_BLOCK_COUNT);
  const [expandedHeight, setExpandedHeight] = useState<number | null>(null);
  const [onlineAccountsByHeight, setOnlineAccountsByHeight] = useState<Record<number, OnlineAccountsState>>({});
  const [onlineNow, setOnlineNow] = useState<AsyncState<OnlineAccountEntry[]>>(createState<OnlineAccountEntry[]>([]));
  const [displaySettings, setDisplaySettings] = useState(getInitialDisplaySettings);
  const [now, setNow] = useState(() => Date.now());

  // Per-loader request tokens. Each loader captures an incremented id before
  // awaiting and only commits its result if it is still the latest request, so
  // a slower stale response cannot overwrite newer data (refresh / load-more /
  // selected-account changes can overlap in flight).
  const blocksRequestRef = useRef(0);
  const mintingStatusRequestRef = useRef(0);
  const mintingAccountsRequestRef = useRef(0);
  const onlineNowRequestRef = useRef(0);

  const actions = bridge.value.actions;
  const actionsKey = actions.join('\n');
  const payoutConfig = useMemo(() => getPayoutConfig(), []);
  const batchActive = height !== null && height > payoutConfig.blockRewardBatchStartHeight;

  const loadMintingStatus = useCallback(
    async (selectedAddress: string | null, actionList: QdnAction[]) => {
      const requestId = ++mintingStatusRequestRef.current;

      if (!selectedAddress) {
        setMintingStatus({ phase: 'ready', value: null });
        return;
      }

      setMintingStatus((current) => ({ phase: 'loading', value: current.value }));

      try {
        const status = await getMintingStatus(selectedAddress, actionList);

        if (requestId !== mintingStatusRequestRef.current) {
          return;
        }

        setMintingStatus({ phase: 'ready', value: status });
      } catch (error) {
        if (requestId !== mintingStatusRequestRef.current) {
          return;
        }

        setMintingStatus((current) => ({
          error: getErrorMessage(error, 'Unable to load minting status.'),
          phase: 'error',
          value: current.value,
        }));
      }
    },
    [],
  );

  const loadMintingAccounts = useCallback(async (actionList: QdnAction[]) => {
    const requestId = ++mintingAccountsRequestRef.current;

    setMintingAccounts((current) => ({ phase: 'loading', value: current.value }));

    try {
      const result = await listMintingAccounts(actionList);

      if (requestId !== mintingAccountsRequestRef.current) {
        return;
      }

      setMintingAccounts({ phase: 'ready', value: result });
    } catch (error) {
      if (requestId !== mintingAccountsRequestRef.current) {
        return;
      }

      setMintingAccounts((current) => ({
        error: getErrorMessage(error, 'Unable to load minting accounts.'),
        phase: 'error',
        value: current.value,
      }));
    }
  }, []);

  const loadOnlineNow = useCallback(async (actionList: QdnAction[]) => {
    const requestId = ++onlineNowRequestRef.current;

    setOnlineNow((current) => ({ phase: 'loading', value: current.value }));

    try {
      const entries = await getCurrentOnlineAccounts(actionList);

      if (requestId !== onlineNowRequestRef.current) {
        return;
      }

      setOnlineNow({ phase: 'ready', value: entries });
    } catch (error) {
      if (requestId !== onlineNowRequestRef.current) {
        return;
      }

      setOnlineNow((current) => ({
        error: getErrorMessage(error, 'Unable to load the current online accounts.'),
        phase: 'error',
        value: current.value,
      }));
    }
  }, []);

  const handleRemoveMintingAccount = useCallback(
    async (target: MintingAccountInfo) => {
      if (!target.publicKey) {
        throw new Error('This minting key has no public key to remove.');
      }

      await removeMintingAccount(target.publicKey, actions);
      // Reload the node's minting keys so the removed card disappears.
      await loadMintingAccounts(actions);
    },
    [actions, loadMintingAccounts],
  );

  const loadBlocks = useCallback(async (count: number, actionList: QdnAction[]) => {
    const requestId = ++blocksRequestRef.current;

    setBlocks((current) => ({ phase: 'loading', value: current.value }));

    try {
      const [nextHeight, nextBlocks] = await Promise.all([
        getCurrentHeight().catch(() => null),
        getRecentBlocks(count, actionList),
      ]);

      if (requestId !== blocksRequestRef.current) {
        return;
      }

      if (typeof nextHeight === 'number') {
        setHeight(nextHeight);
      } else if (nextBlocks.length > 0) {
        setHeight(nextBlocks[0].height);
      }

      setBlocks({ phase: 'ready', value: nextBlocks });
    } catch (error) {
      if (requestId !== blocksRequestRef.current) {
        return;
      }

      setBlocks((current) => ({
        error: getErrorMessage(error, 'Unable to load recent blocks.'),
        phase: 'error',
        value: current.value,
      }));
    }
  }, []);

  const connectSelectedAccount = useCallback(
    async (actionList: QdnAction[]) => {
      try {
        const selectedAccount = normalizeSelectedAccount(
          await qdnRequest<QdnSelectedAccount>({ action: 'GET_SELECTED_ACCOUNT' }),
        );

        setAccount(selectedAccount);
        void loadMintingStatus(selectedAccount.address, actionList);

        return selectedAccount;
      } catch {
        // No selected account (browser dev or not shared); fall back to the
        // node's own minting accounts to decide whether the node is minting.
        setAccount(null);
        setMintingStatus({ phase: 'ready', value: null });

        return null;
      }
    },
    [loadMintingStatus],
  );

  const initializeSession = useCallback(async () => {
    setBridge((current) => ({ phase: 'loading', value: current.value }));

    // getBridgeState() resolves its own fallback (LOCAL_READ_ACTIONS) instead of
    // throwing, so an empty action list is a safe starting point here.
    let nextActions: QdnAction[] = [];

    try {
      const nextBridge = await getBridgeState();
      nextActions = nextBridge.actions;
      setBridge({ phase: 'ready', value: nextBridge });
    } catch (error) {
      setBridge((current) => ({
        error: getErrorMessage(error, 'Unable to read the Qortium bridge state.'),
        phase: 'error',
        value: current.value,
      }));
    }

    void connectSelectedAccount(nextActions);
    void loadMintingAccounts(nextActions);
    void loadOnlineNow(nextActions);
    void loadBlocks(DEFAULT_BLOCK_COUNT, nextActions);
  }, [connectSelectedAccount, loadBlocks, loadMintingAccounts, loadOnlineNow]);

  useEffect(() => {
    // Run once on mount; initializeSession reads the latest bridge state itself.
    void initializeSession();
  }, [initializeSession]);

  useEffect(() => {
    applyDisplaySettings(displaySettings);
  }, [displaySettings]);

  useEffect(() => {
    const language = normalizeLanguage(displaySettings.language);

    document.documentElement.lang = language ?? 'en';
    document.title = 'Minting';
  }, [displaySettings.language]);

  useEffect(() => {
    function handleHostMessage(event: MessageEvent) {
      setDisplaySettings((current) => getDisplaySettingsUpdateFromMessage(event.data, current) ?? current);

      if (isSelectedAccountChangedMessage(event.data)) {
        void connectSelectedAccount(actions);
      }
    }

    window.addEventListener('message', handleHostMessage);

    return () => window.removeEventListener('message', handleHostMessage);
  }, [actions, connectSelectedAccount]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);

    return () => window.clearInterval(interval);
  }, []);

  const loadOnlineAccounts = useCallback(
    async (blockHeight: number, actionList: QdnAction[]) => {
      setOnlineAccountsByHeight((current) => ({
        ...current,
        [blockHeight]: { loaded: false, phase: 'loading', value: current[blockHeight]?.value ?? [] },
      }));

      try {
        const entries = await getBlockOnlineAccounts(blockHeight, actionList);
        setOnlineAccountsByHeight((current) => ({
          ...current,
          [blockHeight]: { loaded: true, phase: 'ready', value: entries },
        }));
      } catch (error) {
        setOnlineAccountsByHeight((current) => ({
          ...current,
          [blockHeight]: {
            error: getErrorMessage(error, 'Unable to load online accounts for this block.'),
            loaded: true,
            phase: 'error',
            value: current[blockHeight]?.value ?? [],
          },
        }));
      }
    },
    [],
  );

  function toggleBlock(blockHeight: number) {
    if (expandedHeight === blockHeight) {
      setExpandedHeight(null);
      return;
    }

    setExpandedHeight(blockHeight);

    const existing = onlineAccountsByHeight[blockHeight];

    if (!existing || (existing.phase === 'error' && !existing.loaded)) {
      void loadOnlineAccounts(blockHeight, actions);
    } else if (!existing.loaded && existing.phase !== 'loading') {
      void loadOnlineAccounts(blockHeight, actions);
    }
  }

  function refreshBlocks() {
    setExpandedHeight(null);
    setOnlineAccountsByHeight({});
    void loadBlocks(blockCount, actions);
  }

  function loadMoreBlocks() {
    const nextCount = Math.min(MAX_BLOCK_COUNT, blockCount + BLOCK_COUNT_STEP);

    setBlockCount(nextCount);
    void loadBlocks(nextCount, actions);
  }

  function refreshMintingStatus() {
    void loadMintingAccounts(actions);
    void loadMintingStatus(account?.address ?? null, actions);
  }

  function refreshOnlineNow() {
    void loadOnlineNow(actions);
  }

  // Removing a key is a node write the current bridge cannot do; it is available
  // when a REMOVE_MINTING_ACCOUNT action is present (Home support, or browser-dev
  // with VITE_QORTIUM_NODE_API_KEY set).
  const canRemove = hasAction(actions, 'REMOVE_MINTING_ACCOUNT');

  // The node is considered to be minting when it reports active minting keys, or
  // when the selected account's derived status says so.
  const accounts = mintingAccounts.value.accounts;
  const listingAvailable = mintingAccounts.value.available;
  const status = mintingStatus.value;
  const nodeIsMinting =
    (mintingAccounts.phase === 'ready' && listingAvailable && accounts.length > 0) || status?.isMinting === true;

  const bannerDetail = useMemo(() => {
    if (mintingAccounts.phase === 'loading' && accounts.length === 0) {
      return 'Checking the connected node for active minting keys…';
    }

    if (nodeIsMinting) {
      const count = accounts.length;

      if (listingAvailable && count > 0) {
        return `${count.toLocaleString()} minting ${count === 1 ? 'account is' : 'accounts are'} active on this node.`;
      }

      return 'The selected account has an active minting key on this node.';
    }

    if (!listingAvailable) {
      return 'This node does not expose its minting keys (no API access).';
    }

    if (status?.hasRewardShare === true && status.keyOnNode === false) {
      return 'The selected account is authorized to mint, but no key is loaded on this node.';
    }

    return 'No minting keys are active on the connected node.';
  }, [accounts.length, listingAvailable, mintingAccounts.phase, nodeIsMinting, status?.hasRewardShare, status?.keyOnNode]);

  const blockMode = batchActive
    ? 'Batch rewards active — only the blocks before each payout carry online accounts.'
    : 'Every block carries online accounts (pre batch-reward trigger).';
  const canLoadMore = blockCount < MAX_BLOCK_COUNT;
  const isBlocksLoading = blocks.phase === 'loading';
  const isMintingLoading =
    (mintingAccounts.phase === 'loading' || mintingAccounts.phase === 'idle') && accounts.length === 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__title">
          <h1>Minting</h1>
          <p className="muted">
            {bridge.value.isHomeBridge ? 'Connected through Qortium Home' : 'Read-only browser mode'}
          </p>
        </div>
        <div className="topbar__chain">
          <span className="topbar__chain-label">Chain height</span>
          <strong className="topbar__chain-height">{height === null ? '—' : height.toLocaleString()}</strong>
        </div>
      </header>

      <main className="content">
        <section className="card" aria-labelledby="minting-status-heading">
          <div className="card__header">
            <h2 id="minting-status-heading">Node minting status</h2>
            <button className="button button--secondary" onClick={refreshMintingStatus} type="button">
              Refresh
            </button>
          </div>

          {mintingAccounts.phase === 'error' && accounts.length === 0 ? (
            <p className="error">{mintingAccounts.error}</p>
          ) : null}

          {isMintingLoading ? (
            <LoadingRows count={2} label="Loading minting status" />
          ) : (
            <>
              <MintingBanner isMinting={nodeIsMinting} detail={bannerDetail} />

              {!listingAvailable ? (
                <p className="notice">
                  Listing the node&apos;s minting keys requires node API access (apikey). Connect through Qortium
                  Home, or run against a local Core node that exposes <code>/admin/mintingaccounts</code>.
                </p>
              ) : accounts.length > 0 ? (
                <div className="minting-accounts">
                  {accounts.map((mintingAccount) => (
                    <MintingAccountCard
                      account={mintingAccount}
                      canRemove={canRemove}
                      key={mintingAccount.address}
                      onRemove={handleRemoveMintingAccount}
                    />
                  ))}
                </div>
              ) : (
                <p className="empty">No minting keys are loaded on this node.</p>
              )}

              {mintingStatus.phase === 'error' ? <p className="error">{mintingStatus.error}</p> : null}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="online-now-heading">
          <div className="card__header">
            <div className="card__header-text">
              <h2 id="online-now-heading">Currently online accounts</h2>
              <span className="card__subtitle">
                {onlineNow.phase === 'ready'
                  ? `${onlineNow.value.length.toLocaleString()} account${onlineNow.value.length === 1 ? '' : 's'} online now`
                  : 'Accounts online on the network right now (live, not tied to a block).'}
              </span>
            </div>
            <button
              className="button button--secondary"
              disabled={onlineNow.phase === 'loading'}
              onClick={refreshOnlineNow}
              type="button"
            >
              {onlineNow.phase === 'loading' ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {onlineNow.phase === 'error' && onlineNow.value.length === 0 ? (
            <p className="error">{onlineNow.error}</p>
          ) : onlineNow.phase === 'loading' && onlineNow.value.length === 0 ? (
            <LoadingRows count={4} label="Loading online accounts" />
          ) : (
            <>
              {onlineNow.phase === 'error' ? <p className="error">{onlineNow.error}</p> : null}
              <OnlineAccountsTable
                entries={onlineNow.value}
                minterAddress={null}
                emptyLabel="No accounts are currently online."
              />
            </>
          )}
        </section>

        <section className="card" aria-labelledby="recent-blocks-heading">
          <div className="card__header">
            <div className="card__header-text">
              <h2 id="recent-blocks-heading">Recent blocks</h2>
              <span className="card__subtitle">{blockMode}</span>
            </div>
            <div className="card__header-actions">
              <span className={`mode-pill mode-pill--${batchActive ? 'batch' : 'pre'}`}>
                {batchActive ? 'Batch mode' : 'Per-block online'}
              </span>
              <button
                className="button button--secondary"
                disabled={isBlocksLoading}
                onClick={refreshBlocks}
                type="button"
              >
                {isBlocksLoading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>

          {blocks.phase === 'error' && blocks.value.length === 0 ? (
            <p className="error">{blocks.error}</p>
          ) : blocks.phase === 'loading' && blocks.value.length === 0 ? (
            <LoadingRows count={6} label="Loading recent blocks" />
          ) : blocks.value.length === 0 ? (
            <p className="empty">No blocks to display.</p>
          ) : (
            <>
              {blocks.phase === 'error' ? <p className="error">{blocks.error}</p> : null}
              <ol className="block-list">
                {blocks.value.map((block) => (
                  <BlockRow
                    block={block}
                    config={payoutConfig}
                    expanded={expandedHeight === block.height}
                    key={block.height}
                    now={now}
                    onlineAccounts={onlineAccountsByHeight[block.height]}
                    onToggle={toggleBlock}
                  />
                ))}
              </ol>
              <div className="block-list__footer">
                <span className="muted">
                  Showing {blocks.value.length.toLocaleString()} block{blocks.value.length === 1 ? '' : 's'}
                </span>
                {canLoadMore ? (
                  <button
                    className="button button--secondary"
                    disabled={isBlocksLoading}
                    onClick={loadMoreBlocks}
                    type="button"
                  >
                    Load more
                  </button>
                ) : null}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
