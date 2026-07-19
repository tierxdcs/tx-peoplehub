'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { ApiError } from '../../../../lib/api';
import {
  createPurchaseOrder,
  isQualifiedStatus,
  type CreatePurchaseOrderInput,
} from '../../../../lib/stores';
import { listSuppliers, type Supplier } from '../../../../lib/scm-supplier';
import { listVendors, type Vendor } from '../../../../lib/scm';
import { listItems, type Item } from '../../../../lib/scm-item-master';
import { formatINR } from '../../../../lib/sales';
import { humanizeEnum } from '../../../../lib/status';
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
import { Badge } from '../../../../components/ui/badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import { useToast } from '../../../../components/ui/toaster';

type PartnerType = 'SUPPLIER' | 'VENDOR';
interface LineDraft {
  key: number;
  itemId: string;
  orderedQuantity: string;
  unitPrice: string;
}

let lineKeySeq = 1;

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const toast = useToast();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const [partnerType, setPartnerType] = useState<PartnerType>('SUPPLIER');
  const [partnerId, setPartnerId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([
    { key: lineKeySeq++, itemId: '', orderedQuantity: '', unitPrice: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [s, v, i] = await Promise.all([
          listSuppliers(),
          listVendors(),
          listItems({ activeOnly: true }),
        ]);
        setSuppliers(s);
        setVendors(v);
        setItems(i);
      } catch {
        toast.error('Failed to load form data.');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partners = partnerType === 'SUPPLIER' ? suppliers : vendors;

  // The selected partner's qualification status, resolved inline so the warning
  // is visible BEFORE submitting (not only in the server response afterward).
  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === partnerId) ?? null,
    [partners, partnerId],
  );
  const unqualified =
    selectedPartner != null && !isQualifiedStatus(selectedPartner.status);

  const itemById = useCallback(
    (id: string) => items.find((it) => it.id === id) ?? null,
    [items],
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = Number(l.orderedQuantity);
        const p = Number(l.unitPrice);
        return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
      }, 0),
    [lines],
  );

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { key: lineKeySeq++, itemId: '', orderedQuantity: '', unitPrice: '' }]);
  }
  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  const validLines = lines.filter(
    (l) => l.itemId && Number(l.orderedQuantity) > 0 && Number(l.unitPrice) >= 0,
  );
  const canSubmit = !!partnerId && validLines.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const input: CreatePurchaseOrderInput = {
      ...(partnerType === 'SUPPLIER' ? { supplierId: partnerId } : { vendorId: partnerId }),
      ...(expectedDeliveryDate ? { expectedDeliveryDate: new Date(expectedDeliveryDate).toISOString() } : {}),
      ...(notes ? { notes } : {}),
      lines: validLines.map((l) => ({
        itemId: l.itemId,
        orderedQuantity: Number(l.orderedQuantity),
        unitPrice: Number(l.unitPrice),
      })),
    };
    try {
      const po = await createPurchaseOrder(input);
      if (po.qualificationWarning) {
        toast.success(
          `PO ${po.poNumber} created — note: ${po.qualificationWarning.message}`,
          'Created with warning',
        );
      } else {
        toast.success(`Purchase order ${po.poNumber} created`);
      }
      router.push(`/stores/purchase-orders/${po.id}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create PO');
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <div className="mb-4">
        <Link
          href="/stores/purchase-orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Purchase Orders
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">New Purchase Order</h1>

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supplier / Vendor</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Partner Type" htmlFor="partnerType">
                  <Select
                    id="partnerType"
                    value={partnerType}
                    onChange={(e) => {
                      setPartnerType(e.target.value as PartnerType);
                      setPartnerId('');
                    }}
                  >
                    <option value="SUPPLIER">Supplier (raw materials)</option>
                    <option value="VENDOR">Vendor</option>
                  </Select>
                </Field>
                <Field
                  label={partnerType === 'SUPPLIER' ? 'Supplier' : 'Vendor'}
                  htmlFor="partner"
                  required
                  hint="Qualification status is shown beside each name."
                >
                  <Select
                    id="partner"
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.companyName} — {humanizeEnum(p.status)}
                        {isQualifiedStatus(p.status) ? '' : ' ⚠'}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              {selectedPartner && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Qualification:</span>
                  <Badge variant={isQualifiedStatus(selectedPartner.status) ? 'success' : 'warning'}>
                    {humanizeEnum(selectedPartner.status)}
                  </Badge>
                </div>
              )}

              {unqualified && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">This {partnerType.toLowerCase()} is not qualified.</p>
                    <p className="text-muted-foreground">
                      {selectedPartner?.companyName} is currently{' '}
                      {humanizeEnum(selectedPartner!.status)}. The purchase order is still
                      allowed (emergency purchases are legitimate), but review before issuing.
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {lines.map((line) => {
                const item = itemById(line.itemId);
                const lineTotal =
                  Number(line.orderedQuantity) * Number(line.unitPrice) || 0;
                return (
                  <div key={line.key} className="grid items-end gap-3 md:grid-cols-[1fr_120px_140px_120px_40px]">
                    <Field label="Item">
                      <Select
                        value={line.itemId}
                        onChange={(e) => updateLine(line.key, { itemId: e.target.value })}
                      >
                        <option value="">Select item…</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.itemCode} — {it.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={`Qty${item ? ` (${item.baseUnitOfMeasure})` : ''}`}>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.orderedQuantity}
                        onChange={(e) => updateLine(line.key, { orderedQuantity: e.target.value })}
                      />
                    </Field>
                    <Field label="Unit Price (₹)">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={line.unitPrice}
                        onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                      />
                    </Field>
                    <Field label="Line Total">
                      <div className="flex h-9 items-center text-sm font-medium">
                        {formatINR(lineTotal)}
                      </div>
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(line.key)}
                      disabled={lines.length === 1}
                      aria-label="Remove line"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  <Plus className="size-4" /> Add line
                </Button>
                <div className="text-sm">
                  <span className="text-muted-foreground">Total: </span>
                  <span className="font-semibold">{formatINR(total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Expected Delivery Date" htmlFor="edd">
                <Input
                  id="edd"
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </Field>
              <Field label="Notes" htmlFor="notes" className="md:col-span-2">
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/stores/purchase-orders')}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create Purchase Order'}
            </Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
