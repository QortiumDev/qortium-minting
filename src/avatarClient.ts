import { useEffect, useState } from 'react';
import { hasAction, qdnRequest } from './qdnRequest';
import type { QdnAction } from './types';

export const AVATAR_MAX_BYTES = 500 * 1024;

const SAFE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp']);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type AvatarSource = 'POINTER' | 'LEGACY';
type AvatarDescriptor = { identifier: string; name: string; service: string };

export type AccountAvatarFetch =
  | { kind: 'pending'; retryAfterSeconds: number; source: AvatarSource }
  | { kind: 'ready'; source: AvatarSource; src: string }
  | { kind: 'unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isAccountAddress(value: string) {
  return /^Q[1-9A-HJ-NP-Za-km-z]{20,80}$/.test(value);
}

function parseDescriptor(value: unknown): AvatarDescriptor | null {
  if (!isRecord(value)) return null;
  const service = text(value.service);
  const name = text(value.name);
  return service && name && typeof value.identifier === 'string' ? { identifier: value.identifier, name, service } : null;
}

function decodeBase64(value: string) {
  if (!value || !BASE64_PATTERN.test(value)) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function parseAccountAvatar(value: unknown, expectedAddress: string): AccountAvatarFetch {
  if (!isRecord(value) || value.address !== expectedAddress || (value.source !== 'POINTER' && value.source !== 'LEGACY')) {
    return { kind: 'unavailable' };
  }

  const source = value.source;
  if (source === 'POINTER' && !parseDescriptor(value.descriptor)) return { kind: 'unavailable' };

  if (value.status === 'PENDING') {
    const requestedDelay = typeof value.retryAfterSeconds === 'number' && Number.isFinite(value.retryAfterSeconds)
      ? value.retryAfterSeconds
      : 5;
    return { kind: 'pending', retryAfterSeconds: Math.min(Math.max(Math.floor(requestedDelay), 1), 30), source };
  }

  if (value.encoding !== 'base64' || typeof value.body !== 'string' || typeof value.contentType !== 'string') {
    return { kind: 'unavailable' };
  }

  const contentType = value.contentType.toLowerCase().split(';', 1)[0];
  const contentLength = value.contentLength;
  const bytes = decodeBase64(value.body);

  if (
    !SAFE_IMAGE_MIME_TYPES.has(contentType)
    || typeof contentLength !== 'number'
    || !Number.isSafeInteger(contentLength)
    || contentLength < 1
    || contentLength > AVATAR_MAX_BYTES
    || !bytes
    || bytes.byteLength !== contentLength
  ) return { kind: 'unavailable' };

  return { kind: 'ready', source, src: URL.createObjectURL(new Blob([bytes.buffer], { type: contentType })) };
}

/** Read one avatar through Home. The host owns legacy fallback; apps never make thumbnail URLs. */
export async function fetchAccountAvatar(address: string, actions?: QdnAction[]): Promise<AccountAvatarFetch> {
  if (!isAccountAddress(address) || !hasAction(actions ?? [], 'FETCH_ACCOUNT_AVATAR')) return { kind: 'unavailable' };
  try {
    return parseAccountAvatar(
      await qdnRequest<unknown>({ action: 'FETCH_ACCOUNT_AVATAR', address, maxBytes: AVATAR_MAX_BYTES }),
      address,
    );
  } catch {
    return { kind: 'unavailable' };
  }
}

export function revokeAvatarObjectUrl(src: string | null | undefined) {
  if (typeof src === 'string' && src.startsWith('blob:')) URL.revokeObjectURL(src);
}

/** Only mounted avatar controls call this hook, so list loading cannot batch-fetch image bytes. */
export function useAccountAvatar(address: string, actions?: QdnAction[]) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;

    const replace = (next: string | null) => {
      setSrc((current) => {
        if (current && current !== next) revokeAvatarObjectUrl(current);
        return next;
      });
    };

    const load = () => {
      void fetchAccountAvatar(address, actions).then((result) => {
        if (!active) {
          if (result.kind === 'ready') revokeAvatarObjectUrl(result.src);
          return;
        }
        if (result.kind === 'ready') {
          replace(result.src);
        } else if (result.kind === 'pending') {
          retryTimer = window.setTimeout(load, result.retryAfterSeconds * 1_000);
        } else {
          replace(null);
        }
      });
    };

    replace(null);
    load();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [actions, address]);

  useEffect(() => () => revokeAvatarObjectUrl(src), [src]);
  return src;
}
