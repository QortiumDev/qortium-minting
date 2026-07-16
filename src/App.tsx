import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  fetchNodeApiData,
  getAccountInfo,
  getBlockOnlineAccounts,
  getBlocksAtHeights,
  getCurrentHeight,
  getCurrentOnlineAccounts,
  getGroupMembers,
  getMintingStatus,
  getNodeStatus,
  getPayoutConfig,
  getSelfRewardShares,
  isMintingGroupMember,
  joinGroup,
  listMintingAccounts,
  mapWithConcurrency,
  MINTING_GROUP_ID,
  removeMintingAccount,
  startMinting,
} from './coreApi';
import { interestingHeights } from './blockFilter';
import { getBridgeState, hasAction, qdnRequest } from './qdnRequest';
import {
  applyDisplaySettings,
  getDisplaySettingsUpdateFromMessage,
  getInitialDisplaySettings,
} from './displaySettings';
import { loadIdentityProfiles } from './identityProfiles';
import {
  beginPendingAction,
  isTimedOut,
  markPending,
  transitionPending,
  type PendingAction,
  type PendingActionGoal,
  type PendingActionKind,
} from './pendingAction';
import { planRefresh } from './refresh';
import { useSmartRefresh } from './useSmartRefresh';
import { Blocks, type BlockOnlineState } from './views/Blocks';
import { Minters } from './views/Minters';
import { MyMinting, type SelectedMintingDetails } from './views/MyMinting';
import { Reference } from './views/Reference';
import { NodeSyncPill, Notice } from './ui';
import type {
  AccountEnrichment,
  BlockSummary,
  BridgeState,
  GroupActionResult,
  MintingAccountsResult,
  MintingStatus,
  MinterRow,
  NodeStatus,
  OnlineAccountEntry,
  QdnAction,
  QdnSelectedAccount,
  RemoveMintingAccountResult,
  ResolvedIdentity,
  StartMintingResult,
} from './types';
import type { SortState } from './minterSort';

type Tab = 'status' | 'minters' | 'blocks' | 'reference';
type AsyncState<T> = { error?: string; loading: boolean; value: T };
type Message = { text: string; tone: 'error' | 'info' | 'warning' } | null;
type WriteResult = GroupActionResult | RemoveMintingAccountResult | StartMintingResult;
type PendingGoal = PendingActionGoal | ((result: WriteResult) => PendingActionGoal);

const APP_VERSION = __APP_VERSION__;
const DEFAULT_BLOCK_COUNT = 25;
const BLOCK_COUNT_STEP = 25;
const MAX_BLOCK_COUNT = 200;
const WATCH_FAST_MS = 3_000;
const WATCH_SLOW_MS = 10_000;
const WATCH_FAST_WINDOW_MS = 30_000;
const WATCH_CONFIRMED_LINGER_MS = 6_000;

