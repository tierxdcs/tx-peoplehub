'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import { useIsRndHead } from '../../../lib/use-is-rnd-head';
import {
  deactivateItem,
  ITEM_TYPE_LABEL,
  listItems,
  mergeItems,
  type Item,
  type ItemType,
} from '../../../lib/scm-item-master';
import { ApiError } from '../../../lib/api';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import { useToast } from '../../../components/ui/toaster';
import { useConfirm } from '../../../components/ui/confirm';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { ItemDialog } from './_components/item-dialog';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';

const TYPES: ItemType[] = [
  'RAW_MATERIAL',
  'COMPONENT',
  'SUBASSEMBLY',
  'FINISHED_GOOD',
  'CONSUMABLE',
];

/**
 * Item Master (§2). Read is broad (R&D + Store). "New Item" + edit are shown to
 * anyone here; the backend enforces R&D-Head-only for create/update and returns
 * 403 otherwise (surfaced as a toast).
 */
export default function ItemMasterPage() {
  const { user } = useAuth();
  const { isRndHead } = useIsRndHead();
  const { style: numberFormatStyle } = useNumberFormat();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ItemType | ''>('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);
  const [canonicalItemId, setCanonicalItemId] = useState('');
  const [duplicateItemId, setDuplicateItemId] = useState('');

  // R&D Head / SUPER_ADMIN can manage; the button shows for MANAGER+/SA and the
  // backend is the real gate.
  const canManage = user?.role === 'SUPER_ADMIN' || isRndHead;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listItems());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load items.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((i) => {
      if (typeFilter && i.itemType !== typeFilter) return false;
      if (!s) return true;
      return (
        i.itemCode.toLowerCase().includes(s) || i.name.toLowerCase().includes(s)
      );
    });
  }, [items, search, typeFilter]);
  const canSeeCost = items.some((item) =>
    Object.prototype.hasOwnProperty.call(item, 'currentCost'),
  );

  async function onDeactivate(item: Item) {
    if (
      !(await confirm({
        title: `Deactivate ${item.itemCode}?`,
        description:
          'The item stays in the system (BOMs/stock keep referencing it) but is marked inactive and cannot be added to new BOM lines.',
        confirmLabel: 'Deactivate',
        destructive: true,
      }))
    )
      return;
    try {
      await deactivateItem(item.id);
      toast.success('Item deactivated.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to deactivate.');
    }
  }

  async function onMerge() {
    if (!canonicalItemId || !duplicateItemId) return;
    const canonical = items.find((item) => item.id === canonicalItemId);
    const duplicate = items.find((item) => item.id === duplicateItemId);
    if (!(await confirm({
      title: `Merge ${duplicate?.itemCode} into ${canonical?.itemCode}?`,
      description: 'All BOM references will move to the canonical item and the duplicate will be deactivated. This cannot be undone automatically.',
      confirmLabel: 'Merge items',
      destructive: true,
    }))) return;
    try {
      const result = await mergeItems(canonicalItemId, duplicateItemId);
      toast.success(`Merged ${result.affectedBomLines} BOM reference(s).`);
      setCanonicalItemId('');
      setDuplicateItemId('');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to merge items.');
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Item Master"
        description="Raw materials, components, sub-assemblies and consumables referenced by BOMs and stock."
        action={
          canManage ? (
            <Button onClick={() => setCreating(true)}>+ New Item</Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-64"
        />
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ItemType | '')}
          className="h-9 w-52"
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ITEM_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </div>

      {canManage && (
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-sm font-medium">Canonical item (keep)</label>
              <Select value={canonicalItemId} onChange={(event) => setCanonicalItemId(event.target.value)}>
                <option value="">Select canonical item…</option>
                {items.filter((item) => item.isActive).map((item) => (
                  <option key={item.id} value={item.id}>{item.itemCode} — {item.name}</option>
                ))}
              </Select>
            </div>
            <div className="min-w-64 flex-1">
              <label className="mb-1 block text-sm font-medium">Duplicate item (deactivate)</label>
              <Select value={duplicateItemId} onChange={(event) => setDuplicateItemId(event.target.value)}>
                <option value="">Select duplicate item…</option>
                {items.filter((item) => item.isActive && item.id !== canonicalItemId).map((item) => (
                  <option key={item.id} value={item.id}>{item.itemCode} — {item.name}</option>
                ))}
              </Select>
            </div>
            <Button variant="destructive" disabled={!canonicalItemId || !duplicateItemId} onClick={() => void onMerge()}>
              Merge duplicate
            </Button>
          </CardContent>
        </Card>
      )}

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Wastage %</TableHead>
                {canSeeCost && <TableHead>Current Cost</TableHead>}
                <TableHead>Status</TableHead>
                {canManage && <TableHead>Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: (canManage ? 7 : 6) + (canSeeCost ? 1 : 0) }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={(canManage ? 7 : 6) + (canSeeCost ? 1 : 0)} className="p-0">
                    <EmptyState
                      icon={Boxes}
                      title="No items"
                      description={
                        canManage
                          ? 'Add an item to start building BOMs.'
                          : 'Items will appear here once R&D adds them.'
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.itemCode}</TableCell>
                    <TableCell>{i.name}</TableCell>
                    <TableCell>{ITEM_TYPE_LABEL[i.itemType]}</TableCell>
                    <TableCell>{i.baseUnitOfMeasure}</TableCell>
                    <TableCell>{i.defaultWastagePercent ?? '—'}</TableCell>
                    {canSeeCost && (
                      <TableCell>
                        {formatINR(i.currentCost, numberFormatStyle)}
                        {i.costSource && (
                          <span className="block text-xs text-muted-foreground">
                            {i.costSource === 'LATEST_ACCEPTED_GRN'
                              ? 'Latest accepted GRN'
                              : i.costSource === 'LATEST_AWARDED_QUOTE'
                                ? 'Latest awarded RFQ'
                                : 'Manual fallback'}
                          </span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={i.isActive ? 'success' : 'muted'}>
                        {i.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditing(i)}
                          >
                            Edit
                          </Button>
                          {i.isActive && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onDeactivate(i)}
                            >
                              Deactivate
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(creating || editing) && (
        <ItemDialog
          item={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}
