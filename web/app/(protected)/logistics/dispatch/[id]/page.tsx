'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Truck, FileText, Upload } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  getDeliveryChallan,
  dispatchDeliveryChallan,
  cancelDeliveryChallan,
  setEwayBill,
  updateDcStatus,
  podUploadUrl,
  confirmPod,
  TRANSPORT_MODE_LABEL,
  type DeliveryChallan,
} from '../../../../lib/logistics';
import { dateOnlyStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
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

export default function DispatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const [dc, setDc] = useState<DeliveryChallan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  // E-way bill form
  const [ewb, setEwb] = useState('');
  const [ewbDate, setEwbDate] = useState('');
  const [ewbValid, setEwbValid] = useState('');
  // POD form
  const [podReceivedBy, setPodReceivedBy] = useState('');
  const [podNotes, setPodNotes] = useState('');
  const [podFile, setPodFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDeliveryChallan(id);
      setDc(data);
      setEwb(data.eWayBillNumber ?? '');
    } catch {
      setError('Failed to load delivery challan.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setActing(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  async function handleDispatch() {
    if (!dc) return;
    if (!(await confirm({ title: 'Dispatch', description: `Dispatch ${dc.dcNumber}? This issues stock and creates a draft invoice.`, confirmLabel: 'Dispatch' }))) return;
    await act(() => dispatchDeliveryChallan(dc.id), 'Dispatched — stock issued, draft invoice created');
  }

  async function handlePodUpload() {
    if (!dc || !podFile) return;
    setActing(true);
    try {
      const signed = await podUploadUrl(dc.id, podFile.name, podFile.type || 'application/octet-stream');
      const put = await fetch(signed.uploadUrl, { method: 'PUT', body: podFile, headers: { 'Content-Type': podFile.type || 'application/octet-stream' } });
      if (!put.ok) throw new ApiError('Upload to storage failed', put.status);
      await confirmPod(dc.id, {
        storageKey: signed.storageKey,
        fileName: podFile.name,
        sizeBytes: podFile.size,
        podReceivedBy: podReceivedBy || undefined,
        podNotes: podNotes || undefined,
      });
      toast.success('Proof of delivery recorded — marked DELIVERED');
      setPodFile(null);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to record POD');
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
  if (error || !dc) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">{error ?? 'Not found.'}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/logistics/dispatch')}>
          <ArrowLeft className="size-4" /> Back
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-4">
        <Link href="/logistics/dispatch" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Dispatch Register
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            {dc.dcNumber}
            <StatusBadge value={dc.status} />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Order {dc.orderNumber} · {dc.customerName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dc.status === 'DRAFT' && (
            <>
              <Button onClick={handleDispatch} disabled={acting}>
                <Truck className="size-4" /> Dispatch
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  act(() => cancelDeliveryChallan(dc.id), 'Cancelled')
                }
                disabled={acting}
              >
                Cancel
              </Button>
            </>
          )}
          {dc.status === 'DISPATCHED' && (
            <Button variant="outline" onClick={() => act(() => updateDcStatus(dc.id, 'IN_TRANSIT'), 'Marked in transit')} disabled={acting}>
              Mark In Transit
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Info label="Dispatch Date" value={dateOnlyStr(dc.dispatchDate)} />
        <Info label="Transport" value={`${TRANSPORT_MODE_LABEL[dc.transportMode]}${dc.vehicleOrAwbNumber ? ` · ${dc.vehicleOrAwbNumber}` : ''}`} />
        <Info label="Consignee" value={dc.consigneeName} />
        <Info label="Place of Supply" value={dc.consigneeStateCode} />
        <Info label="Promised Delivery" value={dc.promisedDeliveryDate ? dateOnlyStr(dc.promisedDeliveryDate) : '—'} />
        <Info label="Actual Delivery" value={dc.actualDeliveryDate ? dateOnlyStr(dc.actualDeliveryDate) : '—'} />
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Linked Invoice</div>
          <div className="mt-0.5 text-sm font-medium">
            {dc.linkedInvoiceNumber ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3.5" /> {dc.linkedInvoiceNumber}{' '}
                <StatusBadge value={dc.linkedInvoiceStatus} />
              </span>
            ) : (
              '—'
            )}
          </div>
        </div>
        <Info label="Created By" value={dc.createdByName ?? '—'} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Dispatched Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="text-right">Prev. Dispatched</TableHead>
                <TableHead className="text-right">This DC</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dc.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium">{l.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.itemCode}{l.hsnCode ? ` · HSN ${l.hsnCode}` : ''}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{l.orderedQuantity}</TableCell>
                  <TableCell className="text-right">{l.previouslyDispatched}</TableCell>
                  <TableCell className="text-right font-medium">{l.quantity} {l.unitOfMeasure}</TableCell>
                  <TableCell className="text-right">{l.unitRate}</TableCell>
                  <TableCell className="text-right">{l.lineValue}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* E-way bill — only after dispatch */}
      {dc.status !== 'DRAFT' && dc.status !== 'CANCELLED' && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">E-Way Bill</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <Field label="E-Way Bill No." htmlFor="ewb">
              <Input id="ewb" value={ewb} onChange={(e) => setEwb(e.target.value)} />
            </Field>
            <Field label="Date" htmlFor="ewbd">
              <Input id="ewbd" type="date" value={ewbDate} onChange={(e) => setEwbDate(e.target.value)} />
            </Field>
            <Field label="Valid Until" htmlFor="ewbv">
              <Input id="ewbv" type="date" value={ewbValid} onChange={(e) => setEwbValid(e.target.value)} />
            </Field>
            <div className="md:col-span-3">
              <Button
                variant="outline"
                disabled={acting || !ewb}
                onClick={() =>
                  act(
                    () =>
                      setEwayBill(dc.id, {
                        eWayBillNumber: ewb,
                        eWayBillDate: ewbDate ? new Date(ewbDate).toISOString() : undefined,
                        eWayBillValidUntil: ewbValid ? new Date(ewbValid).toISOString() : undefined,
                      }),
                    'E-way bill saved',
                  )
                }
              >
                Save E-Way Bill
              </Button>
              {dc.eWayBillValidUntil && (
                <span className="ml-3 text-xs text-muted-foreground">
                  Valid until {dateOnlyStr(dc.eWayBillValidUntil)}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* POD — capture on delivery */}
      {(dc.status === 'DISPATCHED' || dc.status === 'IN_TRANSIT' || dc.status === 'DELIVERED') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proof of Delivery</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dc.podFileKey ? (
              <div className="text-sm">
                <p className="font-medium text-success">POD on file.</p>
                <p className="text-muted-foreground">
                  Received by {dc.podReceivedBy ?? '—'}
                  {dc.actualDeliveryDate ? ` on ${dateOnlyStr(dc.actualDeliveryDate)}` : ''}.
                </p>
                {dc.podNotes && <p className="mt-1 text-muted-foreground">{dc.podNotes}</p>}
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Received By" htmlFor="prb">
                    <Input id="prb" value={podReceivedBy} onChange={(e) => setPodReceivedBy(e.target.value)} />
                  </Field>
                  <Field label="POD Document" htmlFor="pf">
                    <Input id="pf" type="file" onChange={(e) => setPodFile(e.target.files?.[0] ?? null)} />
                  </Field>
                  <Field label="Notes" htmlFor="pn" className="md:col-span-2">
                    <Textarea id="pn" value={podNotes} onChange={(e) => setPodNotes(e.target.value)} />
                  </Field>
                </div>
                <Button onClick={handlePodUpload} disabled={acting || !podFile}>
                  <Upload className="size-4" /> Upload POD &amp; Mark Delivered
                </Button>
              </>
            )}
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
