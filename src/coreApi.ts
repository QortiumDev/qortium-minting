import { GROUP_MEMBER_PAGE_SIZE, GROUP_MEMBER_MAX_PAGE_SIZE, RESOLVE_IDENTITIES_LIMIT } from './mintingConstants';
export { RESOLVE_IDENTITIES_LIMIT } from './mintingConstants';
import { groupContiguousDescending } from './blockFilter';
import { loadIdentityProfile, loadIdentityProfiles, normalizeRegisteredName } from './identityProfiles';
import type { IdentityProfile } from './identityProfiles';
import { qdnRequest } from './qdnRequest';
import type {
  BlockMintingInfo,
  BlockSummary,
  ChainPayoutConfig,
  GroupActionResult,
  GroupData,
  GroupMember,
  GroupMembersResponse,
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
  RemoveMintingAccountResult,
  ResolvedIdentity,
  RewardShare,
  StartMintingResult,
} from './types';

// Previewnet minting group id (Core previewchain.json `mintingGroupIds`). Being a
// member of this group is what authorizes an account to mint; joining it (via the
// Home bridge) carries the account's minting key so the on-chain reward share is
// created at join time.
export const MINTING_GROUP_ID = 2;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_RECENT_BLOCKS = 10;

// Bound on simultaneous per-height block/mintinginfo fetches so a large block
// window (App.tsx MAX_BLOCK_COUNT=200) cannot fire hundreds of concurrent
// FETCH_NODE_API calls at once.
const BLOCK_FETCH_CONCURRENCY = 8;

// Cross-call caches for name lookups, which almost never change between
// refreshes. Shared across getRecentBlocks, getBlockOnlineAccounts, and
// enrichMintingAccount so repeated refreshes/expands hit the cache instead of
// refetching. Entries store the in-flight Promise so concurrent lookups for the
// same address share a single request (true dedupe of the initial burst).
const IDENTITY_CACHE_MAX_ENTRIES = 500;
const identityProfileCache = new Map<string, Promise<IdentityProfile>>();

// Resolve a list of tasks with a bounded concurrency pool while preserving the
// input order in the returned array.
export async function mapWithConcurrency<T, R>(
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
  // Previewnet's featureTriggers.blockRewardBatchStartHeight in previewchain.json.
  // The top-level 1508000 value is a fallback that does not apply here.
  blockRewardBatchStartHeight: 55000,
};

function assertOk<T>(result: NodeApiFetchResult<T>, label: string) {
  if (!result.ok) {
    throw new Error(result.body || `${label} failed with HTTP ${result.status}.`);
  }

  return result.data;
}

/** Unwrap Home's FETCH_NODE_API envelope and make a failed result a normal error. */
export function responseData<T>(result: NodeApiFetchResult<T>, label = 'Request'): T {
  return assertOk(result, label);
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

export function buildMemberGroupsPath(address: string) {
  return `/groups/member/${encodeURIComponent(address)}`;
}

export function buildGroupMembersPath(groupId: number, limit = GROUP_MEMBER_PAGE_SIZE, offset = 0) {
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset), reverse: 'true' });
  return `/groups/members/${encodeURIComponent(String(groupId))}?${query.toString()}`;
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


