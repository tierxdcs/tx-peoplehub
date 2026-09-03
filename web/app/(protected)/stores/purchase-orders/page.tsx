'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../../lib/auth-context';
import {
  listPurchaseOrders,
  deletePurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderStatus,
} from '../../../lib/stores';
import { formatINR } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import { dateOnlyStr } from '../../../lib/date';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { StatusBadge } from '../../../components/ui/status-badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { useRegisterList } from '../../../lib/use-register-list';
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

const STATUSES: PurchaseOrderStatus[] = [
  'DRAFT',
  'PENDING_CSCO_APPROVAL',
  'PENDING_COO_APPROVAL',
  'PENDING_CEO_APPROVAL',
  'APPROVED',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'REJECTED',
  'CANCELLED',
];

/**
 * Purchase Order register (Stores). Company-wide read; "New PO" shows for
 * SUPER_ADMIN or MANAGER (the backend enforces SCM-vertical Manager+).
 */
export default function PurchaseOrdersPage() {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const { style: numberFormatStyle } = useNumberFormat();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>(
    '',
  );

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
    () =>
      statusFilter ? orders.filter((o) => o.status === statusFilter) : orders,
    [orders, statusFilter],
  );
  const register = useRegisterList(
    filtered,
    (po) =>
      `${po.poNumber} ${po.status} ${po.supplierName ?? ''} ${po.vendorName ?? ''} ${po.adHocPartyName ?? ''}`,
  );

  async function remove(po: PurchaseOrder) {
    const accepted = await confirm({
      title: 'Delete purchase order?',
      description: `Permanently delete ${po.poNumber}? This cannot be undone.`,
      confirmLabel: 'Delete PO',
      destructive: true,
    });
    if (!accepted) return;
    try {
      await deletePurchaseOrder(po.id);
      toast.success(`${po.poNumber} deleted`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to delete purchase order',
      );
    }
  }

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

      <RegisterToolbar
        title="Purchase Order Register"
        search={register.search}
        onSearchChange={register.setSearch}
        searchPlaceholder="Search PO, supplier/vendor or status"
        filters={
          <Select
            className="w-56"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as PurchaseOrderStatus | '')
            }
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        }
      />

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
          ) : register.visibleItems.length === 0 ? (
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
                  <TableHead>Supplier / Vendor / Ad-hoc Party</TableHead>
                  <TableHead>Order Date</TableHead>
                  <TableHead>Status</TableHead>
                  {/* Pre-tax on purpose: this is the figure the approval tiers
                      above key off. The GST-inclusive total is on the PO itself. */}
                  <TableHead className="text-right">Taxable Value</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {register.visibleItems.map((po) => (
                  <TableRow
                    key={po.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/stores/purchase-orders/${po.id}`)
                    }
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
                      {po.supplierName ??
                        po.vendorName ??
                        po.adHocPartyName ??
                        '—'}
                      <span className="ml-1 text-xs text-muted-foreground">
                        (
                        {po.supplierId
                          ? 'Supplier'
                          : po.vendorId
                            ? 'Vendor'
                            : 'Ad-hoc'}
                        )
                      </span>
                    </TableCell>
                    <TableCell>{dateOnlyStr(po.orderDate)}</TableCell>
                    <TableCell>
                      <StatusBadge value={po.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(po.totalAmount, numberFormatStyle)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {canCreate && po.status === 'DRAFT' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(event) => {
                              event.stopPropagation();
                              router.push(
                                `/stores/purchase-orders/new?edit=${po.id}`,
                              );
                            }}
                          >
                            Edit
                          </Button>
                        )}
                        {po.canDelete && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              void remove(po);
                            }}
                          >
                            <Trash2 className="size-4" /> Delete
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <RegisterPagination
        page={register.page}
        pageCount={register.pageCount}
        onPageChange={register.setPage}
        disabled={loading}
      />
    </PageContainer>
  );
}
