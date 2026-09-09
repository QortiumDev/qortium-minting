import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { REFERENCE_SECTIONS, referenceSectionUrl } from './ReferenceNavigation';
import { Reference, MINTING_REFERENCE_EXAMPLES, MINTING_REFERENCE_ENDPOINTS } from './views/Reference';
import { MINTING_GROUP_ID, buildGroupMembersPath, getPayoutConfig } from './coreApi';
import { AVATAR_MAX_BYTES } from './avatarClient';
import { GROUP_MEMBER_PAGE_SIZE, RESOLVE_IDENTITIES_LIMIT } from './mintingConstants';

describe('Developers contract', () => {
  const markup = renderToStaticMarkup(<Reference />);
  it('provides accessible, English sections, selectable examples and copy status', () => {
    expect(markup).toContain('lang="en"');
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain('aria-label="Developer reference sections"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('role="status"');
    for (const [id] of REFERENCE_SECTIONS) expect(markup).toContain(`id="${id}"`);
    for (const text of ['Core is', 'SHOW_ACTIONS', 'public', 'approval', 'unknown', 'view=developers']) expect(markup).toContain(text);
  });
  it('keeps section links on the current Core path with all query values', () => {
    const url = referenceSectionUrl('https://node.test/render/APP/Mirror/other/42?view=developers&qdnHomeBridge=test&future=a&future=b#old', 'reference-reads');
    expect(url).toBe('/render/APP/Mirror/other/42?view=developers&qdnHomeBridge=test&future=a&future=b#reference-reads');
  });
  it('uses actual API builders, paging, avatar and payout constants', () => {
    const examples = MINTING_REFERENCE_EXAMPLES;
    expect(Object.keys(examples)).toEqual(['minting-status', 'start-minting', 'join-group', 'resolve-identities', 'minters', 'account-avatar', 'watch-tx']);
    expect(examples.minters).toContain('GET_GROUP_MEMBERS');
    expect(examples.minters).toContain(`limit: ${GROUP_MEMBER_PAGE_SIZE}`);
    expect(examples.minters).toContain(buildGroupMembersPath(MINTING_GROUP_ID).replace('offset=0&', ''));
    expect(examples.minters).toContain('response.data');
    expect(examples['join-group']).toContain(`groupId: ${MINTING_GROUP_ID}`);
    expect(examples['resolve-identities']).toContain(String(RESOLVE_IDENTITIES_LIMIT));
    expect(examples['account-avatar']).toContain(`maxBytes: ${AVATAR_MAX_BYTES}`);
    expect(examples['watch-tx']).toContain('response.data.blockHeight');
    expect(examples['start-minting']).toContain('rewardSharePending');
    for (const value of Object.values(getPayoutConfig())) expect(markup).toContain(String(value));
    expect(MINTING_REFERENCE_ENDPOINTS[0]).toContain(`/groups/members/${MINTING_GROUP_ID}`);
    for (const action of ['GET_ACCOUNT_DATA', 'GET_ACCOUNT_GROUPS', 'GET_ACCOUNT_NAMES', 'GET_SELECTED_ACCOUNT', 'SELECTED_ACCOUNT_CHANGED']) expect(markup).toContain(action);
  });
});


it('the Minters example executes both paginated bridge and Core-envelope reads', async () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('qdnRequest', MINTING_REFERENCE_EXAMPLES.minters + '\nreturn members;');
  for (const native of [true, false]) {
    const offsets: number[] = [];
    const members = await run(async (request: { action: string; path?: string; offset?: number }) => {
      if (request.action === 'SHOW_ACTIONS') return native ? ['GET_GROUP_MEMBERS'] : ['FETCH_NODE_API'];
      const offset = native ? request.offset! : Number(new URL(request.path!, 'https://node.test').searchParams.get('offset'));
      offsets.push(offset);
      const page = { members: Array.from({ length: offset === 0 ? GROUP_MEMBER_PAGE_SIZE : 1 }, (_, i) => ({ member: `account-${offset + i}` })) };
      return native ? page : { ok: true, data: page };
    });
    expect(offsets).toEqual([0, GROUP_MEMBER_PAGE_SIZE]);
    expect(members).toHaveLength(GROUP_MEMBER_PAGE_SIZE + 1);
  }
});

it('every exported example is valid JavaScript', () => {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const example of Object.values(MINTING_REFERENCE_EXAMPLES)) expect(() => new AsyncFunction(example)).not.toThrow();
});
