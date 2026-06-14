import { loadAvatarProfile, normalizeRegisteredName } from './avatarProfiles';
import type { AvatarProfile } from './avatarProfiles';
import { qdnRequest } from './qdnRequest';
import type {
  BlockMintingInfo,
  BlockSummary,
  ChainPayoutConfig,
  MintingAccountInfo,
  MintingAccountsResult,
  MintingStatus,
  NameSummary,
  NodeAccountInfo,
  NodeApiFetchResult,
  NodeBlockData,
  NodeMintingAccount,
  NodeOnlineAccount,
  NodeStatus,
  OnlineAccountEntry,
  QdnAction,
  RewardShare,
} from './types';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_RECENT_BLOCKS = 10;

// Bound on simultaneous per-height block/mintinginfo fetches so a large block
// window (App.tsx MAX_BLOCK_COUNT=200) cannot fire hundreds of concurrent
// FETCH_NODE_API calls at once.
const BLOCK_FETCH_CONCURRENCY = 8;

// Cross-call caches for name/avatar lookups, which almost never change between
// refreshes. Shared across getRecentBlocks, getBlockOnlineAccounts, and
// enrichMintingAccount so repeated refreshes/expands hit the cache instead of
// refetching. Entries store the in-flight Promise so concurrent lookups for the
// same address share a single request (true dedupe of the initial burst).
const NAME_CACHE_MAX_ENTRIES = 500;
const AVATAR_CACHE_MAX_ENTRIES = 500;
const minterNameCache = new Map<string, Promise<string | null>>();
const avatarProfileCache = new Map<string, Promise<AvatarProfile>>();

// Resolve a list of tasks with a bounded concurrency pool while preserving the
// input order in the returned array.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

// Insertion-order Map eviction keeps the shared caches from growing unbounded
// across long sessions.
function setCapped<V>(cache: Map<string, V>, key: string, value: V, maxEntries: number) {
  cache.set(key, value);

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey === undefined) {
      break;
    }

    cache.delete(oldestKey);
  }
}

// Previewnet block-reward batch schedule. There is no REST endpoint exposing
// these values, so they are documented constants mirroring Qortium Core's
// BlockChain.blockRewardBatch* settings for Previewnet. Before startHeight every
// block carries online accounts; from startHeight on, only the trailing
// `accountsBlockCount` blocks before each batch-size multiple do.
const PREVIEWNET_PAYOUT_CONFIG: ChainPayoutConfig = {
  blockRewardBatchAccountsBlockCount: 10,
  blockRewardBatchSize: 100,
  blockRewardBatchStartHeight: 1508000,
};

function assertOk<T>(result: NodeApiFetchResult<T>, label: string) {
  if (!result.ok) {
    throw new Error(result.body || `${label} failed with HTTP ${result.status}.`);
  }

  return result.data;
}

function hasBridgeAction(actions: QdnAction[] | undefined, action: string) {
  return actions?.some((candidate) => candidate.toUpperCase() === action.toUpperCase()) ?? false;
}

export function buildAccountNamesPath(address: string) {
  return `/names/address/${encodeURIComponent(address)}`;
}

export function buildPrimaryNamePath(address: string) {
  return `/names/primary/${encodeURIComponent(address)}`;
}

export function buildAccountInfoPath(address: string) {
  return `/addresses/${encodeURIComponent(address)}`;
}

export function buildSelfRewardSharesPath(address: string) {
  const encodedAddress = encodeURIComponent(address);

  return `/addresses/rewardshares?minters=${encodedAddress}&recipients=${encodedAddress}`;
}

export function buildBlockByHeightPath(height: number) {
  return `/blocks/byheight/${encodeURIComponent(String(height))}`;
}

export function buildBlockMintingInfoPath(height: number) {
  return `/blocks/byheight/${encodeURIComponent(String(height))}/mintinginfo`;
}

