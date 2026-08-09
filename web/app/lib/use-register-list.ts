'use client';

import { useEffect, useMemo, useState } from 'react';
import { getRegisterListPage } from './register-list';

export function useRegisterList<T>(
  items: T[],
  searchableText: (item: T) => string,
  pageSize = 10,
) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const result = useMemo(
    () =>
      getRegisterListPage({ items, searchableText, search, page, pageSize }),
    [items, page, pageSize, search, searchableText],
  );

  useEffect(() => setPage(1), [search]);
  useEffect(() => {
    if (page !== result.page) setPage(result.page);
  }, [page, result.page]);

  return {
    search,
    setSearch,
    page,
    setPage,
    pageCount: result.pageCount,
    filteredItems: result.filteredItems,
    visibleItems: result.visibleItems,
  };
}
