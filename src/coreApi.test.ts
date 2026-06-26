import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isMintingGroupMember,
  MINTING_GROUP_ID,
  resolveIdentities,
  startMinting,
} from './coreApi';
import { qdnRequest } from './qdnRequest';

vi.mock('./qdnRequest', () => ({
  qdnRequest: vi.fn(),
}));

const qdnRequestMock = vi.mocked(qdnRequest);

describe('core API bridge helpers', () => {
  beforeEach(() => {
    qdnRequestMock.mockReset();
  });

  it('resolves account identities in one bridge request', async () => {
    qdnRequestMock.mockResolvedValueOnce([
      { address: 'Qabc', avatarSrc: 'http://node/avatar', name: 'alice' },
    ]);

    await expect(resolveIdentities(['Qabc', 'Qabc', ''], ['RESOLVE_IDENTITIES'])).resolves.toEqual([
      { address: 'Qabc', avatarSrc: 'http://node/avatar', name: 'alice' },
    ]);
    expect(qdnRequestMock).toHaveBeenCalledWith({
      action: 'RESOLVE_IDENTITIES',
      addresses: ['Qabc'],
    });
  });

  it('rejects identity resolution when Home does not expose the action', async () => {
    await expect(resolveIdentities(['Qabc'], [])).rejects.toThrow(/RESOLVE_IDENTITIES/);
    expect(qdnRequestMock).not.toHaveBeenCalled();
  });

  it('detects configured minting group membership', async () => {
    qdnRequestMock.mockResolvedValueOnce([{ groupId: MINTING_GROUP_ID, groupName: 'Minting' }]);

    await expect(isMintingGroupMember('Qabc', ['GET_ACCOUNT_GROUPS'])).resolves.toBe(true);
    expect(qdnRequestMock).toHaveBeenCalledWith({
      action: 'GET_ACCOUNT_GROUPS',
      address: 'Qabc',
    });
  });

  it('detects API-flagged minting group membership', async () => {
    qdnRequestMock.mockResolvedValueOnce([{ groupId: 99, groupName: 'Minting', isMintingGroup: true }]);

    await expect(isMintingGroupMember('Qabc', ['GET_ACCOUNT_GROUPS'])).resolves.toBe(true);
  });

  it('starts minting through the Home bridge action', async () => {
    const result = { accepted: true, action: 'START_MINTING' as const, address: 'Qabc', keyAdded: true };

    qdnRequestMock.mockResolvedValueOnce(result);

    await expect(startMinting(['START_MINTING'])).resolves.toEqual(result);
    expect(qdnRequestMock).toHaveBeenCalledWith({ action: 'START_MINTING' });
  });
});
