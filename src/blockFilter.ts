import type { ChainPayoutConfig } from './types';

export function isPayoutBlock(height: number, config: ChainPayoutConfig) {
  return height > config.blockRewardBatchStartHeight && height % config.blockRewardBatchSize === 0;
}

export function isOnlineAccountsBlock(height: number, config: ChainPayoutConfig) {
  if (height < config.blockRewardBatchStartHeight) return true;
  const next = height % config.blockRewardBatchSize === 0
    ? height
    : height + config.blockRewardBatchSize - (height % config.blockRewardBatchSize);
  return height >= next - config.blockRewardBatchAccountsBlockCount && !isPayoutBlock(height, config);
}

/** Return the newest useful batch heights, falling back to consecutive pre-batch heights. */
export function interestingHeights(tip: number, config: ChainPayoutConfig, count: number) {
  const wanted = Math.max(0, Math.trunc(count));
  const result: number[] = [];
  const seen = new Set<number>();
  const add = (height: number) => {
    if (height > 0 && height <= tip && result.length < wanted && !seen.has(height)) {
      seen.add(height);
      result.push(height);
    }
  };

  if (tip <= config.blockRewardBatchStartHeight) {
    for (let height = tip; height > 0 && result.length < wanted; height -= 1) add(height);
    return result;
  }

  // Start at the next payout boundary so a partially completed current
  // online-accounts window is included before the payout block exists.
  let boundary = Math.ceil(tip / config.blockRewardBatchSize) * config.blockRewardBatchSize;

  while (result.length < wanted && boundary > config.blockRewardBatchStartHeight) {
    add(boundary);
    for (let height = boundary - 1; height >= boundary - config.blockRewardBatchAccountsBlockCount; height -= 1) add(height);
    boundary -= config.blockRewardBatchSize;
  }

  // Just after activation there might not be a completed or active window yet.
  // Fill the remainder with the newest pre-trigger blocks instead of showing an
  // empty list.
  for (
    let height = Math.min(tip, config.blockRewardBatchStartHeight);
    height > 0 && result.length < wanted;
    height -= 1
  ) {
    add(height);
  }

  return result.sort((left, right) => right - left);
}

export function groupContiguousDescending(heights: number[]) {
  const sorted = [...new Set(heights)].sort((left, right) => right - left);
  const groups: number[][] = [];
  for (const height of sorted) {
    const current = groups.at(-1);
    if (current && current.at(-1) === height + 1) current.push(height);
    else groups.push([height]);
  }
  return groups;
}