export function buildBlockRangePath(height: number, count: number) {
  const query = new URLSearchParams({
    count: String(count),
    reverse: 'true',
  });

  return `/blocks/range/${encodeURIComponent(String(height))}?${query.toString()}`;
}

export function buildBlockOnlineAccountsPath(height: number) {
  return `/blocks/onlineaccounts/${encodeURIComponent(String(height))}`;
}

export function buildCurrentOnlineAccountsPath() {
  return '/addresses/online';
}

export async function fetchNodeApiData<T>(path: string, label: string, maxBytes = DEFAULT_MAX_BYTES) {
  const result = await qdnRequest<NodeApiFetchResult<T>>({
    action: 'FETCH_NODE_API',
    maxBytes,
    path,
  });

  return assertOk(result, label);
}

export async function getNodeStatus() {
  return qdnRequest<NodeStatus>({ action: 'GET_NODE_STATUS' });
}

export async function getAccountNames(address: string, actions?: QdnAction[]) {
  if (hasBridgeAction(actions, 'GET_ACCOUNT_NAMES')) {
    return qdnRequest<NameSummary[]>({
      action: 'GET_ACCOUNT_NAMES',
      address,
    });
  }

  return fetchNodeApiData<NameSummary[]>(buildAccountNamesPath(address), 'Account names');
}

// An account's primary name (the one it has designated for display). Setting a primary
// is optional, so this returns null when none is set — callers fall back to the first
// registered name. /names/address is ordered by registration, NOT primary, which is why
// the primary must be fetched separately to display a consistent name everywhere.
export async function getPrimaryName(address: string): Promise<string | null> {
  try {
    const summary = await fetchNodeApiData<NameSummary | null>(buildPrimaryNamePath(address), 'Primary name');
    return normalizeRegisteredName(summary?.name ?? null);
  } catch {
    return null;
  }
}

export async function getAccountInfo(address: string) {
  return fetchNodeApiData<NodeAccountInfo>(buildAccountInfoPath(address), 'Account info');
}

// Lifted verbatim from qortium-chat's coreApi.ts.
export async function getMintingStatus(address: string, actions?: QdnAction[]): Promise<MintingStatus> {
  if (hasBridgeAction(actions, 'GET_MINTING_STATUS')) {
    return qdnRequest<MintingStatus>({
      action: 'GET_MINTING_STATUS',
      address,
    });
  }

  const rewardShares = await fetchNodeApiData<RewardShare[]>(buildSelfRewardSharesPath(address), 'Reward shares');
  const hasRewardShare = rewardShares.some(
    (rewardShare) => rewardShare.mintingAccount === address && rewardShare.recipient === address,
  );

  try {
    const mintingAccounts = await fetchNodeApiData<NodeMintingAccount[]>('/admin/mintingaccounts', 'Minting accounts');
    const keyOnNode = mintingAccounts.some(
      (mintingAccount) => mintingAccount.mintingAccount === address && mintingAccount.recipientAccount === address,
    );
    const nodeStatus = await fetchNodeApiData<NodeStatus>('/admin/status', 'Node status');

    return {
      address,
      hasRewardShare,
      isMinting: hasRewardShare && keyOnNode,
      keyOnNode,
      nodeMintingPossible: nodeStatus.isMintingPossible === true,
    };
  } catch {
    // The connected node does not expose its minting state (for example a public read-only node).
    return {
      address,
      hasRewardShare,
      isMinting: null,
      keyOnNode: null,
      nodeMintingPossible: null,
    };
  }
}

function getFirstRegisteredName(names: NameSummary[]) {
  for (const summary of names) {
    const name = normalizeRegisteredName(summary.name);

    if (name) {
      return name;
    }
  }

  return null;
}

function resolveMintingAccountAddress(account: NodeMintingAccount) {
  return normalizeRegisteredName(account.address) ?? normalizeRegisteredName(account.mintingAccount);
}

