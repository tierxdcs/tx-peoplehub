'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Send } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth-context';
import {
  listPurchaseOrders,
  getPurchaseOrder,
  listGrns,
  createGrn,
  submitGrn,
  searchEmployees,
  isGrnFinalized,
  PACKING_CONDITION_LABEL,
  type PurchaseOrder,
  type GoodsReceiptNote,
  type PackingCondition,
  type EmployeeSearchResult,
} from '../../../../lib/stores';
import { listStores, type StoreLocation } from '../../../../lib/scm-inventory';
import { todayDateStr } from '../../../../lib/date';
import { PageContainer } from '../../../../components/ui/page-container';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Field } from '../../../../components/ui/field';
import { Textarea } from '../../../../components/ui/textarea';
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
import { GrnFlowIndicator } from '../../_components/grn-flow-indicator';

interface LineDraft {
  poLineId: string;
  storeLocationId: string;
  quantity: string;
}

/**
 * GRN Entry form (Stores) — mirrors the reference form: auto GRN number (shown
 * post-create), received-by, PO reference (auto-fills supplier/vendor), logistics
 * (challan, vehicle/AWB, driver), items-received table with computed
 * previously-received + inline over-receipt warning, packing/remarks, sign-off.
 * Primary action is "Send to QC Inspection" (create + submit). Creating a GRN
 * moves ZERO stock — the flow indicator makes the pipeline explicit.
 */
