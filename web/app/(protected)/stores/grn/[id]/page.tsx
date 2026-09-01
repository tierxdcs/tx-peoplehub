'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ClipboardCheck,
  ClipboardList,
  FileWarning,
} from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useIsQcInspector } from '../../../../lib/use-is-qc-inspector';
import {
  getGrn,
  submitGrn,
  cancelGrn,
  type GoodsReceiptNote,
} from '../../../../lib/stores';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { Button } from '../../../../components/ui/button';
import { Skeleton } from '../../../../components/ui/skeleton';
import { StatusBadge } from '../../../../components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';
import { useConfirm } from '../../../../components/ui/confirm';
import { GrnFlowIndicator } from '../../_components/grn-flow-indicator';
import { PackingConditionBadge } from '../../_components/packing-condition-badge';

export default function GrnDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { isQcInspector } = useIsQcInspector();

  const [grn, setGrn] = useState<GoodsReceiptNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGrn(await getGrn(id));
    } catch {
      setError('Failed to load GRN.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit() {
    if (!grn) return;
    setActing(true);
    try {
      await submitGrn(grn.id);
      toast.success('Sent to QC inspection');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to submit');
    } finally {
      setActing(false);
    }
  }

  async function handleCancel() {
    if (!grn) return;
    if (!(await confirm({ title: 'Cancel GRN', description: `Cancel ${grn.grnNumber}? No stock was moved.`, confirmLabel: 'Cancel GRN', destructive: true }))) return;
    setActing(true);
    try {
      await cancelGrn(grn.id);
      toast.success('GRN cancelled');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setActing(false);
    }
  }

  if (loading) {
    return (
      <PageContainer>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (error || !grn) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/stores/grn')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link href="/stores/grn" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> GRN Register
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {grn.grnNumber}
            <StatusBadge value={grn.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Against PO{' '}
            <Link href={`/stores/purchase-orders/${grn.purchaseOrderId}`} className="text-primary hover:underline">
              {grn.poNumber}
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {grn.status === 'DRAFT' && (
            <>
              <Button onClick={handleSubmit} disabled={acting}>Send to QC Inspection</Button>
              <Button variant="destructive" onClick={handleCancel} disabled={acting}>Cancel</Button>
            </>
          )}
          {grn.status === 'PENDING_QC' && isQcInspector && (
            <Button onClick={() => router.push(`/stores/grn/${grn.id}/inspect`)}>
              <ClipboardCheck className="size-4" /> Inspect (QC)
            </Button>
          )}
        </div>
      </div>

      <GrnFlowIndicator status={grn.status} className="mb-6" />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Received Date" value={dateOnlyStr(grn.receivedDate)} />
        <Info label="Received By" value={grn.receivedByName ?? '—'} />
        <Info label="Inspected By" value={grn.inspectedByName ?? '—'} />
        <Info label="Inspected At" value={grn.inspectedAt ? dateOnlyStr(grn.inspectedAt) : '—'} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Logistics &amp; Receiving</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Info label="Delivery Challan No." value={grn.vendorDeliveryChallanNumber ?? '—'} />
          <Info
            label="Challan Date"
            value={grn.deliveryChallanDate ? dateOnlyStr(grn.deliveryChallanDate) : '—'}
          />
          <Info label="Vehicle / AWB No." value={grn.vehicleOrAwbNumber ?? '—'} />
          <Info label="Driver / Courier" value={grn.driverOrCourier ?? '—'} />
          <Info
            label="Total Packages"
            value={grn.totalPackagesReceived != null ? String(grn.totalPackagesReceived) : '—'}
          />
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Packing Condition
            </div>
            <div className="mt-0.5 text-sm font-medium">
              <PackingConditionBadge value={grn.packingCondition} />
            </div>
          </div>
          <Info label="Supervisor Sign-off" value={grn.supervisorSignOffName ?? '—'} />
          <Info label="Receiving Remarks" value={grn.notes ?? '—'} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Received Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Store</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Accepted</TableHead>
                <TableHead className="text-right">Rejected</TableHead>
                <TableHead>Inspection</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grn.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="font-medium">{line.itemName}</div>
                    <div className="text-xs text-muted-foreground">{line.itemCode}</div>
                  </TableCell>
                  <TableCell>{line.storeLocationName ?? '—'}</TableCell>
                  <TableCell className="text-right">{line.receivedQuantity} {line.unitOfMeasure}</TableCell>
                  <TableCell className="text-right">{line.acceptedQuantity ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    {Number(line.rejectedQuantity ?? 0) > 0 ? (
                      <span className="font-medium text-destructive">{line.rejectedQuantity}</span>
                    ) : (
                      line.rejectedQuantity ?? '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {line.inspection ? (
                      <Link
                        href={`/qms/inspections/${line.inspection.id}`}
                        className="inline-flex items-center gap-2 text-sm hover:underline"
                      >
                        {line.inspection.inspectionNumber}
                        <Badge
                          variant={
                            line.inspection.overallResult === 'PASS'
                              ? 'success'
                              : line.inspection.overallResult === 'FAIL'
                                ? 'destructive'
                                : 'warning'
                          }
                        >
                          {(line.inspection.overallResult ?? '—').replace(/_/g, ' ')}
                        </Badge>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* The checklist each line's decision was based on — the audit answer to
          "why was this accepted?". */}
      {grn.lines.some((l) => l.inspection) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="size-4 text-primary" />
              Incoming Inspection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {grn.lines
              .filter((l) => l.inspection)
              .map((line) => {
                const insp = line.inspection!;
                return (
                  <details key={line.id} className="rounded-lg border">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                      <span className="font-medium">{line.itemName}</span>
                      <span className="text-xs text-muted-foreground">
                        {insp.inspectionNumber}
                        {insp.templateCode
                          ? ` · ${insp.templateCode} v${insp.templateVersion ?? 1}`
                          : ''}
                        {insp.inspectedAt ? ` · ${dateOnlyStr(insp.inspectedAt)}` : ''}
                      </span>
                      <Badge
                        variant={
                          insp.overallResult === 'PASS'
                            ? 'success'
                            : insp.overallResult === 'FAIL'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {(insp.overallResult ?? '—').replace(/_/g, ' ')}
                      </Badge>
                    </summary>
                    <div className="divide-y border-t">
                      {insp.responses.map((r) => (
                        <div
                          key={r.questionKey}
                          className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <div>
                            <div>{r.prompt}</div>
                            {r.comments && (
                              <div className="text-xs text-muted-foreground">
                                {r.comments}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              {r.answer || '—'}
                            </span>
                            {r.result && r.result !== 'NOT_APPLICABLE' && (
                              <Badge
                                variant={r.result === 'PASS' ? 'success' : 'destructive'}
                              >
                                {r.result}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
          </CardContent>
        </Card>
      )}

      {grn.ncrs.length > 0 && (
        <Card className="mt-6 border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileWarning className="size-4 text-destructive" />
              Non-Conformance Reports
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NCR No.</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Rejected Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grn.ncrs.map((ncr) => (
                  <TableRow
                    key={ncr.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/stores/ncr/${ncr.id}`)}
                  >
                    <TableCell className="font-medium text-primary">{ncr.ncrNumber}</TableCell>
                    <TableCell>{ncr.itemName ?? ncr.itemCode}</TableCell>
                    <TableCell className="text-right">{ncr.rejectedQuantity}</TableCell>
                    <TableCell><StatusBadge value={ncr.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
