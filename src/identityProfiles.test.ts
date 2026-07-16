import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadIdentityProfiles, normalizeRegisteredName } from './identityProfiles';
import { hasHomeBridge, qdnRequest } from './qdnRequest';

vi.mock('./qdnRequest', () => ({ hasHomeBridge: vi.fn(), qdnRequest: vi.fn() }));

describe('identity profiles', () => {
  beforeEach(() => {
    vi.mocked(qdnRequest).mockReset();
    vi.mocked(hasHomeBridge).mockReset();
    vi.mocked(hasHomeBridge).mockReturnValue(true);
  });

  it('uses the batch identity action and preserves missing entries', async () => {
    vi.mocked(qdnRequest).mockResolvedValue([
      { address: 'Qone', name: 'one', avatarSrc: 'url' },
    ]);

    await expect(loadIdentityProfiles(['Qone', 'Qtwo'], ['RESOLVE_IDENTITIES'])).resolves.toEqual([
      { address: 'Qone', name: 'one', avatarSrc: 'url' },
      { address: 'Qtwo', name: null, avatarSrc: null },
    ]);
  });

  it('chunks identity resolution at the 500-address bridge limit and preserves order', async () => {
    const addresses = Array.from({ length: 501 }, (_, index) => `Q${index}`);
    vi.mocked(qdnRequest)
      .mockImplementationOnce(async (request) => {
        const batch = 'addresses' in request && Array.isArray(request.addresses)
          ? request.addresses
          : [];
        return [...batch].reverse().map((address) => ({
          address,
          avatarSrc: `avatar:${address}`,
          name: `name:${address}`,
        }));
      })
      .mockResolvedValueOnce([
        { address: 'Q500', avatarSrc: 'avatar:Q500', name: 'name:Q500' },
      ]);

    const resolved = await loadIdentityProfiles(addresses, ['RESOLVE_IDENTITIES']);

    expect(qdnRequest).toHaveBeenNthCalledWith(1, {
      action: 'RESOLVE_IDENTITIES',
      addresses: addresses.slice(0, 500),
    });
    expect(qdnRequest).toHaveBeenNthCalledWith(2, {
      action: 'RESOLVE_IDENTITIES',
      addresses: ['Q500'],
    });
    expect(resolved.map((profile) => profile.address)).toEqual(addresses);
    expect(resolved[500]).toEqual({
      address: 'Q500',
      avatarSrc: 'avatar:Q500',
      name: 'name:Q500',
    });
  });

  it('normalizes empty names', () => expect(normalizeRegisteredName('')).toBeNull());
});