export default function NewGrnPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { user } = useAuth();
  const presetPoId = searchParams.get('poId') ?? '';

  const [issuedPos, setIssuedPos] = useState<PurchaseOrder[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const [poId, setPoId] = useState(presetPoId);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [priorGrns, setPriorGrns] = useState<GoodsReceiptNote[]>([]);
  const [receivedDate, setReceivedDate] = useState(todayDateStr());
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [submitting, setSubmitting] = useState(false);

  // Logistics + sign-off — bound to dedicated GRN columns (spec §3.1), NOT
  // stuffed into notes. `notes` is now purely free-text receiving remarks.
  const [challanNo, setChallanNo] = useState('');
  const [challanDate, setChallanDate] = useState('');
  const [vehicleAwb, setVehicleAwb] = useState('');
  const [driverCourier, setDriverCourier] = useState('');
  const [totalPackages, setTotalPackages] = useState('');
  const [packingCondition, setPackingCondition] = useState<PackingCondition | ''>('');
  const [remarks, setRemarks] = useState('');
  // Supervisor sign-off — an Employee FK, chosen via type-ahead search.
  const [supervisorQuery, setSupervisorQuery] = useState('');
  const [supervisorResults, setSupervisorResults] = useState<EmployeeSearchResult[]>([]);
  const [supervisor, setSupervisor] = useState<EmployeeSearchResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [pos, st] = await Promise.all([listPurchaseOrders(), listStores()]);
        // Only ISSUED / PARTIALLY_RECEIVED POs can receive goods.
        setIssuedPos(
          pos.filter((p) => p.status === 'ISSUED' || p.status === 'PARTIALLY_RECEIVED'),
        );
        setStores(st);
      } catch {
        toast.error('Failed to load form data.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultStoreId = stores[0]?.id ?? '';

  // Load the selected PO + its prior GRNs (for computed previously-received).
  const loadPo = useCallback(
    async (id: string) => {
      if (!id) {
        setPo(null);
        setPriorGrns([]);
        setLines({});
        return;
      }
      try {
        const [poData, grns] = await Promise.all([
          getPurchaseOrder(id),
          listGrns({ purchaseOrderId: id }),
        ]);
        setPo(poData);
        setPriorGrns(grns);
        const seed: Record<string, LineDraft> = {};
        for (const l of poData.lines) {
          seed[l.id] = { poLineId: l.id, storeLocationId: defaultStoreId, quantity: '' };
        }
        setLines(seed);
      } catch {
        toast.error('Failed to load purchase order.');
      }
    },
    [defaultStoreId, toast],
  );

  useEffect(() => {
    if (poId) void loadPo(poId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poId, defaultStoreId]);

  // Computed previously-received (accepted) per PO line, from finalized GRNs.
  const prevReceivedByLine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const grn of priorGrns) {
      if (!isGrnFinalized(grn.status)) continue;
      for (const line of grn.lines) {
        map[line.purchaseOrderLineId] =
          (map[line.purchaseOrderLineId] ?? 0) + Number(line.acceptedQuantity ?? 0);
      }
    }
    return map;
  }, [priorGrns]);

  function updateLine(poLineId: string, patch: Partial<LineDraft>) {
    setLines((prev) => ({ ...prev, [poLineId]: { ...prev[poLineId], ...patch } }));
  }

  const enteredLines = useMemo(
    () => Object.values(lines).filter((l) => Number(l.quantity) > 0),
    [lines],
  );

  // Over-receipt: entered + previously-received exceeds ordered for a line.
  function overReceipt(poLineId: string): { over: boolean; remaining: number } | null {
    const poLine = po?.lines.find((l) => l.id === poLineId);
    if (!poLine) return null;
    const ordered = Number(poLine.orderedQuantity);
    const prev = prevReceivedByLine[poLineId] ?? 0;
    const entered = Number(lines[poLineId]?.quantity ?? 0);
    const remaining = ordered - prev;
    return { over: entered > remaining, remaining };
  }

  const anyOverReceipt = po?.lines.some((l) => overReceipt(l.id)?.over) ?? false;
  const canSubmit = !!po && enteredLines.length > 0 && !submitting;

  // Debounced supervisor type-ahead.
  useEffect(() => {
    if (supervisor || supervisorQuery.trim().length < 2) {
      setSupervisorResults([]);
      return;
    }
    const t = setTimeout(() => {
      void searchEmployees(supervisorQuery)
        .then(setSupervisorResults)
        .catch(() => setSupervisorResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [supervisorQuery, supervisor]);

  async function handleSubmit(sendToQc: boolean) {
    if (!po || !canSubmit) return;
    setSubmitting(true);
    try {
      const grn = await createGrn({
        purchaseOrderId: po.id,
        receivedDate: new Date(receivedDate).toISOString(),
        // Free-text remarks only — logistics live in their own fields below.
        notes: remarks || undefined,
        vendorDeliveryChallanNumber: challanNo || undefined,
        deliveryChallanDate: challanDate ? new Date(challanDate).toISOString() : undefined,
        vehicleOrAwbNumber: vehicleAwb || undefined,
        driverOrCourier: driverCourier || undefined,
        totalPackagesReceived: totalPackages ? Number(totalPackages) : undefined,
        packingCondition: packingCondition || undefined,
        supervisorSignOffId: supervisor?.id,
        lines: enteredLines.map((l) => ({
          purchaseOrderLineId: l.poLineId,
          storeLocationId: l.storeLocationId,
          receivedQuantity: Number(l.quantity),
        })),
      });
      if (sendToQc) {
        await submitGrn(grn.id);
        toast.success(`${grn.grnNumber} created and sent to QC inspection`);
      } else {
        toast.success(`${grn.grnNumber} saved as draft`);
      }
      router.push(`/stores/grn/${grn.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create GRN');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer className="max-w-5xl">
      <div className="mb-4">
        <Link
          href="/stores/grn"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> GRN Register
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">New Goods Receipt Note</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Recording a receipt moves <span className="font-medium">no stock</span> — material
        enters stock only after QC inspection accepts it.
      </p>

      <GrnFlowIndicator status="DRAFT" className="mb-6" />

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Receipt Header</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-3">
              <Field label="GRN No." hint="Auto-assigned on save">
                <Input value="Auto (GRN-YYYY-####)" disabled />
              </Field>
              <Field label="Received Date" htmlFor="rdate">
                <Input
                  id="rdate"
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </Field>
              <Field label="Received By">
                <Input value={user?.email ?? ''} disabled />
              </Field>
              <Field label="PO Reference" htmlFor="po" required className="md:col-span-2">
                <Select id="po" value={poId} onChange={(e) => setPoId(e.target.value)}>
                  <option value="">Select an issued PO…</option>
                  {issuedPos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.poNumber} — {p.supplierName ?? p.vendorName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Supplier / Vendor">
                <Input value={po ? (po.supplierName ?? po.vendorName ?? '') : ''} disabled />
              </Field>
            </CardContent>
          </Card>

          {po && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Logistics</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3">
                  <Field label="Delivery Challan No." htmlFor="challan">
                    <Input id="challan" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} />
                  </Field>
                  <Field label="Challan Date" htmlFor="cdate">
                    <Input id="cdate" type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} />
                  </Field>
                  <Field label="Vehicle / AWB No." htmlFor="vehicle">
                    <Input id="vehicle" value={vehicleAwb} onChange={(e) => setVehicleAwb(e.target.value)} />
                  </Field>
                  <Field label="Driver / Courier" htmlFor="driver">
                    <Input id="driver" value={driverCourier} onChange={(e) => setDriverCourier(e.target.value)} />
                  </Field>
                  <Field label="Total Packages" htmlFor="pkgs">
                    <Input id="pkgs" type="number" min="0" value={totalPackages} onChange={(e) => setTotalPackages(e.target.value)} />
                  </Field>
                  <Field label="Packing Condition" htmlFor="pack">
                    <Select
                      id="pack"
                      value={packingCondition}
                      onChange={(e) => setPackingCondition(e.target.value as PackingCondition | '')}
                    >
                      <option value="">Not recorded</option>
                      {(Object.keys(PACKING_CONDITION_LABEL) as PackingCondition[]).map((c) => (
                        <option key={c} value={c}>
                          {PACKING_CONDITION_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Items Received</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Part No. / Description</TableHead>
                        <TableHead className="text-right">PO Qty</TableHead>
                        <TableHead className="text-right">Prev. Received</TableHead>
                        <TableHead className="w-32 text-right">Qty This GRN</TableHead>
                        <TableHead className="w-40">Bin / Store</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {po.lines.map((line) => {
                        const prev = prevReceivedByLine[line.id] ?? 0;
                        const or = overReceipt(line.id);
                        const draft = lines[line.id];
                        return (
                          <TableRow key={line.id}>
                            <TableCell>
                              <div className="font-medium">{line.itemCode}</div>
                              <div className="text-xs text-muted-foreground">{line.itemName}</div>
                            </TableCell>
                            <TableCell className="text-right">
                              {line.orderedQuantity} {line.unitOfMeasure}
                            </TableCell>
                            <TableCell className="text-right">{prev}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min="0"
                                step="any"
                                className="text-right"
                                value={draft?.quantity ?? ''}
                                onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                                aria-invalid={or?.over ? true : undefined}
                              />
                              {or?.over && (
                                <div className="mt-1 flex items-center justify-end gap-1 text-xs text-warning">
                                  <AlertTriangle className="size-3" />
                                  Over remaining ({or.remaining})
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={draft?.storeLocationId ?? ''}
                                onChange={(e) => updateLine(line.id, { storeLocationId: e.target.value })}
                              >
                                {stores.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name}
                                  </option>
                                ))}
                              </Select>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {anyOverReceipt && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <p>
                    One or more lines exceed the remaining ordered quantity. This is allowed
                    (over-receipts happen), but confirm the quantities are correct before sending to QC.
                  </p>
                </div>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Receiving Remarks &amp; Sign-off</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Field label="Receiving Remarks" htmlFor="remarks" className="md:col-span-2">
                    <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                  </Field>
                  <Field label="Stores Keeper">
                    <Input value={user?.email ?? ''} disabled />
                  </Field>
                  <Field
                    label="Supervisor Sign-off"
                    htmlFor="supervisor"
                    hint="Search by name or email"
                  >
                    {supervisor ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-1.5 text-sm">
                        <span>
                          {supervisor.firstName} {supervisor.lastName}{' '}
                          <span className="text-muted-foreground">({supervisor.employeeId})</span>
                        </span>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSupervisor(null);
                            setSupervisorQuery('');
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <Input
                          id="supervisor"
                          value={supervisorQuery}
                          onChange={(e) => setSupervisorQuery(e.target.value)}
                          placeholder="Type to search…"
                          autoComplete="off"
                        />
                        {supervisorResults.length > 0 && (
                          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover shadow-md">
                            {supervisorResults.map((emp) => (
                              <li key={emp.id}>
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent"
                                  onClick={() => {
                                    setSupervisor(emp);
                                    setSupervisorResults([]);
                                  }}
                                >
                                  <span>
                                    {emp.firstName} {emp.lastName}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{emp.employeeId}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </Field>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleSubmit(false)} disabled={!canSubmit}>
                  Save Draft
                </Button>
                <Button onClick={() => handleSubmit(true)} disabled={!canSubmit}>
                  <Send className="size-4" /> Send to QC Inspection
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </PageContainer>
  );
}
