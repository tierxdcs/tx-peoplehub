export type RegisterListPage<T> = {
  filteredItems: T[];
  visibleItems: T[];
  page: number;
  pageCount: number;
};

export function getRegisterListPage<T>({
  items,
  searchableText,
  search,
  page,
  pageSize = 10,
}: {
  items: T[];
  searchableText: (item: T) => string;
  search: string;
  page: number;
  pageSize?: number;
}): RegisterListPage<T> {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredItems = normalizedSearch
    ? items.filter((item) =>
        searchableText(item).toLocaleLowerCase().includes(normalizedSearch),
      )
    : items;
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const normalizedPage = Math.min(Math.max(1, page), pageCount);

  return {
    filteredItems,
    page: normalizedPage,
    pageCount,
    visibleItems: filteredItems.slice(
      (normalizedPage - 1) * pageSize,
      normalizedPage * pageSize,
    ),
  };
}
