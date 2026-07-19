'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PackageCheck, Plus, Check } from 'lucide-react';
import {
  listGrns,
  isGrnFinalized,
  type GoodsReceiptNote,
  type GoodsReceiptNoteStatus,
} from '../../../lib/stores';
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
import { PackingConditionBadge } from '../_components/packing-condition-badge';

const STATUSES: GoodsReceiptNoteStatus[] = [
  'DRAFT',
  'PENDING_QC',
  'QC_PASSED',
  'QC_PARTIAL',
  'QC_FAILED',
  'CANCELLED',
];

/** The context-sensitive next action for a GRN row. */
function grnAction(grn: GoodsReceiptNote): { label: string; href: string } | null {
  switch (grn.status) {
    case 'DRAFT':
      return { label: 'Open', href: `/stores/grn/${grn.id}` };
    case 'PENDING_QC':
      return { label: 'Send to QC', href: `/stores/grn/${grn.id}/inspect` };
    case 'QC_PARTIAL':
    case 'QC_FAILED':
      return { label: 'View NCR', href: `/stores/ncr?grnId=${grn.id}` };
    case 'QC_PASSED':
      return { label: 'Done', href: `/stores/grn/${grn.id}` };
    default:
      return null;
  }
}

/**
 * GRN Register (Stores) — one row per received material line, matching the
 * reference register: GRN No, date, PO ref, material, PO qty, received,
 * IQC status, accepted, rejected, stock-updated, and a context-sensitive action.
 */
export default function GrnRegisterPage() {
  const router = useRouter();
  const [grns, setGrns] = useState<GoodsReceiptNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GoodsReceiptNoteStatus | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrns(await listGrns());
    } catch {
      setError('Failed to load GRN register.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Flatten to one row per (GRN, line), like the reference register.
  const rows = useMemo(() => {
    const filtered = statusFilter ? grns.filter((g) => g.status === statusFilter) : grns;
    return filtered.flatMap((grn) =>
      grn.lines.map((line) => ({ grn, line })),
    );
  }, [grns, statusFilter]);

  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        title="GRN Register"
        description="Goods receipts and their incoming-QC (IQC) status."
        action={
          <Button onClick={() => router.push('/stores/grn/new')}>
            <Plus className="size-4" /> New GRN
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Select
          className="w-56"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as GoodsReceiptNoteStatus | '')}
        >
          <option value="">All IQC statuses</option>
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
          ) : rows.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="No goods receipts"
              description="Create a GRN to record incoming material against a purchase order."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GRN No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>PO Ref</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="text-right">PO Qty</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead>IQC</TableHead>
                  <TableHead>Packing</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ grn, line }) => {
                  const action = grnAction(grn);
                  const finalized = isGrnFinalized(grn.status);
                  const stockUpdated = finalized && Number(line.acceptedQuantity ?? 0) > 0;
                  return (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/stores/grn/${grn.id}`}
                          className="text-primary hover:underline"
                        >
                          {grn.grnNumber}
                        </Link>
                      </TableCell>
                      <TableCell>{dateOnlyStr(grn.receivedDate)}</TableCell>
                      <TableCell>
                        <Link
                          href={`/stores/purchase-orders/${grn.purchaseOrderId}`}
                          className="text-primary hover:underline"
                        >
                          {grn.poNumber ?? '—'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{line.itemName}</div>
                        <div className="text-xs text-muted-foreground">{line.itemCode}</div>
                      </TableCell>
                      <TableCell className="text-right">{line.orderedQuantity}</TableCell>
                      <TableCell className="text-right">{line.receivedQuantity}</TableCell>
                      <TableCell>
                        <StatusBadge value={grn.status} />
                      </TableCell>
                      <TableCell>
                        <PackingConditionBadge value={grn.packingCondition} />
                      </TableCell>
                      <TableCell className="text-right">
                        {finalized ? (line.acceptedQuantity ?? '0') : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {finalized ? (
                          Number(line.rejectedQuantity ?? 0) > 0 ? (
                            <span className="font-medium text-destructive">
                              {line.rejectedQuantity}
                            </span>
                          ) : (
                            '0'
                          )
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        {stockUpdated ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <Check className="size-3.5" /> Updated
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {action && (
                          <Link
                            href={action.href}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {action.label}
                          </Link>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
