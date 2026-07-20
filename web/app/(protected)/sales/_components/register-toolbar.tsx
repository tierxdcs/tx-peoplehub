import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from '../../../components/ui/input';

/**
 * Shared toolbar for the sales register tables (Leads / Opportunities / Bids /
 * Orders). Keeps a consistent layout: the register title on the left, then a
 * search box and any filter controls grouped together on the right. Filters are
 * passed in as children (the page owns its own Stage/Status/Business-unit
 * Selects) so each register keeps its specific filters while the arrangement
 * stays identical everywhere.
 */
export function RegisterToolbar({
  title,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
}: {
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
