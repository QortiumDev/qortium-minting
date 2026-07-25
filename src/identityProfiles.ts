import { hasHomeBridge, qdnRequest } from './qdnRequest';
import type { NameSummary, QdnAction } from './types';

const NEGATIVE_CACHE_COOLDOWN_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_MAX_ENTRIES = 1000;
const negativeCache = new Map<string, number>();
const inFlight = new Map<string, Promise<IdentityProfile>>();

// Identity batching is deliberately names-only. Avatar bytes are fetched by a
// mounted Avatar control through the pointer-aware bridge client, never during
// background list enrichment.
export type IdentityProfile = { address: string; name: string | null };

export function normalizeRegisteredName(name: string | null | undefined) {
  return typeof name === 'string' && name.length > 0 ? name : null;
}

export function getAvatarFallbackCharacter(name: string | null | undefined) {
  return normalizeRegisteredName(name) ? Array.from(name!)[0] ?? '?' : '?';
}

export function hasBridgeAction(actions: QdnAction[] | undefined, action: string) {
  return actions?.some((value) => value.toUpperCase() === action.toUpperCase()) ?? false;
}

export function getFirstRegisteredName(names: NameSummary[]) {
  return names.map((entry) => normalizeRegisteredName(entry.name)).find(Boolean) ?? null;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function rememberFailure(address: string) {
  negativeCache.delete(address);
  negativeCache.set(address, Date.now());
  while (negativeCache.size > NEGATIVE_CACHE_MAX_ENTRIES) negativeCache.delete(negativeCache.keys().next().value!);
}

async function getName(address: string, actions?: QdnAction[]) {
  const names = await qdnRequest<unknown>(
    hasBridgeAction(actions, 'GET_ACCOUNT_NAMES')
      ? { action: 'GET_ACCOUNT_NAMES', address }
      : { action: 'FETCH_NODE_API', path: `/names/address/${encodeURIComponent(address)}` },
  );
  const data = Array.isArray(names) ? names : record(names) && Array.isArray(names.data) ? names.data as NameSummary[] : [];
  return getFirstRegisteredName(data);
}

async function resolveOne(address: string, actions?: QdnAction[]): Promise<IdentityProfile> {
  const failedAt = negativeCache.get(address);
  if (failedAt && Date.now() - failedAt < NEGATIVE_CACHE_COOLDOWN_MS) return { address, name: null };

  try {
    const name = await getName(address, actions);
    negativeCache.delete(address);
    return { address, name };
  } catch {
    rememberFailure(address);
    return { address, name: null };
  }
}

export function loadIdentityProfile(address: string, actions?: QdnAction[]) {
  const current = inFlight.get(address);
  if (current) return current;
  const pending = resolveOne(address, actions).finally(() => inFlight.delete(address));
  inFlight.set(address, pending);
  return pending;
}

async function parallel<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 6) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

export async function loadIdentityProfiles(addresses: string[], actions?: QdnAction[]) {
  if (!addresses.length) return [];

  if (hasHomeBridge() && hasBridgeAction(actions, 'RESOLVE_IDENTITIES')) {
    try {
      const output: IdentityProfile[] = [];
      for (let offset = 0; offset < addresses.length; offset += 500) {
        const batch = addresses.slice(offset, offset + 500);
        const resolved = await qdnRequest<{ address?: string; name?: string }[]>({
          action: 'RESOLVE_IDENTITIES',
          addresses: batch,
        });
        const byAddress = new Map(
          (Array.isArray(resolved) ? resolved : [])
            .filter((entry): entry is { address: string; name?: string } => !!entry.address)
            .map((entry) => [entry.address, entry]),
        );
        output.push(...batch.map((address) => ({
          address,
          name: normalizeRegisteredName(byAddress.get(address)?.name),
        })));
      }
      return output;
    } catch {
      // A Home build without batch identities still gets the names-only fallback.
    }
  }

  return parallel(addresses, (address) => loadIdentityProfile(address, actions));
}

export function getIdentityLabel(profile: IdentityProfile | undefined, address: string) {
  return profile?.name ?? address;
}
