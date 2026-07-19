'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertTriangle, ShieldCheck, Truck } from 'lucide-react';
import { apiFetch, ApiError } from '../../../../lib/api';
import { useIsQcInspector } from '../../../../lib/use-is-qc-inspector';
import type { Order, PaginatedResult } from '../../../../lib/types';
import {
  createDeliveryChallan,
  dispatchDeliveryChallan,
  clearFinalQc,
  listDeliveryChallans,
  TRANSPORT_MODE_LABEL,
  DC_DOCUMENT_KEYS,
  type TransportMode,
  type DeliveryChallan,
} from '../../../../lib/logistics';
import { todayDateStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Badge } from '../../../../components/ui/badge';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../components/ui/table';
import { useToast } from '../../../../components/ui/toaster';

const TRANSPORT_MODES: TransportMode[] = ['ROAD', 'RAIL', 'AIR', 'SEA', 'COURIER'];

export default function NewDispatchPage() {
  const router = useRouter();
  const toast = useToast();
  const { isQcInspector } = useIsQcInspector();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [priorDcs, setPriorDcs] = useState<DeliveryChallan[]>([]);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [clearingQc, setClearingQc] = useState(false);

  const [dispatchDate, setDispatchDate] = useState(todayDateStr());
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [consigneeStateCode, setConsigneeStateCode] = useState('');
  const [transportMode, setTransportMode] = useState<TransportMode>('ROAD');
  const [transporterName, setTransporterName] = useState('');
  const [vehicleOrAwbNumber, setVehicleOrAwbNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [promisedDeliveryDate, setPromisedDeliveryDate] = useState('');
  const [specialDeliveryInstructions, setSpecialDeliveryInstructions] = useState('');
  const [docs, setDocs] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch<PaginatedResult<Order>>('/orders?page=1&limit=100');
        // Dispatchable: not cancelled, not fully dispatched.
        setOrders(
          res.items.filter(
            (o) => o.status !== 'CANCELLED' && o.fulfilmentStatus !== 'FULLY_DISPATCHED',
          ),
        );
      } catch {
        toast.error('Failed to load orders.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOrder = useCallback(
    async (id: string) => {
      if (!id) {
        setOrder(null);
        setPriorDcs([]);
        setQtys({});
        return;
      }
      try {
        const [ord, dcs] = await Promise.all([
          apiFetch<Order>(`/orders/${id}`),
          listDeliveryChallans({ orderId: id }),
        ]);
        setOrder(ord);
        setPriorDcs(dcs);
        setQtys(Object.fromEntries((ord.lineItems ?? []).map((l) => [l.id, ''])));
      } catch {
        toast.error('Failed to load order.');
      }
    },
    [toast],
  );

  useEffect(() => {
    if (orderId) void loadOrder(orderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // Previously dispatched per order line = sum across non-cancelled DCs.
  const prevByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dc of priorDcs) {
      if (dc.status === 'CANCELLED') continue;
      for (const l of dc.lines) {
        map[l.orderLineId] = (map[l.orderLineId] ?? 0) + Number(l.quantity);
      }
    }
    return map;
  }, [priorDcs]);

  function remaining(lineId: string, ordered: number): number {
    return ordered - (prevByLine[lineId] ?? 0);
  }

  const qcCleared = order?.finalQcStatus === 'CLEARED';
  const enteredLines = useMemo(
    () =>
      Object.entries(qtys)
        .filter(([, v]) => Number(v) > 0)
        .map(([orderLineId, v]) => ({ orderLineId, quantity: Number(v) })),
    [qtys],
  );
  const anyOver = useMemo(() => {
    if (!order?.lineItems) return false;
    return order.lineItems.some((l) => {
      const entered = Number(qtys[l.id] ?? 0);
      return entered > remaining(l.id, Number(l.quantity));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, qtys, prevByLine]);

  const canSubmit =
    !!order && enteredLines.length > 0 && consigneeName && consigneeAddress && consigneeStateCode && !submitting;

  async function handleClearQc() {
    if (!order) return;
    setClearingQc(true);
    try {
      await clearFinalQc(order.id);
      toast.success('Final QC cleared — this order can now be dispatched');
      await loadOrder(order.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to clear final QC');
    } finally {
      setClearingQc(false);
    }
  }

  async function handleSubmit(thenDispatch: boolean) {
    if (!order || !canSubmit) return;
    setSubmitting(true);
    try {
      const dc = await createDeliveryChallan({
        orderId: order.id,
        dispatchDate: new Date(dispatchDate).toISOString(),
        consigneeName,
        consigneeAddress,
        consigneeGstin: consigneeGstin || undefined,
        consigneeStateCode,
        transportMode,
        transporterName: transporterName || undefined,
        vehicleOrAwbNumber: vehicleOrAwbNumber || undefined,
        driverName: driverName || undefined,
        driverPhone: driverPhone || undefined,
        promisedDeliveryDate: promisedDeliveryDate
          ? new Date(promisedDeliveryDate).toISOString()
          : undefined,
        specialDeliveryInstructions: specialDeliveryInstructions || undefined,
        documentsIncluded: docs,
        lines: enteredLines,
      });
      if (thenDispatch) {
        await dispatchDeliveryChallan(dc.id);
        toast.success(`${dc.dcNumber} dispatched — stock issued and a draft invoice created`);
      } else {
        toast.success(`${dc.dcNumber} saved as draft`);
      }
      router.push(`/logistics/dispatch/${dc.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create dispatch');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-4">
        <Link href="/logistics/dispatch" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Dispatch Register
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New Dispatch</h1>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Order" htmlFor="order" required>
                <Select id="order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
                  <option value="">Select an order…</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber}
                    </option>
                  ))}
                </Select>
              </Field>

              {order && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-muted-foreground">Final QC:</span>
                  <StatusBadge value={order.finalQcStatus ?? 'PENDING'} />
                  {order.fulfilmentStatus && (
                    <>
                      <span className="text-muted-foreground">Fulfilment:</span>
                      <StatusBadge value={order.fulfilmentStatus} />
                    </>
                  )}
                </div>
              )}

              {order && !qcCleared && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="flex-1">
                    <p className="font-medium">Final QC not cleared.</p>
                    <p className="text-muted-foreground">
                      Dispatch is blocked until the order&apos;s finished goods pass final QC.
                      {isQcInspector
                        ? ' As a QC inspector, you can clear it below.'
                        : ' A QC inspector must clear it.'}
                    </p>
                    {isQcInspector && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={handleClearQc}
                        disabled={clearingQc}
                      >
                        Clear Final QC
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {order && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Line Items</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Ordered</TableHead>
                        <TableHead className="text-right">Prev. Dispatched</TableHead>
                        <TableHead className="text-right">Remaining</TableHead>
                        <TableHead className="w-32 text-right">Dispatch Now</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(order.lineItems ?? []).map((l) => {
                        const ordered = Number(l.quantity);
                        const prev = prevByLine[l.id] ?? 0;
                        const rem = ordered - prev;
                        const entered = Number(qtys[l.id] ?? 0);
                        const over = entered > rem;
                        return (
                          <TableRow key={l.id}>
                            <TableCell>
                              <div className="font-medium">{l.productName}</div>
                              <div className="text-xs text-muted-foreground">{l.productSku}</div>
                            </TableCell>
                            <TableCell className="text-right">{l.quantity}</TableCell>
                            <TableCell className="text-right">{prev}</TableCell>
                            <TableCell className="text-right">{rem}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                className="text-right"
                                value={qtys[l.id] ?? ''}
                                onChange={(e) => setQtys((p) => ({ ...p, [l.id]: e.target.value }))}
                                aria-invalid={over ? true : undefined}
                              />
                              {over && (
                                <div className="mt-1 flex items-center justify-end gap-1 text-xs text-warning">
                                  <AlertTriangle className="size-3" /> Over remaining
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {anyOver && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>
                    One or more lines exceed the remaining ordered quantity. Over-dispatch is
                    allowed (reality differs from paperwork), but confirm before dispatching.
                  </p>
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Consignee &amp; Transport</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Field label="Consignee Name" htmlFor="cn" required>
                    <Input id="cn" value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} />
                  </Field>
                  <Field label="Consignee GSTIN" htmlFor="cg">
                    <Input id="cg" value={consigneeGstin} onChange={(e) => setConsigneeGstin(e.target.value)} />
                  </Field>
                  <Field label="Consignee Address" htmlFor="ca" required className="md:col-span-2">
                    <Textarea id="ca" value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
                  </Field>
                  <Field label="Place of Supply — State Code" htmlFor="sc" required hint="Drives GST on the seeded invoice">
                    <Input id="sc" value={consigneeStateCode} onChange={(e) => setConsigneeStateCode(e.target.value)} placeholder="e.g. 29" />
                  </Field>
                  <Field label="Transport Mode" htmlFor="tm">
                    <Select id="tm" value={transportMode} onChange={(e) => setTransportMode(e.target.value as TransportMode)}>
                      {TRANSPORT_MODES.map((m) => (
                        <option key={m} value={m}>{TRANSPORT_MODE_LABEL[m]}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Transporter" htmlFor="tn">
                    <Input id="tn" value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />
                  </Field>
                  <Field label="Vehicle / AWB No." htmlFor="vn">
                    <Input id="vn" value={vehicleOrAwbNumber} onChange={(e) => setVehicleOrAwbNumber(e.target.value)} />
                  </Field>
                  <Field label="Driver Name" htmlFor="dn">
                    <Input id="dn" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                  </Field>
                  <Field label="Driver Phone" htmlFor="dp">
                    <Input id="dp" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
                  </Field>
                  <Field label="Promised Delivery Date" htmlFor="pd" hint="Captured for OTD tracking">
                    <Input id="pd" type="date" value={promisedDeliveryDate} onChange={(e) => setPromisedDeliveryDate(e.target.value)} />
                  </Field>
                  <Field label="Dispatch Date" htmlFor="dd">
                    <Input id="dd" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
                  </Field>
                  <Field label="Special Delivery Instructions" htmlFor="si" className="md:col-span-2">
                    <Textarea id="si" value={specialDeliveryInstructions} onChange={(e) => setSpecialDeliveryInstructions(e.target.value)} />
                  </Field>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Documents Included</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 md:grid-cols-2">
                  {DC_DOCUMENT_KEYS.map((d) => (
                    <label key={d.key} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!docs[d.key]}
                        onCheckedChange={(v) => setDocs((p) => ({ ...p, [d.key]: v === true }))}
                      />
                      {d.label}
                    </label>
                  ))}
                </CardContent>
              </Card>

              <div className="flex items-center justify-end gap-2">
                {!qcCleared && (
                  <Badge variant="warning" className="mr-auto">
                    Dispatch disabled until final QC cleared
                  </Badge>
                )}
                <Button variant="outline" onClick={() => handleSubmit(false)} disabled={!canSubmit}>
                  Save Draft
                </Button>
                <Button onClick={() => handleSubmit(true)} disabled={!canSubmit || !qcCleared}>
                  <Truck className="size-4" /> Create &amp; Dispatch
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </PageContainer>
  );
}
