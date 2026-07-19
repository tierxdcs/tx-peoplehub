'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '../../../lib/stores';
import { formatINR } from '../../../lib/sales';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
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

const STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CANCELLED',
];

/**
 * Purchase Order register (Stores). Company-wide read; "New PO" shows for
 * SUPER_ADMIN or MANAGER (the backend enforces SCM-vertical Manager+).
 */
export default function PurchaseOrdersPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('');

  const canCreate = user?.role === 'SUPER_ADMIN' || user?.role === 'MANAGER';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await listPurchaseOrders());
    } catch {
      setError('Failed to load purchase orders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? orders.filter((o) => o.status === statusFilter) : orders),
    [orders, statusFilter],
  );

  return (
    <PageContainer>
      <PageHeader
        title="Purchase Orders"
        description="Procurement orders to suppliers and vendors."
        action={
          canCreate ? (
            <Button onClick={() => router.push('/stores/purchase-orders/new')}>
              <Plus className="size-4" /> New PO
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Select
          className="w-56"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PurchaseOrderStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="p-6 text-sm text-destructive">{error}</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No purchase orders"
              description="Create a purchase order to start procurement."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO No.</TableHead>
                  <TableHead>Supplier / Vendor</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((po) => (
                  <TableRow
                    key={po.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/stores/purchase-orders/${po.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/stores/purchase-orders/${po.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {po.poNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {po.supplierName ?? po.vendorName ?? '—'}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({po.supplierId ? 'Supplier' : 'Vendor'})
                      </span>
                    </TableCell>
                    <TableCell>{dateOnlyStr(po.orderDate)}</TableCell>
                    <TableCell>
                      <StatusBadge value={po.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(po.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
