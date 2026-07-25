import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_MAX_BYTES, fetchAccountAvatar, revokeAvatarObjectUrl } from './avatarClient';
import { qdnRequest } from './qdnRequest';

vi.mock('./qdnRequest', () => ({
  hasAction: (actions: string[], ...candidates: string[]) =>
    candidates.some((candidate) => actions.some((action) => action.toUpperCase() === candidate.toUpperCase())),
  qdnRequest: vi.fn(),
}));

const ADDRESS = `Q${'1'.repeat(33)}`;

describe('pointer-aware account avatar client', () => {
  const qdnRequestMock = vi.mocked(qdnRequest);
  const createObjectURLMock = vi.fn((blob: Blob) => `blob:mock/${blob.type}`);
  const revokeObjectURLMock = vi.fn();

  beforeEach(() => {
    qdnRequestMock.mockReset();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
    (URL as unknown as { createObjectURL: typeof createObjectURLMock }).createObjectURL = createObjectURLMock;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURLMock }).revokeObjectURL = revokeObjectURLMock;
  });

  it('feature-gates avatar reads and validates the address before requesting', async () => {
    await expect(fetchAccountAvatar(ADDRESS, ['FETCH_NODE_API'])).resolves.toEqual({ kind: 'unavailable' });
    await expect(fetchAccountAvatar('not-an-address', ['FETCH_ACCOUNT_AVATAR'])).resolves.toEqual({ kind: 'unavailable' });
    expect(qdnRequestMock).not.toHaveBeenCalled();
  });

  it.each([
    ['POINTER', { identifier: 'avatar', name: 'alice', service: 'THUMBNAIL' }],
    ['LEGACY', null],
  ] as const)('creates a safe Blob URL for a ready %s avatar', async (source, descriptor) => {
    qdnRequestMock.mockResolvedValueOnce({
      address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: 8, contentType: 'image/png', descriptor, encoding: 'base64', source,
    });

    await expect(fetchAccountAvatar(ADDRESS, ['FETCH_ACCOUNT_AVATAR'])).resolves.toEqual({
      kind: 'ready', source, src: 'blob:mock/image/png',
    });
    expect(qdnRequestMock).toHaveBeenCalledWith({ action: 'FETCH_ACCOUNT_AVATAR', address: ADDRESS, maxBytes: AVATAR_MAX_BYTES });
  });

  it('accepts BMP images and exposes explicit pending retries', async () => {
    qdnRequestMock
      .mockResolvedValueOnce({
        address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: 8, contentType: 'image/bmp',
        descriptor: { identifier: 'avatar', name: 'alice', service: 'THUMBNAIL' }, encoding: 'base64', source: 'POINTER',
      })
      .mockResolvedValueOnce({
        address: ADDRESS, descriptor: { identifier: 'avatar', name: 'alice', service: 'THUMBNAIL' },
        retryAfterSeconds: 99, source: 'POINTER', status: 'PENDING',
      });

    await expect(fetchAccountAvatar(ADDRESS, ['FETCH_ACCOUNT_AVATAR'])).resolves.toMatchObject({ kind: 'ready', src: 'blob:mock/image/bmp' });
    await expect(fetchAccountAvatar(ADDRESS, ['FETCH_ACCOUNT_AVATAR'])).resolves.toEqual({ kind: 'pending', retryAfterSeconds: 30, source: 'POINTER' });
  });

  it.each([
    { address: `Q${'2'.repeat(33)}`, body: 'iVBORw0KGgo=', contentLength: 8, contentType: 'image/png', descriptor: null, encoding: 'base64', source: 'LEGACY' },
    { address: ADDRESS, body: 'not base64!', contentLength: 8, contentType: 'image/png', descriptor: null, encoding: 'base64', source: 'LEGACY' },
    { address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: 9, contentType: 'image/png', descriptor: null, encoding: 'base64', source: 'LEGACY' },
    { address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: 8, contentType: 'image/svg+xml', descriptor: null, encoding: 'base64', source: 'LEGACY' },
    { address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: AVATAR_MAX_BYTES + 1, contentType: 'image/png', descriptor: null, encoding: 'base64', source: 'LEGACY' },
    { address: ADDRESS, body: 'iVBORw0KGgo=', contentLength: 8, contentType: 'image/png', descriptor: null, encoding: 'base64', source: 'POINTER' },
  ])('rejects malformed or unsafe avatar responses', async (response) => {
    qdnRequestMock.mockResolvedValueOnce(response);
    await expect(fetchAccountAvatar(ADDRESS, ['FETCH_ACCOUNT_AVATAR'])).resolves.toEqual({ kind: 'unavailable' });
    expect(createObjectURLMock).not.toHaveBeenCalled();
  });

  it('revokes only Blob URLs', () => {
    revokeAvatarObjectUrl('https://node.example/avatar.png');
    revokeAvatarObjectUrl('blob:mock/image/png');
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
  });
});
