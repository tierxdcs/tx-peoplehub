'use client';

import { useCallback, useEffect, useState } from 'react';
import { Warehouse } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  listInventory,
  listStores,
  type StockBalance,
  type StoreLocation,
} from '../../../lib/scm-inventory';
import { ApiError } from '../../../lib/api';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Select } from '../../../components/ui/select';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { AdjustStockDialog } from './_components/adjust-stock-dialog';

/** Inventory / stock balances (§6). */
export default function InventoryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<StockBalance[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const canManage =
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'ADMIN' ||
    user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await listInventory({
          search: search.trim() || undefined,
          storeLocationId: storeFilter || undefined,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load inventory.');
    } finally {
      setLoading(false);
    }
  }, [search, storeFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listStores()
      .then(setStores)
      .catch(() => setStores([]));
  }, []);

  return (
    <PageContainer>
      <PageHeader
        title="Inventory"
        description="On-hand, reserved, blocked and available stock by store location."
        action={
          canManage ? (
            <Button onClick={() => setAdjusting(true)}>Adjust Stock</Button>
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
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          className="h-9 w-52"
        >
          <option value="">All locations</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Blocked</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Expected receipt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={Warehouse}
                      title="No stock records"
                      description="Stock balances appear here once items are received or adjusted."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.itemCode}</TableCell>
                    <TableCell>{r.itemName}</TableCell>
                    <TableCell>{r.storeLocationName}</TableCell>
                    <TableCell className="text-right">{r.onHandQuantity}</TableCell>
                    <TableCell className="text-right">{r.reservedQuantity}</TableCell>
                    <TableCell className="text-right">{r.blockedQuantity}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {r.availableQuantity}
                    </TableCell>
                    <TableCell>
                      {r.expectedReceiptQuantity
                        ? `${r.expectedReceiptQuantity}${
                            r.expectedReceiptDate
                              ? ' by ' +
                                new Date(r.expectedReceiptDate).toLocaleDateString()
                              : ''
                          }`
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {adjusting && (
        <AdjustStockDialog
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            void load();
          }}
        />
      )}
    </PageContainer>
  );
}
