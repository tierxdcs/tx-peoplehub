import { describe, expect, it } from 'vitest';
import { getRegisterListPage } from './register-list';

const rows = [
  { code: 'BOM-001', name: 'Main Cabinet' },
  { code: 'GRN-002', name: 'Steel Sheet' },
  { code: 'PO-003', name: 'Power Module' },
];
const searchableText = (row: (typeof rows)[number]) => `${row.code} ${row.name}`;

describe('getRegisterListPage', () => {
  it('filters by any searchable text, case-insensitively, and excludes non-matches', () => {
    const result = getRegisterListPage({
      items: rows,
      searchableText,
      search: '  steel SHEET ',
      page: 1,
    });

    expect(result.filteredItems).toEqual([rows[1]]);
    expect(result.visibleItems).toEqual([rows[1]]);
  });

  it('calculates page boundaries and returns the requested page', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ id: index + 1 }));
    const result = getRegisterListPage({
      items,
      searchableText: (item) => String(item.id),
      search: '',
      page: 3,
      pageSize: 10,
    });

    expect(result.pageCount).toBe(3);
    expect(result.visibleItems).toEqual([{ id: 21 }]);
  });

  it('uses one empty page for zero results and clamps an out-of-range page', () => {
    const result = getRegisterListPage({
      items: rows,
      searchableText,
      search: 'not present',
      page: 8,
      pageSize: 2,
    });

    expect(result.pageCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.visibleItems).toEqual([]);
  });

  it('does not create an extra page when results exactly fill one page', () => {
    const items = Array.from({ length: 10 }, (_, index) => ({ id: index }));
    const result = getRegisterListPage({
      items,
      searchableText: (item) => String(item.id),
      search: '',
      page: 1,
      pageSize: 10,
    });

    expect(result.pageCount).toBe(1);
    expect(result.visibleItems).toHaveLength(10);
  });
});