// Avatar/name resolution is expensive (QDN resource fetch) and effectively
// static, so share one in-flight Promise per address+actions across refreshes.
function resolveAvatarProfile(address: string, actions?: QdnAction[]): Promise<AvatarProfile> {
  const cacheKey = `${address}\n${(actions ?? []).join(',')}`;
  const cached = avatarProfileCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const pending = loadAvatarProfile({ actions, address }).catch((error: unknown) => {
    // Do not cache failures; allow a later refresh to retry.
    avatarProfileCache.delete(cacheKey);

    throw error;
  });

  setCapped(avatarProfileCache, cacheKey, pending, AVATAR_CACHE_MAX_ENTRIES);

  return pending;
}

async function enrichMintingAccount(account: NodeMintingAccount, actions?: QdnAction[]): Promise<MintingAccountInfo | null> {
  const address = resolveMintingAccountAddress(account);

  if (!address) {
    return null;
  }

  let level: number | null = null;
  let blocksMinted: number | null = null;
  // Keep the node's minting (reward-share) public key — this is what DELETE
  // /admin/mintingaccounts matches on. Do NOT replace it with the account's own
  // public key from getAccountInfo, or removal won't find the key on the node.
  const publicKey: string | null = normalizeRegisteredName(account.publicKey);

  try {
    const info = await getAccountInfo(address);

    level = typeof info.level === 'number' ? info.level : null;
    blocksMinted = typeof info.blocksMinted === 'number' ? info.blocksMinted : null;
  } catch {
    // Account info unavailable; leave the on-chain fields null.
  }

  let name: string | null = null;
  let avatarSrc: string | null = null;

  try {
    const profile = await resolveAvatarProfile(address, actions);

    name = profile.name;
    avatarSrc = profile.avatarSrc;
  } catch {
    // Name/avatar resolution is best-effort.
  }

  return {
    address,
    avatarSrc,
    blocksMinted,
    level,
    name,
    publicKey,
    recipientAddress: normalizeRegisteredName(account.recipientAccount),
  };
}

export async function listMintingAccounts(actions?: QdnAction[]): Promise<MintingAccountsResult> {
  let rawAccounts: NodeMintingAccount[];

  try {
    rawAccounts = await fetchNodeApiData<NodeMintingAccount[]>('/admin/mintingaccounts', 'Minting accounts');
  } catch {
    // The connected node does not expose its minting accounts (unauthorized or
    // a public read-only node).
    return { accounts: [], available: false };
  }

  const enriched = await Promise.all(rawAccounts.map((account) => enrichMintingAccount(account, actions)));
  const accounts = enriched.filter((account): account is MintingAccountInfo => account !== null);

  return { accounts, available: true };
}

export async function getCurrentHeight() {
  const status = await getNodeStatus();

  if (typeof status.height === 'number' && status.height > 0) {
    return status.height;
  }

  const height = await fetchNodeApiData<number | string>('/blocks/height', 'Chain height');
  const parsed = typeof height === 'number' ? height : Number(height);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Chain height response was not a positive number.');
  }

  return parsed;
}

function toBlockSummary(
  height: number,
  block: NodeBlockData | null,
  mintingInfo: BlockMintingInfo | null,
  minterName: string | null,
): BlockSummary {
  return {
    height,
    minterAddress: normalizeRegisteredName(mintingInfo?.minterAddress),
    minterLevel: typeof mintingInfo?.minterLevel === 'number' ? mintingInfo.minterLevel : null,
    minterName,
    onlineAccountsCount:
      typeof mintingInfo?.onlineAccountsCount === 'number'
        ? mintingInfo.onlineAccountsCount
        : typeof block?.onlineAccountsCount === 'number'
          ? block.onlineAccountsCount
          : null,
    signature: normalizeRegisteredName(block?.signature),
    timestamp:
      typeof block?.timestamp === 'number'
        ? block.timestamp
        : typeof mintingInfo?.timestamp === 'number'
          ? mintingInfo.timestamp
          : null,
  };
}

