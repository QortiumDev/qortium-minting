import type { AccountEnrichment, MinterRow } from './types';

export type MinterSortKey = 'name' | 'blocksMinted' | 'level' | 'joined';
export type SortDirection = 'asc' | 'desc';
export type SortState = { direction: SortDirection; key: MinterSortKey }[];

export function getDefaultSortDirection(key: MinterSortKey): SortDirection { return key === 'name' ? 'asc' : 'desc'; }
export function getAriaSort(sort: SortState, key: MinterSortKey) {
  const entry = sort.find((candidate) => candidate.key === key);
  return !entry ? 'none' : entry.direction === 'asc' ? 'ascending' : 'descending';
}
export function changeSortState(current: SortState, key: MinterSortKey): SortState {
  const index = current.findIndex((entry) => entry.key === key);
  if (index === 0) return [{ key, direction: current[0].direction === 'asc' ? 'desc' : 'asc' }, ...current.slice(1)];
  if (index > 0) return [current[index], ...current.filter((entry) => entry.key !== key)];
  return [{ key, direction: getDefaultSortDirection(key) }, ...current];
}
function missing(value: number | null | undefined) { return value === null || value === undefined || !Number.isFinite(value); }

function sortValue(row: MinterRow, key: MinterSortKey, enrichment: Map<string, AccountEnrichment>) {
  if (key === 'joined') return row.joined;
  if (key === 'name') return undefined;
  return enrichment.get(row.address)?.[key];
}

export function compareMinters(left: MinterRow, right: MinterRow, key: MinterSortKey, enrichment: Map<string, AccountEnrichment>) {
  if (key === 'name') return (left.primaryName ?? left.address).localeCompare(right.primaryName ?? right.address, undefined, { numeric: true, sensitivity: 'base' });
  const leftValue = sortValue(left, key, enrichment);
  const rightValue = sortValue(right, key, enrichment);
  if (missing(leftValue) || missing(rightValue)) return 0;
  return (leftValue as number) - (rightValue as number);
}
export function sortMinters(rows: MinterRow[], sort: SortState, enrichment: Map<string, AccountEnrichment>) {
  return rows.map((row, index) => ({ index, row })).sort((left, right) => {
    for (const entry of sort) {
      if (entry.key !== 'name') {
        const leftMissing = missing(sortValue(left.row, entry.key, enrichment));
        const rightMissing = missing(sortValue(right.row, entry.key, enrichment));

        // Progressive enrichment must remain at the bottom in both directions.
        if (leftMissing !== rightMissing) {
          return leftMissing ? 1 : -1;
        }
      }

      const comparison = compareMinters(left.row, right.row, entry.key, enrichment);
      if (comparison) return entry.direction === 'asc' ? comparison : -comparison;
    }
    return left.index - right.index;
  }).map(({ row }) => row);
}