// Home resolves account display identity in one read-only bridge call. Apps use
// its name field only; any legacy image hint never reaches UI state.
export async function resolveIdentities(addresses: string[], actions?: QdnAction[]): Promise<ResolvedIdentity[]> {
  if (!hasBridgeAction(actions, 'RESOLVE_IDENTITIES')) {
    throw new Error('RESOLVE_IDENTITIES is not available in this Home build.');
  }

  const unique = Array.from(new Set(addresses.filter((address) => address)));
  const resolved: ResolvedIdentity[] = [];

  for (let index = 0; index < unique.length; index += RESOLVE_IDENTITIES_LIMIT) {
    const batch = await qdnRequest<ResolvedIdentity[]>({
      action: 'RESOLVE_IDENTITIES',
      addresses: unique.slice(index, index + RESOLVE_IDENTITIES_LIMIT),
    });

    if (Array.isArray(batch)) {
      resolved.push(...batch
        .filter((identity): identity is ResolvedIdentity => !!identity && typeof identity.address === 'string')
        .map((identity) => ({ address: identity.address, name: normalizeRegisteredName(identity.name) })));
    }
  }

  return resolved;
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

// On-chain account info (level, blocksMinted, public key). Prefers the native
// GET_ACCOUNT_DATA bridge action when present, else falls back to GET /addresses/{address}.
export async function getAccountInfo(address: string, actions?: QdnAction[]) {
  if (hasBridgeAction(actions, 'GET_ACCOUNT_DATA')) {
    return qdnRequest<NodeAccountInfo>({ action: 'GET_ACCOUNT_DATA', address });
  }

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

export async function getSelfRewardShares(address: string): Promise<RewardShare[]> {
  const rewardShares = await fetchNodeApiData<RewardShare[]>(
    buildSelfRewardSharesPath(address),
    'Reward shares',
  );

  return rewardShares.filter(
    (rewardShare) => rewardShare.mintingAccount === address && rewardShare.recipient === address,
  );
}

// Groups the account currently belongs to. Prefers the native GET_ACCOUNT_GROUPS
// bridge action, else falls back to GET /groups/member/{address}.
export async function getMemberGroups(address: string, actions?: QdnAction[]): Promise<GroupData[]> {
  if (hasBridgeAction(actions, 'GET_ACCOUNT_GROUPS')) {
    return qdnRequest<GroupData[]>({
      action: 'GET_ACCOUNT_GROUPS',
      address,
    });
  }

  return fetchNodeApiData<GroupData[]>(buildMemberGroupsPath(address), 'Member groups');
}

// Whether the account is already a member of the minting group. Core flags the active
// minting group with isMintingGroup; match on that or the known MINTING_GROUP_ID so the
// check stays correct even if the configured minting group id changes.
export async function isMintingGroupMember(address: string, actions?: QdnAction[]): Promise<boolean> {
  const groups = await getMemberGroups(address, actions);

  return groups.some((group) => group.isMintingGroup === true || group.groupId === MINTING_GROUP_ID);
}

/** Fetch every group member page. The short-page stop avoids silently truncating a growing group. */
export async function getGroupMembers(groupId: number, actions?: QdnAction[], pageSize = GROUP_MEMBER_PAGE_SIZE): Promise<GroupMember[]> {
  const members: GroupMember[] = [];
  let offset = 0;
  const limit = Math.max(1, Math.min(GROUP_MEMBER_MAX_PAGE_SIZE, Math.trunc(pageSize)));

  while (true) {
    const page = hasBridgeAction(actions, 'GET_GROUP_MEMBERS')
      ? await qdnRequest<GroupMembersResponse>({ action: 'GET_GROUP_MEMBERS', groupId, limit, offset })
      : await fetchNodeApiData<GroupMembersResponse>(buildGroupMembersPath(groupId, limit, offset), 'Group members');
    const pageMembers = Array.isArray(page.members) ? page.members.filter((member): member is GroupMember =>
      !!member && typeof member.member === 'string' && member.member.length > 0,
    ) : [];
    members.push(...pageMembers);
    if (pageMembers.length < limit) return members;
    offset += pageMembers.length;
  }
}

// Submit a JOIN_GROUP transaction through the Home bridge. For the minting group the
// bridge attaches the account's minting public key, so the join also authorizes the
// minting key on chain. This is a WRITE the bridge must support (Home only).
export async function joinGroup(groupId: number, actions?: QdnAction[]): Promise<GroupActionResult> {
  if (!hasBridgeAction(actions, 'JOIN_GROUP')) {
    throw new Error('Joining a group requires Qortium Home.');
  }

  return qdnRequest<GroupActionResult>({
    action: 'JOIN_GROUP',
    groupId,
  });
}

// Authorize minting for the selected account and load its minting key onto the node.
// The bridge submits a self-share REWARD_SHARE if one is not yet on chain
// (rewardSharePending), otherwise it adds the derived minting key (keyAdded). Home only.
export async function startMinting(actions?: QdnAction[]): Promise<StartMintingResult> {
  if (!hasBridgeAction(actions, 'START_MINTING')) {
    throw new Error('Starting minting requires Qortium Home.');
  }

  return qdnRequest<StartMintingResult>({ action: 'START_MINTING' });
}

function resolveMintingAccountAddress(account: NodeMintingAccount) {
  return normalizeRegisteredName(account.address) ?? normalizeRegisteredName(account.mintingAccount);
}

// Name resolution is shared across refreshes. Avatar bytes are intentionally
// not part of this cache: mounted Avatar controls fetch those through Home.
function resolveIdentityProfile(address: string, actions?: QdnAction[]): Promise<IdentityProfile> {
  const cacheKey = `${address}\n${(actions ?? []).join(',')}`;
  const cached = identityProfileCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const pending = loadIdentityProfile(address, actions).catch((error: unknown) => {
    // Do not cache failures; allow a later refresh to retry.
    identityProfileCache.delete(cacheKey);

    throw error;
  });

  setCapped(identityProfileCache, cacheKey, pending, IDENTITY_CACHE_MAX_ENTRIES);

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
    const info = await getAccountInfo(address, actions);

    level = typeof info.level === 'number' ? info.level : null;
    blocksMinted = typeof info.blocksMinted === 'number' ? info.blocksMinted : null;
  } catch {
    // Account info unavailable; leave the on-chain fields null.
  }

  let name: string | null = null;
  try {
    const profile = await resolveIdentityProfile(address, actions);

    name = profile.name;
  } catch {
    // Name resolution is best-effort.
  }

  return {
    address,
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
  identity: IdentityProfile | null,
): BlockSummary {
  return {
    height,
    minterAddress: normalizeRegisteredName(mintingInfo?.minterAddress),
    minterLevel: typeof mintingInfo?.minterLevel === 'number' ? mintingInfo.minterLevel : null,
    minterName: identity?.name ?? null,
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

export async function getBlocksAtHeights(
  requestedHeights: number[],
  actions?: QdnAction[],
): Promise<BlockSummary[]> {
  const heights = [...new Set(
    requestedHeights
      .map((height) => Math.trunc(height))
      .filter((height) => height > 0),
  )].sort((left, right) => right - left);

  if (!heights.length) return [];

  const blocksByHeight = new Map<number, NodeBlockData>();

  await mapWithConcurrency(groupContiguousDescending(heights), 4, async (group) => {
    try {
      const range = await fetchNodeApiData<NodeBlockData[]>(
        buildBlockRangePath(group[0], group.length),
        'Block range',
      );

      for (const block of range) {
        if (typeof block.height === 'number') blocksByHeight.set(block.height, block);
      }
    } catch {
      // The per-height fallback below handles unavailable range calls.
    }
  });

  const base = await mapWithConcurrency(heights, BLOCK_FETCH_CONCURRENCY, async (height) => {
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

    return { block, height, mintingInfo };
  });

  const minterAddresses = base
    .map(({ mintingInfo }) => normalizeRegisteredName(mintingInfo?.minterAddress))
    .filter((address): address is string => !!address);
  const identities = await loadIdentityProfiles([...new Set(minterAddresses)], actions);
  const identitiesByAddress = new Map(identities.map((profile) => [profile.address, profile]));

  return base.map(({ block, height, mintingInfo }) => {
    const address = normalizeRegisteredName(mintingInfo?.minterAddress);
    return toBlockSummary(height, block, mintingInfo, address ? identitiesByAddress.get(address) ?? null : null);
  });
}

export async function getRecentBlocks(count = DEFAULT_RECENT_BLOCKS, actions?: QdnAction[]): Promise<BlockSummary[]> {
  const requestedCount = Math.max(0, Math.trunc(count));
  if (requestedCount === 0) return [];

  const currentHeight = await getCurrentHeight();
  return getBlocksAtHeights(
    Array.from({ length: requestedCount }, (_, index) => currentHeight - index).filter((height) => height > 0),
    actions,
  );
}

// Online accounts decoded from a specific block via /blocks/onlineaccounts/{height}.
export async function getBlockOnlineAccounts(
  height: number,
  actions?: QdnAction[],
): Promise<OnlineAccountEntry[]> {
  const raw = await fetchNodeApiData<OnlineAccountEntry[]>(
    buildBlockOnlineAccountsPath(height),
    'Block online accounts',
  );
  const identities = await loadIdentityProfiles(
    [...new Set(raw.map((entry) => entry.minter).filter(Boolean))],
    actions,
  );
  const identitiesByAddress = new Map(identities.map((profile) => [profile.address, profile]));

  return raw.map((entry) => {
    const profile = identitiesByAddress.get(entry.minter);
    return {
      level: typeof entry.level === 'number' ? entry.level : null,
      minter: entry.minter,
      name: profile?.name ?? normalizeRegisteredName(entry.name),
      onlineTimestamp: typeof entry.onlineTimestamp === 'number' ? entry.onlineTimestamp : null,
      recipient: normalizeRegisteredName(entry.recipient),
      sharePercent: typeof entry.sharePercent === 'number' ? entry.sharePercent : null,
    };
  });
}

// Remove a minting key from the local node. Core: DELETE /admin/mintingaccounts with
// the base58 public (or private) key as the plain-text body. This is a WRITE gated on a
// REMOVE_MINTING_ACCOUNT action. Qortium Home exposes this action (it prompts its own
// write-approval and takes the key as `publicKey`); it is also available in browser-dev
// when VITE_QORTIUM_NODE_API_KEY is set. Callers should check
// hasAction(actions, 'REMOVE_MINTING_ACCOUNT') first.
export async function removeMintingAccount(
  publicKey: string,
  actions?: QdnAction[],
): Promise<RemoveMintingAccountResult> {
  if (!publicKey) {
    throw new Error('A public key is required to remove a minting key.');
  }

  if (!hasBridgeAction(actions, 'REMOVE_MINTING_ACCOUNT')) {
    throw new Error(
      'Removing a minting key is not available here. It needs Qortium Home support, or a local node API key (VITE_QORTIUM_NODE_API_KEY) in browser-dev mode.',
    );
  }

  return qdnRequest<RemoveMintingAccountResult>({ action: 'REMOVE_MINTING_ACCOUNT', publicKey });
}

// Current online accounts from /addresses/online (ApiOnlineAccount in Core).
// Always available even when the per-block decode is empty. sharePercent is not
// exposed by this endpoint, so it is left null.
export async function getCurrentOnlineAccounts(actions?: QdnAction[]): Promise<OnlineAccountEntry[]> {
  const raw = await fetchNodeApiData<NodeOnlineAccount[]>(
    buildCurrentOnlineAccountsPath(),
    'Current online accounts',
  );
  const addresses = [...new Set(raw.map((entry) => entry.minterAddress ?? '').filter(Boolean))];
  const identities = await loadIdentityProfiles(addresses, actions);
  const identitiesByAddress = new Map(identities.map((profile) => [profile.address, profile]));

  return raw.map((entry) => {
    const minter = entry.minterAddress ?? '';
    const profile = identitiesByAddress.get(minter);
    return {
      level: typeof entry.minterLevel === 'number' ? entry.minterLevel : null,
      minter,
      name: profile?.name ?? null,
      onlineTimestamp: typeof entry.timestamp === 'number' ? entry.timestamp : null,
      recipient: entry.recipientAddress ?? null,
      sharePercent: null,
    };
  });
}

export function getPayoutConfig(): ChainPayoutConfig {
  return { ...PREVIEWNET_PAYOUT_CONFIG };
}
