'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Order, OrderStatus, OrderType, PaginatedResult } from '../../../lib/types';
import { apiFetch } from '../../../lib/api';
import { formatINR, prettyEnum } from '../../../lib/sales';
import { useNumberFormat } from '../../../lib/number-format-context';
import {
  SCard,
  SignalHeader,
  SignalPage,
  StatStrip,
  StatTile,
} from '../../../components/ui/signal';
import { Badge } from '../../../components/ui/badge';
import { StatusBadge } from '../../../components/ui/status-badge';
import { Button } from '../../../components/ui/button';
import { Select } from '../../../components/ui/select';
import { RegisterToolbar } from '../../../components/ui/register-toolbar';
import { RegisterPagination } from '../../../components/ui/register-pagination';
import { Skeleton } from '../../../components/ui/skeleton';
import { BusinessUnitLabel } from '../../../components/ui/business-unit-label';
import { useBusinessUnitOptions } from '../../../lib/business-units';
import { useCanManageInternalOrders } from '../../../lib/use-can-manage-internal-orders';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';

const STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'IN_PRODUCTION',
  'READY_TO_SHIP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
];
const PAGE_SIZE = 20;

export default function OrdersPage() {
  const router = useRouter();
  const { style: numberFormatStyle } = useNumberFormat();
  const [orders, setOrders] = useState<Order[]>([]);
  const [summaryRows, setSummaryRows] = useState<Order[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | OrderType>('');
  const [businessUnitFilter, setBusinessUnitFilter] = useState('');
  const { businessUnits } = useBusinessUnitOptions();
  const { canManage } = useCanManageInternalOrders();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<PaginatedResult<Order>>(
        `/orders?page=${page}&limit=${PAGE_SIZE}`,
      );
      setOrders(result.items);
      setTotal(result.total);

      // KPI cards represent the complete normal-sized register and therefore
      // remain stable as the user pages through orders.
      if (page === 1 && result.total <= result.items.length) {
        setSummaryRows(result.items);
      } else {
        const summary = await apiFetch<PaginatedResult<Order>>(
          '/orders?page=1&limit=100',
        );
        setSummaryRows(summary.items);
      }
    } catch {
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(
      (order) =>
        (!statusFilter || order.status === statusFilter) &&
        (!typeFilter || order.orderType === typeFilter) &&
        (!businessUnitFilter || order.businessUnitId === businessUnitFilter) &&
        (!q ||
          `${order.orderNumber} ${order.ownerName} ${order.customerName ?? ''}`
            .toLowerCase()
            .includes(q)),
    );
  }, [orders, search, statusFilter, typeFilter, businessUnitFilter]);

  const summary = useMemo(() => {
    // Booked Value and the operational KPI cards cover committed customer
    // orders only — internal orders carry no pricing and no commitment.
    const active = summaryRows.filter(
      (order) => order.status !== 'CANCELLED' && order.orderType !== 'INTERNAL',
    );
    return {
      confirmed: active.filter((order) => order.status === 'CONFIRMED').length,
      inProduction: active.filter((order) => order.status === 'IN_PRODUCTION')
        .length,
      readyOrShipping: active.filter(
        (order) =>
          order.status === 'READY_TO_SHIP' || order.status === 'SHIPPED',
      ).length,
      bookedValue: active.reduce(
        (sum, order) => sum + Number(order.totalAmount),
        0,
      ),
    };
  }, [summaryRows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <SignalPage>
      <SignalHeader
        title="Orders"
        description="Sales order register — follow confirmed work through production, shipment and delivery."
        actions={
          canManage ? (
            <Button onClick={() => router.push('/sales/orders/new')}>
              New Internal Order
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 px-5 pb-7 pt-[18px] lg:px-7">

      <StatStrip>
        <StatTile label="Confirmed" value={summary.confirmed} />
        <StatTile label="In Production" value={summary.inProduction} />
        <StatTile label="Ready / Shipping" value={summary.readyOrShipping} />
        <StatTile
          label="Booked Value"
          value={formatINR(summary.bookedValue, numberFormatStyle)}
        />
      </StatStrip>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <RegisterToolbar
        title="Order Register"
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search order # or owner"
      >
        <Select
          aria-label="Status"
          className="w-full sm:w-44"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {prettyEnum(status)}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Order type"
          className="w-full sm:w-40"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value as '' | OrderType);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          <option value="CUSTOMER">Customer</option>
          <option value="INTERNAL">Internal</option>
        </Select>
        <Select
          aria-label="Business unit"
          className="w-full sm:w-52"
          value={businessUnitFilter}
          onChange={(event) => setBusinessUnitFilter(event.target.value)}
        >
          <option value="">All business units</option>
          {businessUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </Select>
      </RegisterToolbar>

      <SCard className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Business Unit</TableHead>
                <TableHead>Fulfilment</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, row) => (
                  <TableRow key={row}>
                    {Array.from({ length: 9 }).map((__, column) => (
                      <TableCell key={column}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {statusFilter
                      ? `No ${prettyEnum(statusFilter).toLowerCase()} orders on this page.`
                      : 'No orders yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="hover:text-primary hover:underline"
                          onClick={() =>
                            router.push(`/sales/orders/${order.id}`)
                          }
                        >
                          {order.orderNumber}
                        </button>
                        {order.orderType === 'INTERNAL' && (
                          <Badge variant="muted">Internal</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {order.customerName ??
                        (order.orderType === 'INTERNAL' ? 'Internal' : '—')}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={order.status} />
                    </TableCell>
                    <TableCell>
                      <BusinessUnitLabel
                        name={order.businessUnitName}
                        colorHex={order.businessUnitColorHex}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={order.fulfilmentStatus ?? 'NOT_DISPATCHED'}
                      />
                    </TableCell>
                    <TableCell>
                      {formatINR(order.totalAmount, numberFormatStyle)}
                    </TableCell>
                    <TableCell>{order.ownerName}</TableCell>
                    <TableCell>
                      {new Date(order.createdAt).toLocaleDateString('en-IN')}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/sales/orders/${order.id}`)}
                      >
                        View Order
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
      </SCard>

      <RegisterPagination
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        disabled={loading}
      />
      </div>
    </SignalPage>
  );
}