const initial = <T,>(value: T): AsyncState<T> => ({ loading: false, value });
const emptyAccounts: MintingAccountsResult = { accounts: [], available: true };
const emptyBridge: BridgeState = {
  actions: [],
  isHomeBridge: false,
  isUsingPublicNode: false,
  ui: 'BROWSER_DEV',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function friendlyWriteError(error: unknown) {
  const text = errorMessage(error, '');

  if (/public|read.?only|network node/i.test(text)) {
    return 'This action needs a connected local node.';
  }

  if (/unlock|locked/i.test(text)) {
    return 'Unlock the selected account in Qortium Home and try again.';
  }

  if (/not have a matching minting key|not found/i.test(text)) {
    return 'That minting key is no longer loaded on this node.';
  }

  return 'That action could not be completed.';
}

function isSelectedAccountChanged(value: unknown) {
  if (!value || typeof value !== 'object') return false;
  const record = value as { action?: string; type?: string };
  return record.action === 'SELECTED_ACCOUNT_CHANGED' || record.type === 'qortium:selected-account-changed';
}

function normalizeSelectedAccount(account: QdnSelectedAccount): QdnSelectedAccount {
  return { ...account, isUnlocked: account.isUnlocked === true };
}

function contiguousHeights(tip: number, count: number) {
  return Array.from({ length: count }, (_, index) => tip - index).filter((height) => height > 0);
}

function pendingIsActive(pending: PendingAction | null) {
  return pending?.phase === 'signing' || pending?.phase === 'pending';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('status');
  const [bridge, setBridge] = useState<AsyncState<BridgeState>>(initial(emptyBridge));
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [account, setAccount] = useState<QdnSelectedAccount | null>(null);
  const [identity, setIdentity] = useState<ResolvedIdentity | null>(null);
  const [details, setDetails] = useState<AsyncState<SelectedMintingDetails | null>>(initial(null));
  const [status, setStatus] = useState<AsyncState<MintingStatus | null>>(initial(null));
  const [accounts, setAccounts] = useState<AsyncState<MintingAccountsResult>>(initial(emptyAccounts));
  const [onlineNow, setOnlineNow] = useState<AsyncState<OnlineAccountEntry[]>>(initial([]));
  const [blocks, setBlocks] = useState<AsyncState<BlockSummary[]>>(initial([]));
  const [blockCount, setBlockCount] = useState(DEFAULT_BLOCK_COUNT);
  const [skipEmpty, setSkipEmptyState] = useState(
    () => localStorage.getItem('minting.skipEmptyBlocks') !== 'false',
  );
  const [expanded, setExpanded] = useState<number | null>(null);
  const [onlineByHeight, setOnlineByHeight] = useState<Map<number, BlockOnlineState>>(new Map());
  const [minters, setMinters] = useState<AsyncState<MinterRow[]>>(initial([]));
  const [enrichment, setEnrichment] = useState<Map<string, AccountEnrichment>>(new Map());
  const [profiles, setProfiles] = useState<Map<string, ResolvedIdentity>>(new Map());
  const [sort, setSort] = useState<SortState>([{ key: 'blocksMinted', direction: 'desc' }]);
  const [visibleMinters, setVisibleMinters] = useState(100);
  const [selectedMinter, setSelectedMinter] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [settings, setSettings] = useState(getInitialDisplaySettings);
  const [now, setNow] = useState(() => Date.now());

  const payoutConfig = useMemo(() => getPayoutConfig(), []);
  const actions = bridge.value.actions;
  const request = useRef({
    accounts: 0,
    blocks: 0,
    details: 0,
    minters: 0,
    node: 0,
    online: 0,
    status: 0,
  });
  const blockCache = useRef<Map<number, BlockSummary>>(new Map());
  const profilesRef = useRef(profiles);
  const enrichmentRef = useRef(enrichment);
  const heightRef = useRef(height);

  profilesRef.current = profiles;
  enrichmentRef.current = enrichment;
  heightRef.current = height;

  const loadNodeStatus = useCallback(async () => {
    const token = ++request.current.node;

    try {
      const value = await getNodeStatus();
      if (token !== request.current.node) return;
      setNodeStatus(value);

      if (typeof value.height === 'number' && value.height > 0) {
        heightRef.current = value.height;
        setHeight(value.height);
      }
    } catch {
      // The cheap height poll can keep the app useful when richer status fails.
    }
  }, []);

  const loadStatus = useCallback(async (address: string | null, actionList: QdnAction[]) => {
    const token = ++request.current.status;

    if (!address) {
      setStatus(initial(null));
      return;
    }

    setStatus((current) => ({ ...current, error: undefined, loading: true }));

    try {
      const value = await getMintingStatus(address, actionList);
      if (token === request.current.status) setStatus({ loading: false, value });
    } catch (error) {
      if (token === request.current.status) {
        setStatus((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load minting status.'),
          loading: false,
        }));
      }
    }
  }, []);

  const loadDetails = useCallback(async (address: string | null, actionList: QdnAction[]) => {
    const token = ++request.current.details;

    if (!address) {
      setDetails(initial(null));
      return;
    }

    setDetails((current) => ({ ...current, error: undefined, loading: true }));

    try {
      const [accountInfo, rewardShares, member] = await Promise.all([
        getAccountInfo(address, actionList),
        getSelfRewardShares(address),
        isMintingGroupMember(address, actionList),
      ]);
      const rewardShare = rewardShares[0];
      const value: SelectedMintingDetails = {
        blocksMinted: typeof accountInfo.blocksMinted === 'number' ? accountInfo.blocksMinted : null,
        isMember: member,
        level: typeof accountInfo.level === 'number' ? accountInfo.level : null,
        sharePercent: typeof rewardShare?.sharePercent === 'number' ? rewardShare.sharePercent : null,
      };

      if (token === request.current.details) setDetails({ loading: false, value });
    } catch (error) {
      if (token === request.current.details) {
        setDetails((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load account details.'),
          loading: false,
        }));
      }
    }
  }, []);

  const loadAccounts = useCallback(async (actionList: QdnAction[]) => {
    const token = ++request.current.accounts;
    setAccounts((current) => ({ ...current, error: undefined, loading: true }));

    try {
      const value = await listMintingAccounts(actionList);
      if (token === request.current.accounts) setAccounts({ loading: false, value });
    } catch (error) {
      if (token === request.current.accounts) {
        setAccounts((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load minting accounts.'),
          loading: false,
        }));
      }
    }
  }, []);

  const loadOnline = useCallback(async (actionList: QdnAction[]) => {
    const token = ++request.current.online;
    setOnlineNow((current) => ({ ...current, error: undefined, loading: true }));

    try {
      const value = await getCurrentOnlineAccounts(actionList);
      if (token === request.current.online) setOnlineNow({ loading: false, value });
    } catch (error) {
      if (token === request.current.online) {
        setOnlineNow((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load online accounts.'),
          loading: false,
        }));
      }
    }
  }, []);

  const loadBlocks = useCallback(async (
    options: {
      actionList?: QdnAction[];
      count?: number;
      force?: boolean;
      skip?: boolean;
      tip?: number | null;
    } = {},
  ) => {
    const token = ++request.current.blocks;
    const actionList = options.actionList ?? actions;
    const count = options.count ?? blockCount;
    const skip = options.skip ?? skipEmpty;
    let tip = options.tip ?? heightRef.current;

    setBlocks((current) => ({ ...current, error: undefined, loading: true }));

    try {
      if (tip === null) tip = await getCurrentHeight();
      heightRef.current = tip;
      setHeight(tip);

      const heights = skip
        ? interestingHeights(tip, payoutConfig, count)
        : contiguousHeights(tip, count);
      const missing = options.force
        ? heights
        : heights.filter((blockHeight) => !blockCache.current.has(blockHeight));

      if (missing.length) {
        const fetched = await getBlocksAtHeights(missing, actionList);
        for (const block of fetched) blockCache.current.set(block.height, block);
      }

      if (token !== request.current.blocks) return;
      setBlocks({
        loading: false,
        value: heights
          .map((blockHeight) => blockCache.current.get(blockHeight))
          .filter((block): block is BlockSummary => !!block),
      });
    } catch (error) {
      if (token === request.current.blocks) {
        setBlocks((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load blocks.'),
          loading: false,
        }));
      }
    }
  }, [actions, blockCount, payoutConfig, skipEmpty]);

  const loadMinters = useCallback(async (forceEnrichment = false, actionList = actions) => {
    const token = ++request.current.minters;
    setMinters((current) => ({ ...current, error: undefined, loading: true }));

    if (forceEnrichment) {
      enrichmentRef.current = new Map();
      setEnrichment(new Map());
    }

    try {
      const members = await getGroupMembers(MINTING_GROUP_ID, actionList);
      const rows = members.map((member, index) => ({ ...member, address: member.member, index }));
      if (token !== request.current.minters) return;
      setMinters({ loading: false, value: rows });

      const unknownProfiles = rows
        .map((row) => row.address)
        .filter((address) => !profilesRef.current.has(address));

      if (unknownProfiles.length) {
        const resolved = await loadIdentityProfiles(unknownProfiles, actionList);
        if (token === request.current.minters) {
          setProfiles((current) => {
            const next = new Map(current);
            for (const profile of resolved) next.set(profile.address, profile);
            profilesRef.current = next;
            return next;
          });
        }
      }

      const needsEnrichment = rows.filter(
        (row) => forceEnrichment || !enrichmentRef.current.has(row.address),
      );

      await mapWithConcurrency(needsEnrichment, 6, async (row) => {
        try {
          const info = await getAccountInfo(row.address, actionList);
          if (token !== request.current.minters) return;
          const value: AccountEnrichment = {
            blocksMinted: typeof info.blocksMinted === 'number' ? info.blocksMinted : null,
            blocksMintedPenalty:
              typeof info.blocksMintedPenalty === 'number' ? info.blocksMintedPenalty : null,
            level: typeof info.level === 'number' ? info.level : null,
          };
          setEnrichment((current) => {
            const next = new Map(current);
            next.set(row.address, value);
            enrichmentRef.current = next;
            return next;
          });
        } catch {
          // A row remains visible with placeholders when enrichment is unavailable.
        }
      });
    } catch (error) {
      if (token === request.current.minters) {
        setMinters((current) => ({
          ...current,
          error: errorMessage(error, 'Unable to load minters.'),
          loading: false,
        }));
      }
    }
  }, [actions]);

  const loadSelectedAccount = useCallback(async (actionList: QdnAction[]) => {
    setPending(null);

    try {
      const selected = normalizeSelectedAccount(
        await qdnRequest<QdnSelectedAccount>({ action: 'GET_SELECTED_ACCOUNT' }),
      );
      setAccount(selected);
      const [resolved] = await loadIdentityProfiles([selected.address], actionList);
      setIdentity(resolved ?? null);
      void loadStatus(selected.address, actionList);
      void loadDetails(selected.address, actionList);
      return selected;
    } catch {
      setAccount(null);
      setIdentity(null);
      setStatus(initial(null));
      setDetails(initial(null));
      return null;
    }
  }, [loadDetails, loadStatus]);

  const initialize = useCallback(async () => {
    setBridge((current) => ({ ...current, error: undefined, loading: true }));

    try {
      const nextBridge = await getBridgeState();
      setBridge({ loading: false, value: nextBridge });
      const nextNodeStatus = await getNodeStatus().catch(() => null);
      const nextHeight = typeof nextNodeStatus?.height === 'number'
        ? nextNodeStatus.height
        : await getCurrentHeight();
      setNodeStatus(nextNodeStatus);
      heightRef.current = nextHeight;
      setHeight(nextHeight);

      void loadSelectedAccount(nextBridge.actions);
      void loadAccounts(nextBridge.actions);
      void loadOnline(nextBridge.actions);
      void loadBlocks({ actionList: nextBridge.actions, tip: nextHeight });
    } catch (error) {
      setBridge((current) => ({
        ...current,
        error: errorMessage(error, 'Unable to connect to the local node.'),
        loading: false,
      }));
      setMessage({ text: 'Unable to connect to the local node.', tone: 'warning' });
    }
  }, [loadAccounts, loadBlocks, loadOnline, loadSelectedAccount]);

  useEffect(() => {
    // Initialization passes the freshly discovered action list into every
    // loader, so this intentionally runs once instead of restarting when the
    // bridge state object is stored.
    void initialize();
  }, []);

  useEffect(() => {
    applyDisplaySettings(settings);
    document.documentElement.lang = settings.language || 'en';
    document.title = 'Minting';
  }, [settings]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      setSettings((current) => getDisplaySettingsUpdateFromMessage(event.data, current) ?? current);
      if (isSelectedAccountChanged(event.data)) void loadSelectedAccount(actions);
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [actions, loadSelectedAccount]);

  const poll = useCallback(async () => {
    try {
      const raw = await fetchNodeApiData<number | string>('/blocks/height', 'Block height');
      const next = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(next) || next <= 0) return;

      const previous = heightRef.current;
      if (previous === next) return;
      heightRef.current = next;
      setHeight(next);
      const refresh = planRefresh(previous, next, payoutConfig);
      const tasks: Promise<unknown>[] = [];

      if (refresh.height) tasks.push(loadNodeStatus());
      if (refresh.blocks) tasks.push(loadBlocks({ tip: next }));
      if (refresh.onlineNow) tasks.push(loadOnline(actions));
      if (refresh.mintingStatus) {
        tasks.push(loadStatus(account?.address ?? null, actions));
        tasks.push(loadDetails(account?.address ?? null, actions));
      }
      if (refresh.minters && minters.value.length) tasks.push(loadMinters(true, actions));
      if (refresh.mintingAccounts) tasks.push(loadAccounts(actions));
      await Promise.all(tasks);
    } catch {
      // Background polling is intentionally quiet; stale data remains visible.
    }
  }, [
    account?.address,
    actions,
    loadAccounts,
    loadBlocks,
    loadDetails,
    loadMinters,
    loadNodeStatus,
    loadOnline,
    loadStatus,
    minters.value.length,
    payoutConfig,
  ]);

  useSmartRefresh(poll, () => setNow(Date.now()));

  useEffect(() => {
    if (tab === 'minters' && !minters.value.length && !minters.loading) {
      void loadMinters();
    }
  }, [loadMinters, minters.loading, minters.value.length, tab]);

  useEffect(() => {
    if (!pending || pending.phase !== 'pending') return;

    let disposed = false;
    let timer = 0;
    const watched = pending;

    async function stateRecorded() {
      if (watched.goal === 'membership' && watched.targetAddress) {
        return isMintingGroupMember(watched.targetAddress, actions);
      }

      if ((watched.goal === 'reward-share' || watched.goal === 'key-added') && watched.targetAddress) {
        const current = await getMintingStatus(watched.targetAddress, actions);
        return watched.goal === 'reward-share' ? current.hasRewardShare : current.keyOnNode === true;
      }

      if (watched.goal === 'key-removed' && watched.targetPublicKey) {
        const current = await listMintingAccounts(actions);
        return current.available
          && current.accounts.every((item) => item.publicKey !== watched.targetPublicKey);
      }

      return false;
    }

    function confirm() {
      if (disposed) return;
      setPending((current) => current && current.submittedAt === watched.submittedAt
        ? transitionPending(current, watched.submittedAt, 'confirmed')
        : current);
      void loadStatus(account?.address ?? null, actions);
      void loadDetails(account?.address ?? null, actions);
      void loadAccounts(actions);
      if (minters.value.length) void loadMinters(watched.goal === 'membership', actions);
      window.setTimeout(() => {
        setPending((current) => current?.submittedAt === watched.submittedAt ? null : current);
      }, WATCH_CONFIRMED_LINGER_MS);
    }

    async function check() {
      if (disposed) return;

      try {
        if (watched.signature) {
          const transaction = await fetchNodeApiData<{ blockHeight?: number }>(
            `/transactions/signature/${encodeURIComponent(watched.signature)}`,
            'Transaction',
            100_000,
          );

          if (typeof transaction.blockHeight === 'number' && transaction.blockHeight > 0) {
            confirm();
            return;
          }
        }

        if (await stateRecorded()) {
          confirm();
          return;
        }
      } catch {
        // Not recorded yet or a transient read failed; keep watching.
      }

      if (disposed) return;
      if (isTimedOut(watched)) {
        setPending((current) => current?.submittedAt === watched.submittedAt
          ? transitionPending(current, watched.submittedAt, 'timeout')
          : current);
        return;
      }

      const delay = Date.now() - watched.submittedAt < WATCH_FAST_WINDOW_MS
        ? WATCH_FAST_MS
        : WATCH_SLOW_MS;
      timer = window.setTimeout(() => void check(), delay);
    }

    timer = window.setTimeout(() => void check(), WATCH_FAST_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [
    account?.address,
    actions,
    loadAccounts,
    loadDetails,
    loadMinters,
    loadStatus,
    minters.value.length,
    pending?.phase,
    pending?.signature,
    pending?.submittedAt,
  ]);

  async function ensureUnlocked() {
    if (!account) return null;
    if (account.isUnlocked) return account;
    if (!hasAction(actions, 'UNLOCK_SELECTED_ACCOUNT')) return null;

    const unlocked = normalizeSelectedAccount(
      await qdnRequest<QdnSelectedAccount>({ action: 'UNLOCK_SELECTED_ACCOUNT' }),
    );
    setAccount(unlocked);
    const [resolved] = await loadIdentityProfiles([unlocked.address], actions);
    setIdentity(resolved ?? null);
    return unlocked.isUnlocked ? unlocked : null;
  }

  async function submitWrite(
    kind: PendingActionKind,
    goal: PendingGoal,
    target: Pick<PendingAction, 'targetAddress' | 'targetPublicKey'>,
    operation: () => Promise<WriteResult>,
  ) {
    if (pendingIsActive(pending)) return;
    setMessage(null);

    try {
      if ((kind === 'join' || kind === 'start') && !(await ensureUnlocked())) {
        setMessage({
          text: 'Unlock the selected account in Qortium Home and try again.',
          tone: 'error',
        });
        return;
      }
    } catch (error) {
      setMessage({ text: friendlyWriteError(error), tone: 'error' });
      return;
    }

    const started = beginPendingAction(kind, target);
    setPending(started);

    try {
      const result = await operation();
      const signature = result && typeof result === 'object' && 'transactionSignature' in result
        && typeof result.transactionSignature === 'string'
        ? result.transactionSignature
        : undefined;
      setPending(markPending(started, {
        goal: typeof goal === 'function' ? goal(result) : goal,
        signature,
      }));
    } catch (error) {
      setPending(null);
      setMessage({ text: friendlyWriteError(error), tone: 'error' });
    }
  }

  function setSkipEmpty(value: boolean) {
    setSkipEmptyState(value);
    localStorage.setItem('minting.skipEmptyBlocks', String(value));
    void loadBlocks({ skip: value });
  }

  function toggleBlock(blockHeight: number) {
    if (expanded === blockHeight) {
      setExpanded(null);
      return;
    }

    setExpanded(blockHeight);
    if (onlineByHeight.has(blockHeight)) return;

    setOnlineByHeight((current) => {
      const next = new Map(current);
      next.set(blockHeight, { entries: [], loading: true });
      return next;
    });
    void getBlockOnlineAccounts(blockHeight, actions)
      .then((entries) => {
        setOnlineByHeight((current) => {
          const next = new Map(current);
          next.set(blockHeight, { entries, loading: false });
          return next;
        });
      })
      .catch((error) => {
        setOnlineByHeight((current) => {
          const next = new Map(current);
          next.set(blockHeight, {
            entries: [],
            error: errorMessage(error, 'Unable to load this block snapshot.'),
            loading: false,
          });
          return next;
        });
      });
  }

  function refreshActive() {
    setMessage(null);

    if (tab === 'status') {
      void loadStatus(account?.address ?? null, actions);
      void loadDetails(account?.address ?? null, actions);
      void loadAccounts(actions);
      void loadOnline(actions);
      void loadNodeStatus();
    } else if (tab === 'minters') {
      void loadMinters(true, actions);
    } else if (tab === 'blocks') {
      void loadBlocks({ force: true });
      void loadOnline(actions);
      void loadNodeStatus();
    } else {
      void initialize();
    }
  }

  const writeAvailable = !bridge.value.isUsingPublicNode;
  const canJoin = writeAvailable
    && !!account
    && details.value?.isMember === false
    && hasAction(actions, 'JOIN_GROUP');
  const canStart = writeAvailable
    && !!account
    && details.value?.isMember === true
    && status.value?.keyOnNode === false
    && hasAction(actions, 'START_MINTING');
  const canRemove = writeAvailable && hasAction(actions, 'REMOVE_MINTING_ACCOUNT');

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Minting <span className="app-version">{APP_VERSION}</span></p>
          <h1>Minting workspace</h1>
          <p className="muted">Manage your minting, explore minters, and follow recent blocks.</p>
        </div>
        <div className="topbar-actions">
          <NodeSyncPill height={height} status={nodeStatus} />
          <button
            aria-label="Refresh current view"
            className="icon-button"
            disabled={bridge.loading}
            onClick={refreshActive}
            type="button"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <nav aria-label="Minting workspace" className="tabs">
        {([
          ['status', 'My Minting'],
          ['minters', 'Minters'],
          ['blocks', 'Blocks'],
          ['reference', 'Developers'],
        ] as const).map(([key, label]) => (
          <button
            className={`tab${tab === key ? ' active' : ''}`}
            key={key}
            onClick={() => {
              setSelectedMinter(null);
              setTab(key);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {!bridge.value.isHomeBridge
        ? <Notice>Browser development mode is read-only for account actions.</Notice>
        : null}
      {bridge.value.isUsingPublicNode
        ? <Notice tone="warning">This public node is available for reading; account changes need a connected local node.</Notice>
        : null}
      {bridge.error ? <Notice tone="error">{bridge.error}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {tab === 'status' ? (
        <MyMinting
          account={account}
          accounts={accounts}
          canJoin={canJoin}
          canRemove={canRemove}
          canStart={canStart}
          details={details}
          identity={identity}
          onBlocks={() => setTab('blocks')}
          onJoin={() => {
            if (!account) return;
            void submitWrite(
              'join',
              'membership',
              { targetAddress: account.address },
              () => joinGroup(MINTING_GROUP_ID, actions),
            );
          }}
          onRemove={(item) => {
            if (!item.publicKey) return;
            void submitWrite(
              'remove',
              'key-removed',
              { targetPublicKey: item.publicKey },
              () => removeMintingAccount(item.publicKey!, actions),
            );
          }}
          onStart={() => {
            if (!account) return;
            void submitWrite(
              'start',
              (result) => 'keyAdded' in result && result.keyAdded ? 'key-added' : 'reward-share',
              { targetAddress: account.address },
              () => startMinting(actions),
            );
          }}
          onlineCount={onlineNow.value.length}
          pending={pending}
          status={status}
        />
      ) : null}

      {tab === 'minters' ? (
        <Minters
          enrichment={enrichment}
          error={minters.error}
          loading={minters.loading}
          onSelect={(address) => setSelectedMinter(address || null)}
          onShowMore={() => setVisibleMinters((count) => count + 100)}
          profiles={profiles}
          rows={minters.value}
          selected={selectedMinter}
          selectedAddress={account?.address ?? null}
          setSort={setSort}
          sort={sort}
          visibleCount={visibleMinters}
        />
      ) : null}

      {tab === 'blocks' ? (
        <Blocks
          blocks={blocks.value}
          config={payoutConfig}
          error={blocks.error}
          expanded={expanded}
          loading={blocks.loading}
          now={now}
          onlineAccounts={onlineByHeight}
          onlineNow={onlineNow}
          onShowMore={() => {
            const next = Math.min(MAX_BLOCK_COUNT, blockCount + BLOCK_COUNT_STEP);
            setBlockCount(next);
            void loadBlocks({ count: next });
          }}
          onToggle={toggleBlock}
          setSkipEmpty={setSkipEmpty}
          showMore={blockCount < MAX_BLOCK_COUNT}
          skipEmpty={skipEmpty}
          tip={height}
        />
      ) : null}

      {tab === 'reference' ? <Reference /> : null}
    </main>
  );
}
