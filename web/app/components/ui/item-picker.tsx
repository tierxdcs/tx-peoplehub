'use client';

import {
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  type ItemType,
} from '../../lib/scm-item-master';

const RECENT_ITEMS_KEY = 'workcore.recent-item-ids';
const MAX_RECENT_ITEMS = 5;

export type ItemPickerContext = 'default' | 'bom-component';
export interface ItemPickerItem {
  id: string;
  itemCode: string;
  name: string;
  itemType: ItemType;
}

export const ITEM_GROUP_LABEL: Record<ItemType, string> = {
  FINISHED_GOOD: 'Finished Goods',
  SUBASSEMBLY: 'Sub-Assemblies',
  COMPONENT: 'Components',
  RAW_MATERIAL: 'Raw Materials',
  CONSUMABLE: 'Consumables',
};

const DEFAULT_ORDER: ItemType[] = [
  'FINISHED_GOOD',
  'SUBASSEMBLY',
  'COMPONENT',
  'RAW_MATERIAL',
  'CONSUMABLE',
];
const BOM_COMPONENT_ORDER: ItemType[] = [
  'SUBASSEMBLY',
  'COMPONENT',
  'RAW_MATERIAL',
  'CONSUMABLE',
  'FINISHED_GOOD',
];

export function filterAndGroupItems(
  items: ItemPickerItem[],
  query: string,
  context: ItemPickerContext = 'default',
) {
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = items.filter(
    (item) =>
      !normalized ||
      item.itemCode.toLocaleLowerCase().includes(normalized) ||
      item.name.toLocaleLowerCase().includes(normalized),
  );
  const order = context === 'bom-component' ? BOM_COMPONENT_ORDER : DEFAULT_ORDER;
  return order
    .map((itemType) => ({
      itemType,
      label: ITEM_GROUP_LABEL[itemType],
      items: filtered
        .filter((item) => item.itemType === itemType)
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    }))
    .filter((group) => group.items.length > 0);
}

export function recentItems(items: ItemPickerItem[], recentIds: string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return recentIds
    .map((id) => byId.get(id))
    .filter((item): item is ItemPickerItem => Boolean(item));
}

export function itemTypeFromCode(itemCode: string): ItemType {
  if (itemCode.startsWith('FG-')) return 'FINISHED_GOOD';
  if (itemCode.startsWith('SA-')) return 'SUBASSEMBLY';
  if (itemCode.startsWith('CM-')) return 'COMPONENT';
  if (itemCode.startsWith('CN-')) return 'CONSUMABLE';
  return 'RAW_MATERIAL';
}

function readRecentIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function rememberItem(id: string) {
  const next = [id, ...readRecentIds().filter((recentId) => recentId !== id)].slice(
    0,
    MAX_RECENT_ITEMS,
  );
  localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(next));
  return next;
}

export function ItemPicker({
  items,
  value,
  onValueChange,
  context = 'default',
  placeholder = 'Select item…',
  disabled = false,
  allowClear = true,
  id,
  className,
}: {
  items: ItemPickerItem[];
  value: string;
  onValueChange: (itemId: string) => void;
  context?: ItemPickerContext;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  id?: string;
  className?: string;
}) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = items.find((item) => item.id === value);
  const groups = useMemo(
    () => filterAndGroupItems(items, query, context),
    [context, items, query],
  );
  const recent = useMemo(
    () => (query.trim() ? [] : recentItems(items, recentIds)),
    [items, query, recentIds],
  );
  const recentSet = new Set(recent.map((item) => item.id));
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: query.trim()
        ? group.items
        : group.items.filter((item) => !recentSet.has(item.id)),
    }))
    .filter((group) => group.items.length > 0);
  const selectable = [...recent, ...visibleGroups.flatMap((group) => group.items)];

  useEffect(() => setRecentIds(readRecentIds()), []);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);
  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function select(item: ItemPickerItem) {
    onValueChange(item.id);
    setRecentIds(rememberItem(item.id));
    setOpen(false);
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, selectable.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && selectable[activeIndex]) {
      event.preventDefault();
      select(selectable[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  function resultRow(item: ItemPickerItem) {
    const index = selectable.findIndex((candidate) => candidate.id === item.id);
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={item.id === value}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => select(item)}
        className={cn(
          'flex min-h-11 w-full items-center gap-2 rounded px-2 py-2 text-left text-sm',
          index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
      >
        <Check
          className={cn('size-4 shrink-0', item.id === value ? 'opacity-100' : 'opacity-0')}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{item.itemCode}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.name}</span>
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {ITEM_GROUP_LABEL[item.itemType]}
        </span>
      </button>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-left text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted-foreground')}>
          {selected ? `${selected.itemCode} — ${selected.name}` : placeholder}
        </span>
        {selected && allowClear && !disabled ? (
          <span
            role="button"
            aria-label="Clear selected item"
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              onValueChange('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                onValueChange('');
              }
            }}
            className="ml-2 rounded p-0.5 hover:bg-muted"
          >
            <X className="size-3.5" />
          </span>
        ) : (
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-md border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="flex items-center border-b px-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Search item code or name…"
              aria-label="Search items"
              className="h-10 w-full bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div id={listboxId} role="listbox" className="max-h-80 overflow-y-auto p-1">
            {selectable.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No matching items.
              </p>
            ) : (
              <>
                {recent.length > 0 && (
                  <section>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Recently used
                    </div>
                    {recent.map(resultRow)}
                  </section>
                )}
                {visibleGroups.map((group) => (
                  <section key={group.itemType}>
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </div>
                    {group.items.map(resultRow)}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
