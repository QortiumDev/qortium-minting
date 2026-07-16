import type { ChainPayoutConfig } from './types';
export type RefreshPlan = { blocks: boolean; height: boolean; minters: boolean; mintingAccounts: boolean; mintingStatus: boolean; onlineNow: boolean };
export function crossedPayoutBoundary(previous: number | null, next: number, config: ChainPayoutConfig) {
  if (previous === null || next <= previous) return false;
  const first = Math.floor(previous / config.blockRewardBatchSize) + 1;
  const last = Math.floor(next / config.blockRewardBatchSize);
  return first <= last && last * config.blockRewardBatchSize > config.blockRewardBatchStartHeight;
}
export function planRefresh(previous: number | null, next: number, config: ChainPayoutConfig): RefreshPlan {
  const payout = crossedPayoutBoundary(previous, next, config);
  return { blocks: true, height: true, minters: payout, mintingAccounts: payout, mintingStatus: true, onlineNow: true };
}
