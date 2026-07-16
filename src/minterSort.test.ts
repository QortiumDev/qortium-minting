import { describe, expect, it } from 'vitest';
import { changeSortState, sortMinters } from './minterSort';
import type { MinterRow } from './types';
const rows: MinterRow[] = [{ address: 'Q2', member: 'Q2', primaryName: 'name 10', index: 0 }, { address: 'Q1', member: 'Q1', primaryName: 'name 2', index: 1 }];
describe('minter sorting', () => {
  it('sorts numeric names and leaves missing enrichment last', () => expect(sortMinters(rows, [{ key: 'name', direction: 'asc' }], new Map()).map((row) => row.address)).toEqual(['Q1', 'Q2']));
  it('keeps missing enrichment last for descending numeric sorts', () => {
    const enrichment = new Map([['Q1', { blocksMinted: 10, blocksMintedPenalty: 0, level: 1 }]]);
    expect(sortMinters(rows, [{ key: 'blocksMinted', direction: 'desc' }], enrichment).map((row) => row.address)).toEqual(['Q1', 'Q2']);
  });
  it('promotes and flips sort columns', () => expect(changeSortState([{ key: 'blocksMinted', direction: 'desc' }], 'blocksMinted')[0].direction).toBe('asc'));
});