async function resolveMinterName(address: string | null, actions?: QdnAction[]) {
  if (!address) {
    return null;
  }

  const cached = minterNameCache.get(address);

  if (cached !== undefined) {
    return cached;
  }

  const pending = (async () => {
    try {
      // Prefer the account's primary name (consistent display everywhere); setting a
      // primary is optional, so fall back to the first registered name when there is none.
      const primary = await getPrimaryName(address);
      if (primary) {
        return primary;
      }

      return getFirstRegisteredName(await getAccountNames(address, actions));
    } catch {
      return null;
    }
  })();

  setCapped(minterNameCache, address, pending, NAME_CACHE_MAX_ENTRIES);

  return pending;
}

export async function getRecentBlocks(count = DEFAULT_RECENT_BLOCKS, actions?: QdnAction[]): Promise<BlockSummary[]> {
  const requestedCount = Math.max(0, Math.trunc(count));

  if (requestedCount === 0) {
    return [];
  }

  const currentHeight = await getCurrentHeight();
  const startHeight = currentHeight;
  const lowestHeight = Math.max(1, startHeight - requestedCount + 1);
  const heights: number[] = [];

  for (let height = startHeight; height >= lowestHeight; height -= 1) {
    heights.push(height);
  }

  // Reverse-ordered range gives the newest blocks first in one call; fall back
  // to per-height fetches when the range endpoint is unavailable.
  let blocksByHeight = new Map<number, NodeBlockData>();

  try {
    const range = await fetchNodeApiData<NodeBlockData[]>(buildBlockRangePath(startHeight, requestedCount), 'Block range');

    for (const block of range) {
      if (typeof block.height === 'number') {
        blocksByHeight.set(block.height, block);
      }
    }
  } catch {
    blocksByHeight = new Map<number, NodeBlockData>();
  }

  return mapWithConcurrency(heights, BLOCK_FETCH_CONCURRENCY, async (height) => {
    let block = blocksByHeight.get(height) ?? null;

    if (!block) {
      try {
        block = await fetchNodeApiData<NodeBlockData>(buildBlockByHeightPath(height), 'Block by height');
      } catch {
        block = null;
      }
    }

    let mintingInfo: BlockMintingInfo | null = null;

    try {
      mintingInfo = await fetchNodeApiData<BlockMintingInfo>(buildBlockMintingInfoPath(height), 'Block minting info');
    } catch {
      mintingInfo = null;
    }

    const minterName = await resolveMinterName(normalizeRegisteredName(mintingInfo?.minterAddress), actions);

    return toBlockSummary(height, block, mintingInfo, minterName);
  });
}

// Online accounts decoded from a specific block via /blocks/onlineaccounts/{height}
// — historically accurate for that block. NOTE: on Previewnet today this returns []
// for every block (Core's decode yields no self-shares despite onlineAccountsCount
// > 0). The current online set is shown separately at the top of the UI via
// getCurrentOnlineAccounts; this is reserved for payout blocks once batch rewards
// activate.
export async function getBlockOnlineAccounts(
  height: number,
  actions?: QdnAction[],
): Promise<OnlineAccountEntry[]> {
  const raw = await fetchNodeApiData<OnlineAccountEntry[]>(
    buildBlockOnlineAccountsPath(height),
    'Block online accounts',
  );
  return mapWithConcurrency(raw, BLOCK_FETCH_CONCURRENCY, async (entry) => {
    // Resolve the display name the SAME way as the block minter (first registered name)
    // so an account that owns multiple names shows consistently in the minter row and the
    // online-accounts list. Core's entry.name picks an arbitrary one of the owner's names.
    const name = (await resolveMinterName(entry.minter, actions)) ?? normalizeRegisteredName(entry.name);

    return {
      level: typeof entry.level === 'number' ? entry.level : null,
      minter: entry.minter,
      name,
      onlineTimestamp: typeof entry.onlineTimestamp === 'number' ? entry.onlineTimestamp : null,
      recipient: normalizeRegisteredName(entry.recipient),
      sharePercent: typeof entry.sharePercent === 'number' ? entry.sharePercent : null,
    };
  });
}

