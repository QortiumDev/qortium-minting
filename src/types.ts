export type QdnAction = string;

export type BridgeState = {
  actions: QdnAction[];
  isHomeBridge: boolean;
  ui: string;
};

export type QdnSelectedAccount = {
  address: string;
  avatarUrl: string | null;
  id?: string;
  isUnlocked: boolean;
  name: string | null;
  resourceUrl?: string;
};

export type NodeApiFetchResult<T = unknown> = {
  body: string;
  contentLength?: number;
  contentType: string;
  data: T;
  headers?: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
};

export type NodeStatus = {
  height?: number;
  isMintingPossible?: boolean;
  isSynchronizing?: boolean;
  numberOfConnections?: number;
  syncPercent?: number;
  syncPhase?: string;
  syncTargetHeight?: number;
  version?: string;
  [key: string]: unknown;
};

export type NameSummary = {
  name?: string | null;
  owner?: string | null;
};

export type RewardShare = {
  mintingAccount?: string;
  recipient?: string;
  rewardSharePublicKey?: string;
  sharePercent?: number;
};

// Shape returned by GET /admin/mintingaccounts (Core MintingAccountData JSON).
export type NodeMintingAccount = {
  address?: string;
  mintingAccount?: string;
  publicKey?: string;
  recipientAccount?: string;
};

// Matches qortium-chat MintingStatus verbatim.
export type MintingStatus = {
  address: string;
  hasRewardShare: boolean;
  isMinting: boolean | null;
  keyOnNode: boolean | null;
  nodeMintingPossible: boolean | null;
};

// Subset of Core GroupData returned by GET /groups/member/{address} (the groups an
// account belongs to). isMintingGroup is set by Core for the active minting group(s).
export type GroupData = {
  groupId: number;
  groupName?: string;
  isMintingGroup?: boolean;
  isOpen?: boolean;
};

// Result of the Home bridge JOIN_GROUP write action.
export type GroupActionResult = {
  accepted: boolean;
  action: 'JOIN_GROUP';
  groupId?: number;
  groupName?: string | null;
  transactionSignature?: string;
};

// Result of the Home bridge START_MINTING write action. Mirrors qortium-chat.
// keyAdded: the minting key was loaded onto the node. rewardSharePending: an on-chain
// self-share authorization was just submitted and must confirm before the key can be added.
export type StartMintingResult = {
  accepted: boolean;
  action: 'START_MINTING';
  address: string;
  keyAdded: boolean;
  rewardSharePending?: boolean;
  transactionSignature?: string;
};

// Shape returned by GET /addresses/{address} (Core AccountData JSON).
export type NodeAccountInfo = {
  address?: string;
  blocksMinted?: number;
  blocksMintedAdjustment?: number;
  blocksMintedPenalty?: number;
  defaultGroupId?: number;
  level?: number;
  publicKey?: string;
};

// A minting-key account known to the connected node, enriched with on-chain
// account info, its registered name, and (optionally) a resolved avatar.
export type MintingAccountInfo = {
  address: string;
  avatarSrc: string | null;
  blocksMinted: number | null;
  level: number | null;
  name: string | null;
  publicKey: string | null;
  recipientAddress: string | null;
};

// Result wrapper for listMintingAccounts: the restricted endpoint may be
// unauthorized/unavailable on a public read-only node, so callers get an
// explicit availability flag instead of an exception.
export type MintingAccountsResult = {
  accounts: MintingAccountInfo[];
  available: boolean;
};

// Shape returned by GET /blocks/byheight/{height}/mintinginfo (Core BlockMintingInfo).
export type BlockMintingInfo = {
  keyDistance?: string;
  keyDistanceRatio?: number;
  maxDistance?: string;
  minterAddress?: string;
  minterLevel?: number;
  minterPublicKey?: string;
  onlineAccountsCount?: number;
  timeDelta?: number;
  timestamp?: number;
};

// Shape returned by GET /blocks/byheight/{height} and /blocks/range/{height} (Core BlockData).
export type NodeBlockData = {
  height?: number;
  minterPublicKey?: string;
  onlineAccountsCount?: number;
  signature?: string;
  timestamp?: number;
};

// A recent block, enriched with minter address/level/name from mintinginfo.
export type BlockSummary = {
  height: number;
  minterAddress: string | null;
  minterLevel: number | null;
  minterName: string | null;
  onlineAccountsCount: number | null;
  signature: string | null;
  timestamp: number | null;
};

// One signed online-account entry for a block.
// Shape returned by GET /blocks/onlineaccounts/{height} (Core DecodedOnlineAccountData).
export type OnlineAccountEntry = {
  level: number | null;
  minter: string;
  name: string | null;
  onlineTimestamp: number | null;
  recipient: string | null;
  sharePercent: number | null;
};

// Raw shape of /addresses/online entries (ApiOnlineAccount in Core).
export type NodeOnlineAccount = {
  timestamp?: number;
  minterAddress?: string;
  recipientAddress?: string;
  minterLevel?: number;
  isMinterMember?: boolean;
};

// Chain batch-reward / online-accounts schedule parameters. Mirrors Core's
// BlockChain.blockRewardBatch* settings. Kept for forward-compat so block lists
// can label online-accounts and payout blocks without re-deriving the rules.
export type ChainPayoutConfig = {
  blockRewardBatchAccountsBlockCount: number;
  blockRewardBatchSize: number;
  blockRewardBatchStartHeight: number;
};
