import * as React from 'react';
import { Search } from 'lucide-react';
import { Input } from './input';

export interface RegisterToolbarProps {
  title: string;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Shared controls for searchable register pages. Pages own their query state
 * and filter controls; this component only standardises their arrangement.
 * `children` remains supported for the original Sales register call sites.
 */
export function RegisterToolbar({
  title,
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  action,
  children,
}: RegisterToolbarProps) {
  const filterControls = filters ?? children;

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label={searchPlaceholder}
          />
        </div>
        {filterControls}
        {action}
      </div>
    </div>
  );
}
