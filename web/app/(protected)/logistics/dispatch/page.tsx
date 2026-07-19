'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Truck, Plus } from 'lucide-react';
import {
  listDeliveryChallans,
  TRANSPORT_MODE_LABEL,
  type DeliveryChallan,
  type DeliveryChallanStatus,
} from '../../../lib/logistics';
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

const STATUSES: DeliveryChallanStatus[] = [
  'DRAFT',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
];

/**
 * Dispatch Register — outbound Delivery Challans. Company-wide read; "New
 * Dispatch" shows for everyone (the backend gates create to Production/SA).
 */
export default function DispatchRegisterPage() {
  const router = useRouter();
  const [dcs, setDcs] = useState<DeliveryChallan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<DeliveryChallanStatus | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDcs(await listDeliveryChallans());
    } catch {
      setError('Failed to load the dispatch register.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(
    () => (statusFilter ? dcs.filter((d) => d.status === statusFilter) : dcs),
    [dcs, statusFilter],
  );

  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        title="Dispatch Register"
        description="Outbound delivery challans and their shipment status."
        action={
          <Button onClick={() => router.push('/logistics/dispatch/new')}>
            <Plus className="size-4" /> New Dispatch
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Select
          className="w-56"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DeliveryChallanStatus | '')}
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
              icon={Truck}
              title="No dispatches"
              description="Create a delivery challan to dispatch goods against an order."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>DC No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>E-Way Bill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((dc) => (
                  <TableRow
                    key={dc.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/logistics/dispatch/${dc.id}`)}
                  >
                    <TableCell className="font-medium">
                      <Link
                        href={`/logistics/dispatch/${dc.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {dc.dcNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{dateOnlyStr(dc.dispatchDate)}</TableCell>
                    <TableCell>{dc.orderNumber ?? '—'}</TableCell>
                    <TableCell>{dc.customerName ?? '—'}</TableCell>
                    <TableCell>{TRANSPORT_MODE_LABEL[dc.transportMode]}</TableCell>
                    <TableCell>
                      <StatusBadge value={dc.status} />
                    </TableCell>
                    <TableCell>
                      {dc.linkedInvoiceNumber ? (
                        <span className="text-xs">
                          {dc.linkedInvoiceNumber}{' '}
                          <StatusBadge value={dc.linkedInvoiceStatus} />
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {dc.eWayBillNumber ?? <span className="text-muted-foreground">—</span>}
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