// Remove a minting key from the local node. Core: DELETE /admin/mintingaccounts with
// the base58 public (or private) key as the plain-text body. This is a WRITE that the
// current Qortium Home bridge does not expose, so it is gated on a REMOVE_MINTING_ACCOUNT
// action: available in browser-dev when VITE_QORTIUM_NODE_API_KEY is set, or once Home
// adds the action. Callers should check hasAction(actions, 'REMOVE_MINTING_ACCOUNT') first.
export async function removeMintingAccount(publicKey: string, actions?: QdnAction[]): Promise<void> {
  if (!publicKey) {
    throw new Error('A public key is required to remove a minting key.');
  }

  if (!hasBridgeAction(actions, 'REMOVE_MINTING_ACCOUNT')) {
    throw new Error(
      'Removing a minting key is not available here. It needs Qortium Home support, or a local node API key (VITE_QORTIUM_NODE_API_KEY) in browser-dev mode.',
    );
  }

  await qdnRequest<unknown>({ action: 'REMOVE_MINTING_ACCOUNT', publicKey });
}

// Current online accounts from /addresses/online (ApiOnlineAccount in Core).
// Always available even when the per-block decode is empty. sharePercent is not
// exposed by this endpoint, so it is left null.
export async function getCurrentOnlineAccounts(actions?: QdnAction[]): Promise<OnlineAccountEntry[]> {
  const raw = await fetchNodeApiData<NodeOnlineAccount[]>(
    buildCurrentOnlineAccountsPath(),
    'Current online accounts',
  );
  return mapWithConcurrency(raw, BLOCK_FETCH_CONCURRENCY, async (entry) => {
    const minter = entry.minterAddress ?? '';
    const name = minter ? await resolveMinterName(minter, actions) : null;

    return {
      level: typeof entry.minterLevel === 'number' ? entry.minterLevel : null,
      minter,
      name,
      onlineTimestamp: typeof entry.timestamp === 'number' ? entry.timestamp : null,
      recipient: entry.recipientAddress ?? null,
      sharePercent: null,
    };
  });
}

export function getPayoutConfig(): ChainPayoutConfig {
  return { ...PREVIEWNET_PAYOUT_CONFIG };
}

// Mirrors Qortium Core Block.isBatchRewardDistributionActive: the batch feature
// is only active strictly after the start height.
function isBatchRewardDistributionActive(height: number, config: ChainPayoutConfig) {
  return height > config.blockRewardBatchStartHeight;
}

// Mirrors Qortium Core Block.getNextBatchDistributionBlockHeight.
function getNextBatchDistributionBlockHeight(height: number, config: ChainPayoutConfig) {
  const batchSize = config.blockRewardBatchSize;

  if (height % batchSize === 0) {
    return height;
  }

  return height + (batchSize - (height % batchSize));
}

// Mirrors Qortium Core Block.isOnlineAccountsBlock: before the start height every
// block carries online accounts; from the start height on, only the trailing
// `accountsBlockCount` blocks before each batch boundary do.
export function isOnlineAccountsBlock(height: number, config: ChainPayoutConfig) {
  if (height >= config.blockRewardBatchStartHeight) {
    const leadingBlockCount = config.blockRewardBatchAccountsBlockCount;

    return height >= getNextBatchDistributionBlockHeight(height, config) - leadingBlockCount;
  }

  return true;
}

// Mirrors Qortium Core Block.isBatchRewardDistributionBlock: payout blocks are
// batch-size multiples once the batch feature is active.
export function isPayoutBlock(height: number, config: ChainPayoutConfig) {
  if (!isBatchRewardDistributionActive(height, config)) {
    return false;
  }

  return height % config.blockRewardBatchSize === 0;
}
