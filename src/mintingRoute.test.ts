import { describe, expect, it } from 'vitest';
import { getMintingRouteUrl, readMintingRoute, type MintingTab } from './mintingRoute';

describe('Minting routes', () => {
  it('reads valid tab values', () => {
    expect(readMintingRoute('https://example.test/app?tab=minters')).toEqual({ tab: 'minters' });
    expect(readMintingRoute('https://example.test/app?tab=blocks')).toEqual({ tab: 'blocks' });
    expect(readMintingRoute('https://example.test/app?tab=reference')).toEqual({ tab: 'reference' });
    expect(readMintingRoute('https://example.test/app?tab=status')).toEqual({ tab: 'status' });
  });

  it('falls back to status for absent or invalid tabs', () => {
    expect(readMintingRoute('https://example.test/app')).toEqual({ tab: 'status' });
    expect(readMintingRoute('https://example.test/app?tab=unknown')).toEqual({ tab: 'status' });
    expect(readMintingRoute('https://example.test/app?tab=')).toEqual({ tab: 'status' });
  });

  it('replaces only the Minting-owned key while preserving Home settings and fragments', () => {
    const url = getMintingRouteUrl(
      'https://example.test/render/APP/Minting/Minting?tab=blocks&qdnHomeBridge=1&theme=dark&lang=en&textSize=large&accent=blue&uiStyle=modern&future=value#detail',
      { tab: 'minters' },
    );

    expect(url.pathname).toBe('/render/APP/Minting/Minting');
    expect(url.searchParams.get('tab')).toBe('minters');
    expect(url.searchParams.get('qdnHomeBridge')).toBe('1');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('textSize')).toBe('large');
    expect(url.searchParams.get('accent')).toBe('blue');
    expect(url.searchParams.get('uiStyle')).toBe('modern');
    expect(url.searchParams.get('future')).toBe('value');
    expect(url.hash).toBe('#detail');
  });

  it('omits the default tab from the produced URL', () => {
    const url = getMintingRouteUrl('https://example.test/app?tab=minters&theme=dark', { tab: 'status' });

    expect(url.searchParams.has('tab')).toBe(false);
    expect(url.searchParams.get('theme')).toBe('dark');
  });

  it('round-trips every supported tab', () => {
    const tabs: MintingTab[] = ['status', 'minters', 'blocks', 'reference'];

    for (const tab of tabs) {
      expect(readMintingRoute(getMintingRouteUrl('https://example.test/app?theme=dark', { tab }))).toEqual({ tab });
    }
  });
});


describe('canonical Developers workspace', () => {
  it.each(['developers', 'developer', 'reference'])('accepts view=%s ahead of tab', view => {
    expect(readMintingRoute(`/?view=${view}&tab=blocks`)).toEqual({ tab: 'reference' });
  });
  it('canonicalizes the old tab alias, preserving repeated host parameters and fragment', () => {
    const before = 'https://example.test/render/APP/Minting/qortium-minting?tab=reference&tab=blocks&future=a&future=b&theme=dark&qdnHomeBridge=test#reference-reads';
    const url = getMintingRouteUrl(before, readMintingRoute(before));
    expect(url.pathname).toBe('/render/APP/Minting/qortium-minting');
    expect(url.searchParams.getAll('view')).toEqual(['developers']);
    expect(url.searchParams.has('tab')).toBe(false);
    expect(url.searchParams.getAll('future')).toEqual(['a', 'b']);
    expect(url.searchParams.get('qdnHomeBridge')).toBe('test');
    expect(url.hash).toBe('#reference-reads');
    const blocks = getMintingRouteUrl(url, { tab: 'blocks' });
    expect(blocks.searchParams.has('view')).toBe(false);
    expect(readMintingRoute(blocks)).toEqual({ tab: 'blocks' });
  });
  it('falls back to the existing tab for an unknown view', () => {
    expect(readMintingRoute('/?view=future&tab=minters')).toEqual({ tab: 'minters' });
    expect(readMintingRoute('/?view=future')).toEqual({ tab: 'status' });
  });
});
