export type MintingTab = 'status' | 'minters' | 'blocks' | 'reference';

export interface MintingRoute {
  tab: MintingTab;
}

const MINTING_TABS: readonly MintingTab[] = ['status', 'minters', 'blocks', 'reference'];
const DEFAULT_TAB: MintingTab = 'status';
const MINTING_ROUTE_KEYS = ['tab'] as const;

function isMintingTab(value: string | null): value is MintingTab {
  return value !== null && (MINTING_TABS as readonly string[]).includes(value);
}

export function readMintingRoute(input: string | URL): MintingRoute {
  const url = input instanceof URL ? input : new URL(input, 'http://localhost');
  const requestedTab = url.searchParams.get('tab');

  return { tab: isMintingTab(requestedTab) ? requestedTab : DEFAULT_TAB };
}

export function getMintingRouteUrl(input: string | URL, route: MintingRoute): URL {
  const url = input instanceof URL ? new URL(input.href) : new URL(input, 'http://localhost');

  for (const key of MINTING_ROUTE_KEYS) {
    url.searchParams.delete(key);
  }

  if (route.tab !== DEFAULT_TAB) {
    url.searchParams.set('tab', route.tab);
  }

  return url;
}
