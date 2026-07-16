import { hasHomeBridge, qdnRequest } from './qdnRequest';
import type { NameSummary, QdnAction } from './types';

const AVATAR_MAX_BYTES = 500 * 1024;
const NEGATIVE_CACHE_COOLDOWN_MS = 5 * 60 * 1000;
const NEGATIVE_CACHE_MAX_ENTRIES = 1000;
const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const negativeCache = new Map<string, number>();
const inFlight = new Map<string, Promise<IdentityProfile>>();
export type IdentityProfile = { address: string; avatarSrc: string | null; name: string | null };

export function normalizeRegisteredName(name: string | null | undefined) { return typeof name === 'string' && name.length > 0 ? name : null; }
export function getAvatarFallbackCharacter(name: string | null | undefined) { return normalizeRegisteredName(name) ? Array.from(name!)[0] ?? '?' : '?'; }
export function hasBridgeAction(actions: QdnAction[] | undefined, action: string) { return actions?.some((value) => value.toUpperCase() === action.toUpperCase()) ?? false; }
export function getFirstRegisteredName(names: NameSummary[]) { return names.map((entry) => normalizeRegisteredName(entry.name)).find(Boolean) ?? null; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, key: string) { return record(value) && typeof value[key] === 'string' ? value[key] as string : ''; }
function sniffMime(base64: string) { if (base64.startsWith('iVBORw0KGgo')) return 'image/png'; if (base64.startsWith('/9j/')) return 'image/jpeg'; if (base64.startsWith('R0lGOD')) return 'image/gif'; if (base64.startsWith('UklGR')) return 'image/webp'; return 'image/png'; }
async function localDataUri(name: string) {
  const status = await qdnRequest<unknown>({ action: 'FETCH_NODE_API', path: `/arbitrary/resource/status/THUMBNAIL/${encodeURIComponent(name)}/avatar`, maxBytes: 64 * 1024 });
  const statusData = record(status) && 'data' in status ? status.data : status;
  if (text(statusData, 'status') === 'NOT_PUBLISHED') throw new Error('Avatar is not published.');
  const image = await qdnRequest<unknown>({ action: 'FETCH_NODE_API', path: `/arbitrary/THUMBNAIL/${encodeURIComponent(name)}/avatar?encoding=base64`, maxBytes: AVATAR_MAX_BYTES });
  const payload: unknown = record(image) ? image['data'] : image;
  const base64 = typeof payload === 'string' ? payload.trim() : '';
  if (!base64) throw new Error('Avatar was empty.');
  const declared = text(statusData, 'mimeType').toLowerCase();
  return `data:${RASTER_MIMES.has(declared) ? declared : sniffMime(base64)};base64,${base64}`;
}
export async function fetchAvatarImage(name: string, actions?: QdnAction[]) {
  if (hasHomeBridge() && hasBridgeAction(actions, 'GET_QDN_RESOURCE_URL')) {
    const url = await qdnRequest<unknown>({ action: 'GET_QDN_RESOURCE_URL', service: 'THUMBNAIL', name, identifier: 'avatar' });
    if (typeof url === 'string' && url) return url;
    throw new Error('No avatar render URL.');
  }
  return localDataUri(name);
}
function rememberFailure(address: string) { negativeCache.delete(address); negativeCache.set(address, Date.now()); while (negativeCache.size > NEGATIVE_CACHE_MAX_ENTRIES) negativeCache.delete(negativeCache.keys().next().value!); }
async function getName(address: string, actions?: QdnAction[]) {
  const names = await qdnRequest<unknown>(hasBridgeAction(actions, 'GET_ACCOUNT_NAMES') ? { action: 'GET_ACCOUNT_NAMES', address } : { action: 'FETCH_NODE_API', path: `/names/address/${encodeURIComponent(address)}` });
  const data = Array.isArray(names) ? names : record(names) && Array.isArray(names.data) ? names.data as NameSummary[] : [];
  return getFirstRegisteredName(data);
}
async function resolveOne(address: string, actions?: QdnAction[]): Promise<IdentityProfile> {
  let name: string | null = null;
  try { name = await getName(address, actions); } catch { /* keep nameless */ }
  if (!name) return { address, avatarSrc: null, name: null };
  const failedAt = negativeCache.get(address);
  if (failedAt && Date.now() - failedAt < NEGATIVE_CACHE_COOLDOWN_MS) return { address, avatarSrc: null, name };
  try { const avatarSrc = await fetchAvatarImage(name, actions); negativeCache.delete(address); return { address, avatarSrc, name }; }
  catch { rememberFailure(address); return { address, avatarSrc: null, name }; }
}
export function loadIdentityProfile(address: string, actions?: QdnAction[]) {
  const current = inFlight.get(address); if (current) return current;
  const pending = resolveOne(address, actions).finally(() => inFlight.delete(address)); inFlight.set(address, pending); return pending;
}
async function parallel<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 6) { const results = new Array<R>(items.length); let cursor = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; results[index] = await task(items[index]); } })); return results; }
export async function loadIdentityProfiles(addresses: string[], actions?: QdnAction[]) {
  if (!addresses.length) return [];
  if (hasHomeBridge() && hasBridgeAction(actions, 'RESOLVE_IDENTITIES')) {
    try { const output: IdentityProfile[] = []; for (let offset = 0; offset < addresses.length; offset += 500) { const batch = addresses.slice(offset, offset + 500); const resolved = await qdnRequest<{ address?: string; avatarSrc?: string; name?: string }[]>({ action: 'RESOLVE_IDENTITIES', addresses: batch }); const byAddress = new Map((Array.isArray(resolved) ? resolved : []).filter((entry): entry is { address: string; avatarSrc?: string; name?: string } => !!entry.address).map((entry) => [entry.address, entry])); output.push(...batch.map((address) => { const entry = byAddress.get(address); const name = normalizeRegisteredName(entry?.name); return { address, name, avatarSrc: name && entry?.avatarSrc ? entry.avatarSrc : null }; })); } return output; } catch { /* fall through */ }
  }
  return parallel(addresses, (address) => loadIdentityProfile(address, actions));
}
export function getIdentityLabel(profile: IdentityProfile | undefined, address: string) { return profile?.name ?? address; }
