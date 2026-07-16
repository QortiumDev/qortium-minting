import { describe, expect, it } from 'vitest';

import { getPayoutConfig } from './coreApi';
import { crossedPayoutBoundary, planRefresh } from './refresh';

describe('smart refresh planning', () => {
  it('refreshes enrichment only across payout boundaries', () => {
    const config = getPayoutConfig();
    expect(crossedPayoutBoundary(57299, 57300, config)).toBe(true);
    expect(crossedPayoutBoundary(57300, 57301, config)).toBe(false);
    expect(planRefresh(57299, 57300, config).minters).toBe(true);
  });

  it('detects a payout boundary when more than one batch was crossed', () => {
    expect(crossedPayoutBoundary(57150, 57301, getPayoutConfig())).toBe(true);
  });

  it('does not refresh enrichment before the configured batch-reward trigger', () => {
    const config = getPayoutConfig();
    expect(crossedPayoutBoundary(54899, 54900, config)).toBe(false);
    expect(crossedPayoutBoundary(null, 57300, config)).toBe(false);
  });
});
