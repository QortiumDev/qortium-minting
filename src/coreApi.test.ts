import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getGroupMembers,
  isMintingGroupMember,
  MINTING_GROUP_ID,
  responseData,
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
      { address: 'Qabc', name: 'alice' },
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

  it('unwraps successful responses and rejects failed ones', () => {
    expect(responseData({ body: '', contentType: 'application/json', data: { ok: true }, ok: true, status: 200, statusText: 'OK' })).toEqual({ ok: true });
    expect(() => responseData({ body: 'not available', contentType: 'text/plain', data: null, ok: false, status: 500, statusText: 'Error' })).toThrow('not available');
  });

  it('fetches group-member pages until a short page', async () => {
    qdnRequestMock
      .mockResolvedValueOnce({ members: Array.from({ length: 2 }, (_, index) => ({ member: `Q${index}` })) })
      .mockResolvedValueOnce({ members: [{ member: 'Q2' }] });
    await expect(getGroupMembers(2, ['GET_GROUP_MEMBERS'], 2)).resolves.toHaveLength(3);
    expect(qdnRequestMock).toHaveBeenCalledTimes(2);
  });
});
