import { describe, expect, it } from 'vitest';

import { getPayoutConfig } from './coreApi';
import {
  groupContiguousDescending,
  interestingHeights,
  isOnlineAccountsBlock,
  isPayoutBlock,
} from './blockFilter';

const config = getPayoutConfig();

describe('batch block filtering', () => {
  it('uses the Previewnet feature trigger and emits payout plus window blocks', () => {
    expect(config.blockRewardBatchStartHeight).toBe(55000);
    expect(interestingHeights(57305, config, 12)).toEqual([57300, 57299, 57298, 57297, 57296, 57295, 57294, 57293, 57292, 57291, 57290, 57200]);
  });
  it('includes an in-progress online window before its payout exists', () => {
    expect(interestingHeights(57395, config, 6)).toEqual([57395, 57394, 57393, 57392, 57391, 57390]);
  });
  it('falls back to pre-trigger blocks just after activation', () => {
    expect(interestingHeights(55001, config, 3)).toEqual([55000, 54999, 54998]);
  });
  it('recognizes payout and online-window edges', () => {
    expect(isPayoutBlock(57300, config)).toBe(true);
    expect(isOnlineAccountsBlock(57290, config)).toBe(true);
    expect(isOnlineAccountsBlock(57300, config)).toBe(false);
  });

  it('honors the requested result count across multiple batch windows', () => {
    expect(interestingHeights(57305, config, 25)).toHaveLength(25);
    expect(interestingHeights(57305, config, 25).at(-1)).toBe(57098);
  });

  it('groups decreasing contiguous runs', () => {
    expect(groupContiguousDescending([10, 9, 8, 4, 3])).toEqual([[10, 9, 8], [4, 3]]);
  });
});
